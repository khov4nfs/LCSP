"""OCR fallback capability public API.

The physical implementation is capability-owned under this package. Re-exporting
its core contract keeps migration-era ``tools.legal.legal.ocr_fallback`` imports
working without restoring a flat ``sources/ocr_fallback.py`` shim.
"""

from .ocr_fallback import OcrFallbackRequest, OcrFallbackResult, OcrFallbackTool

__all__ = [
    "OcrFallbackRequest",
    "OcrFallbackResult",
    "OcrFallbackTool",
]
