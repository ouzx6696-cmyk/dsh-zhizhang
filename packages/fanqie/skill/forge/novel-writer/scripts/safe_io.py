#!/usr/bin/env python3
"""Small, standard-library path guard for optional writing tools.

Reject links/reparse points, including linked ancestors. On POSIX, directory-fd
walks + O_NOFOLLOW protect the write traversal. Other hosts use repeated checks;
that fallback is for trusted local directories, not hostile concurrent writers.
"""
from __future__ import annotations

import os
import stat
from pathlib import Path, PureWindowsPath


class UnsafePath(ValueError):
    pass


POSIX_GUARD = (
    os.name == 'posix' and hasattr(os, 'O_NOFOLLOW') and hasattr(os, 'O_DIRECTORY')
    and os.open in os.supports_dir_fd and os.mkdir in os.supports_dir_fd
)


def absolute(path: Path | str) -> Path:
    value = str(path)
    if os.name != 'nt' and (PureWindowsPath(value).drive or value.startswith('\\')):
        raise UnsafePath('当前系统不能把Windows路径当相对目录创建')
    return Path(os.path.abspath(os.path.expanduser(value)))


def is_link(path: Path) -> bool:
    try:
        info = path.lstat()
    except FileNotFoundError:
        return False
    return stat.S_ISLNK(info.st_mode) or bool(
        getattr(info, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0x400)
    )


def check_chain(path: Path) -> None:
    """Check existing lexical ancestors without resolving away a link."""
    path = absolute(path)
    chain = list(reversed(path.parents)) + [path]
    for part in chain:
        if is_link(part):
            raise UnsafePath(f'拒绝符号链接或目录联接：{part}')
        if part != path and part.exists() and not part.is_dir():
            raise UnsafePath(f'父路径不是目录：{part}')


def target(root: Path, relative: str | Path) -> Path:
    root = absolute(root)
    rel = Path(relative)
    if rel.is_absolute() or PureWindowsPath(str(relative)).drive or '\\' in str(relative) or '..' in rel.parts or not str(relative):
        raise UnsafePath(f'仅接受根内相对路径：{relative}')
    result = root / rel
    check_chain(result)
    # No resolve-based substitution: the authorized lexical root is retained.
    if not result.is_relative_to(root):
        raise UnsafePath(f'目标越出作品根：{result}')
    return result


def _dir_fd(directory: Path, create: bool = False) -> int:
    """Walk from the filesystem anchor; caller owns the returned descriptor."""
    directory = absolute(directory)
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    fd = os.open(directory.anchor, flags)
    try:
        for part in directory.parts[1:]:
            if create:
                try:
                    os.mkdir(part, mode=0o755, dir_fd=fd)
                except FileExistsError:
                    pass
            new = os.open(part, flags, dir_fd=fd)
            os.close(fd)
            fd = new
        return fd
    except BaseException:
        os.close(fd)
        raise


def mkdir(root: Path, relative: str | Path) -> None:
    path = target(root, relative)
    if POSIX_GUARD:
        fd = _dir_fd(path, create=True)
        os.close(fd)
    else:
        check_chain(path)
        path.mkdir(parents=True, exist_ok=True)
        check_chain(path)


def create_exclusive(root: Path, relative: str | Path, data: bytes) -> None:
    """Create complete bytes without replacing an existing name. Parent must exist."""
    path = target(root, relative)
    if POSIX_GUARD:
        parent = _dir_fd(path.parent)
        try:
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
            fd = os.open(path.name, flags, 0o644, dir_fd=parent)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(data)
                stream.flush()
                try:
                    os.fsync(stream.fileno())
                except OSError as exc:
                    if exc.errno not in (22, 95):
                        raise
        finally:
            os.close(parent)
    else:
        check_chain(path)
        with path.open('xb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        check_chain(path)


def read_bytes(root: Path, relative: str | Path) -> bytes:
    path = target(root, relative)
    if POSIX_GUARD:
        parent = _dir_fd(path.parent)
        try:
            fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, 'O_NONBLOCK', 0), dir_fd=parent)
            with os.fdopen(fd, 'rb') as stream:
                if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                    raise UnsafePath(f'不是普通文件：{path}')
                return stream.read()
        finally:
            os.close(parent)
    check_chain(path)
    if not path.is_file():
        raise UnsafePath(f'不是普通文件：{path}')
    return path.read_bytes()
