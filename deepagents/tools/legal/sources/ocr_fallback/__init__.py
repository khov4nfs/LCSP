"""OCR fallback capability public API.

The physical implementation is capability-owned under this package. Re-exporting
the core contract keeps callers on the capability package API without a flat
``sources/ocr_fallback.py`` shim.
"""

from .ocr_fallback import OcrFallbackRequest, OcrFallbackResult, OcrFallbackTool

__all__ = [
    "OcrFallbackRequest",
    "OcrFallbackResult",
    "OcrFallbackTool",
]
