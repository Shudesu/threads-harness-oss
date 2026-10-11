import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('legacy', Path(__file__).parents[1] / 'scripts/legacy-draft.py')
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)
class LegacyDraftTest(unittest.TestCase):
    def test_vps_labels_and_three_parts(self):
        text = '【1投稿目】フック\n**事実**\n---\n本文展開:\n理由\n---\n結論:\n次の一歩'
        self.assertEqual(legacy.parse_parts({'raw_text': text}), ['事実', '理由', '次の一歩'])
    def test_overlong_is_rejected_not_silently_truncated(self):
        with self.assertRaises(ValueError): legacy.parse_parts({'parts': ['a' * 501, 'end']})
    def test_unicode_and_explicit_parts_remain_unchanged(self):
        parts = ['😀' * 500, '## 利用者が書いた見出し']
        self.assertEqual(legacy.parse_parts({'parts': parts}), parts)
if __name__ == '__main__': unittest.main()
