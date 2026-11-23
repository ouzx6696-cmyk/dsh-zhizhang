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

    def test_limits_exposes_structured_styles(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / 'scripts/writer_bridge.py'), 'limits'],
            capture_output=True,
            encoding='utf-8',
        )
        self.assertEqual(result.returncode, 0)
        report = json.loads(result.stdout)
        self.assertTrue(report['ok'])
        self.assertEqual(report['title_max'], 34)
        self.assertEqual(report['pass_score'], 84)
        styles = report['styles']
        self.assertIsInstance(styles['byLine'], dict)
        self.assertTrue(len(styles['byLine']) > 0)
        self.assertIsInstance(styles['allOpenings'], list)
        self.assertTrue(len(styles['allOpenings']) > 0)
        self.assertIsInstance(styles['allEndings'], list)
        self.assertTrue(len(styles['allEndings']) > 0)

    def test_check_card_valid_and_invalid(self):
        ok_res = subprocess.run(
            [
                sys.executable,
                str(ROOT / 'scripts/writer_bridge.py'),
                'check-card',
                '--card',
                str(ROOT / 'tests/fixtures/story_long_card.json'),
            ],
            capture_output=True,
            encoding='utf-8',
        )
        self.assertEqual(ok_res.returncode, 0)
        ok_report = json.loads(ok_res.stdout)
        self.assertTrue(ok_report['ok'])
        self.assertTrue(ok_report['valid'])
        self.assertEqual(ok_report['errors'], [])

        with tempfile.TemporaryDirectory() as folder:
            bad_path = Path(folder) / 'bad.json'
            bad_path.write_text('{ broken json', encoding='utf-8')
            bad_res = subprocess.run(
                [sys.executable, str(ROOT / 'scripts/writer_bridge.py'), 'check-card', '--card', str(bad_path)],
                capture_output=True,
                encoding='utf-8',
            )
            self.assertEqual(bad_res.returncode, 0)
            bad_report = json.loads(bad_res.stdout)
            self.assertTrue(bad_report['ok'])
            self.assertFalse(bad_report['valid'])
            self.assertTrue(len(bad_report['errors']) >= 1)

if __name__ == '__main__':
    unittest.main()
