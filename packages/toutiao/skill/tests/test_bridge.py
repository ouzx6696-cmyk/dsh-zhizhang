"""Bridge input regressions; scoring and method prose are unchanged."""
import ast
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class BridgeTests(unittest.TestCase):
    def test_python38_annotations(self):
        for name in ('qa_check.py', 'rules.py', 'ledger.py', 'writer_bridge.py'):
            tree = ast.parse((ROOT / 'scripts' / name).read_text(encoding='utf-8'))
            for node in ast.walk(tree):
                annotation = getattr(node, 'annotation', None)
                if annotation is None:
                    continue
                for part in ast.walk(annotation):
                    self.assertFalse(isinstance(part, ast.BinOp) and isinstance(part.op, ast.BitOr))
                    self.assertFalse(isinstance(part, ast.Subscript) and isinstance(part.value, ast.Name) and part.value.id in ('list', 'dict', 'tuple', 'set'))

    def test_gbk_ledger_error_is_clear_and_file_unchanged(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'log.csv'
            raw = '主标题,状态\n中文标题,已交稿\n'.encode('gbk')
            path.write_bytes(raw)
            for args in [('ledger-show', '--ledger', str(path)), ('qa', '--file', str(ROOT / 'tests/fixtures/good.md'), '--ledger', str(path))]:
                result = subprocess.run([sys.executable, str(ROOT / 'scripts/writer_bridge.py'), *args], capture_output=True, encoding='utf-8')
                report = json.loads(result.stdout)
                self.assertFalse(report['ok'])
                self.assertIn('UTF-8', report['message'])
                self.assertEqual(path.read_bytes(), raw)

if __name__ == '__main__':
    unittest.main()
