from __future__ import annotations

import importlib
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))


def test_ocr_fallback_package_exports_core_tool_contract() -> None:
    implementation = importlib.import_module(
        "tools.legal.sources.ocr_fallback.ocr_fallback"
    )
    canonical = importlib.import_module("tools.legal.sources.ocr_fallback")

    assert implementation.OcrFallbackTool is canonical.OcrFallbackTool
    assert implementation.OcrFallbackRequest is canonical.OcrFallbackRequest


def test_ocr_fallback_boundary_can_resolve_package_core_import() -> None:
    module = importlib.import_module(
        "tools.legal.sources.ocr_fallback.ocr_fallback_boundary"
    )
    assert module.OcrFallbackBoundary.__name__ == "OcrFallbackBoundary"
