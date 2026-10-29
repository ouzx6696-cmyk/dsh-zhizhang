#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""补建五状态文件和四个写作目录；已有内容不覆盖。仅 Python 3.10+ 标准库。

不授予写作/归档权限，不将占位符计作文学门禁。每个实际目标及父目录均
检查链接；POSIX 使用目录句柄/O_NOFOLLOW，其他系统仅适合可信本地目录。
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from safe_io import UnsafePath, absolute, check_chain, target, mkdir, create_exclusive, read_bytes

SKILL_ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_DIR = SKILL_ROOT / 'assets/templates'
PLACEHOLDER = re.compile(r'【[^】]*】')
DIRS = ('state', 'workspace/acts', 'workspace/outlines', 'workspace/drafts', 'workspace/chapters')
TEMPLATES = {name: f'state/{name}' for name in (
    'writing_style.md', 'editor_agent.md', 'story_foundation.md', 'constraints.md', 'current_state.md'
)}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='补建缺少的小说项目文件，不覆盖已有内容')
    parser.add_argument('root', nargs='?', default='.', help='技能包之外的作品根')
    args = parser.parse_args(argv)
    if not args.root.strip():
        print('项目根路径为空，未写入任何内容。')
        return 1
    try:
        root = absolute(args.root)
        check_chain(root)
        if root.exists() and not root.is_dir():
            raise UnsafePath(f'作品根不是目录：{root}')
        if root == SKILL_ROOT or SKILL_ROOT in root.parents:
            raise UnsafePath('拒绝在技能包内部建项目')
        suite = SKILL_ROOT.parent
        if all((suite / name / 'SKILL.md').is_file() for name in ('inspiration-forge', 'inspiration-forge-library')):
            if root == suite or suite in root.parents:
                raise UnsafePath('拒绝在技能目录内建作品；请指定技能目录之外的作品根')
        # Preflight every slot and all templates before making any directories.
        data = {}
        for name, rel in TEMPLATES.items():
            content = read_bytes(TEMPLATE_DIR, name)
            decoded = content.decode('utf-8')
            if not decoded.lstrip('\ufeff').strip():
                raise UnsafePath(f'模板为空：{name}')
            data[rel] = content
            path = target(root, rel)
            if path.exists() and not path.is_file():
                raise UnsafePath(f'状态槽被非文件占用：{path}')
        for rel in DIRS:
            path = target(root, rel)
            if path.exists() and not path.is_dir():
                raise UnsafePath(f'目录槽被非目录占用：{path}')
    except (OSError, UnicodeError, UnsafePath) as exc:
        print(f'预检失败，未写入任何内容：{exc}')
        return 1

    created, skipped = [], []
    active = None
    try:
        for rel in DIRS:
            mkdir(root, rel)
        for rel, content in data.items():
            active = rel
            try:
                create_exclusive(root, rel, content)
                created.append(rel)
            except FileExistsError:
                # Recheck the winner in a race; a directory or link is not a state file.
                current = target(root, rel)
                if not current.is_file():
                    raise UnsafePath(f'并发路径冲突：{current}')
                skipped.append(rel)
    except (OSError, UnsafePath) as exc:
        print(f'初始化中断：{exc}\n已新建：{created}；正在处理/可能未完整：{active}；已有内容未覆盖。请核对本轮新增，不整目录删除。')
        return 1

    print(f'作品根：{root}\n新建：{created or "无"}\n跳过已有：{skipped or "无"}')
    for rel in TEMPLATES.values():
        try:
            count = len(PLACEHOLDER.findall(read_bytes(root, rel).decode('utf-8')))
            if count:
                print(f'按需补充：{rel} 有 {count} 处模板提示，不代表不能开写。')
        except (OSError, UnicodeError, UnsafePath) as exc:
            print(f'未检查占位符：{rel}（{type(exc).__name__}）')
    print('沿用现行规划；只补本轮材料。草稿与已定稿、审读与授权分别判断。')
    return 0


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except (AttributeError, OSError):
        pass
    raise SystemExit(main())
