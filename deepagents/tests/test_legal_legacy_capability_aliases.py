from __future__ import annotations

import importlib
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))


def test_legacy_ocr_fallback_package_exports_core_tool_contract() -> None:
    legacy = importlib.import_module("tools.legal.legal.ocr_fallback")
    canonical = importlib.import_module("runtime.legal.sources.ocr_fallback")

    assert legacy.OcrFallbackTool.__name__ == "OcrFallbackTool"
    assert legacy.OcrFallbackRequest.__name__ == "OcrFallbackRequest"
    assert Path(str(legacy.__file__)).resolve() == Path(
        str(canonical.__file__)
    ).resolve()


def test_legacy_ocr_fallback_boundary_can_resolve_relative_core_import() -> None:
    module = importlib.import_module("tools.legal.legal.ocr_fallback_boundary")
    assert module.OcrFallbackBoundary.__name__ == "OcrFallbackBoundary"
