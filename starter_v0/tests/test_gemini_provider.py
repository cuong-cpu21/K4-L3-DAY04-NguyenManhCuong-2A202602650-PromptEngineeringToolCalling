from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from providers.gemini_provider import _function_calling_mode


class GeminiFunctionCallingModeTests(unittest.TestCase):
    def test_required_maps_to_any(self) -> None:
        self.assertEqual(_function_calling_mode("required"), "ANY")

    def test_optional_modes_are_preserved(self) -> None:
        self.assertEqual(_function_calling_mode("auto"), "AUTO")
        self.assertEqual(_function_calling_mode("none"), "NONE")

    def test_unspecified_or_structured_choice_uses_sdk_default(self) -> None:
        self.assertIsNone(_function_calling_mode(None))
        self.assertIsNone(_function_calling_mode({"type": "function"}))


if __name__ == "__main__":
    unittest.main()
