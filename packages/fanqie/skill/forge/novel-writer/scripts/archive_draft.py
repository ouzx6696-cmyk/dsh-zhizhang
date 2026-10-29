#!/usr/bin/env python3
"""将指定、已审版本的草稿复制为新定稿，不覆盖已有定稿。

--authorized 只是操作者对实际用户授权的声明，不能替用户授予权限。
脚本校验路径、字节版本和独占创建，不能证明审读完成或文学质量。
既有定稿修订另走 revision.md，不使用此命令覆盖。
"""
from __future__ import annotations

import argparse
import hashlib
import re
import sys
from pathlib import Path

from safe_io import UnsafePath, absolute, check_chain, target, mkdir, read_bytes, create_exclusive


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', help='已有作品根，不能为空')
    parser.add_argument('chapter', help='例如 C001；只支持已存在草稿的新章归档')
    parser.add_argument('--reviewed-sha256', required=True, help='实际完整审读结束时记录的草稿 SHA-256')
    parser.add_argument('--authorized', action='store_true', help='确认当前章已取得实际用户归档授权；并非自动授权')
    args = parser.parse_args(argv)
    try:
        if not args.root.strip():
            raise UnsafePath('作品根不能为空')
        root = absolute(args.root)
        if not args.authorized:
            raise UnsafePath('缺少实际授权声明，不归档；审读通过不是授权')
        if not re.fullmatch(r'C\d{3,}', args.chapter):
            raise UnsafePath('章号须为 C 加至少三位数字')
        if not re.fullmatch(r'[0-9a-fA-F]{64}', args.reviewed_sha256):
            raise UnsafePath('已审 SHA-256 格式不正确')
        check_chain(root)
        if not root.is_dir():
            raise UnsafePath('作品根不存在')
        skill = Path(__file__).resolve().parents[1]
        if root == skill or skill in root.parents:
            raise UnsafePath('作品根不能位于技能包内')
        suite = skill.parent
        if all((suite / n / 'SKILL.md').is_file() for n in ('inspiration-forge', 'inspiration-forge-library')):
            if root == suite or suite in root.parents:
                raise UnsafePath('作品根不能位于技能目录内；请指定技能目录之外的作品根')
        src = f'workspace/drafts/{args.chapter}.md'
        dst = f'workspace/chapters/{args.chapter}.md'
        out = target(root, dst)
        if out.exists():
            raise UnsafePath('现行定稿已存在，不覆盖；核清后跳过或走授权修订流程')
        content = read_bytes(root, src)
        decoded = content.decode('utf-8')
        if not decoded.lstrip('\ufeff').strip():
            raise UnsafePath('草稿为空')
        actual = hashlib.sha256(content).hexdigest()
        if actual != args.reviewed_sha256.lower():
            raise UnsafePath('草稿已变化或不是已审版本，必须重新审读')
        # Write the captured reviewed bytes, never reopen a possibly changed draft.
        mkdir(root, 'workspace/chapters')
        create_exclusive(root, dst, content)
        print(f'已独占创建 {dst}\nsha256: {actual}\n保留原草稿；状态仅按实际定稿更新。')
        return 0
    except (OSError, UnicodeError, UnsafePath) as exc:
        print(f'归档未完成：{exc}。未覆盖既有定稿；若写入中断，请核对目标完整性，不凭同名视为完成。')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
