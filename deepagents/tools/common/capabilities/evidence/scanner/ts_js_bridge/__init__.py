"""TS/JS analyzer subprocess bridge."""

from .bridge import TsJsBridge
from .bridge_types import (
    TsJsBridgeResult,
    TsJsCoverageLimitation,
    TsJsFinding,
    TsJsUnsupportedDynamicFlow,
)

__all__ = [
    "TsJsBridge",
    "TsJsBridgeResult",
    "TsJsCoverageLimitation",
    "TsJsFinding",
    "TsJsUnsupportedDynamicFlow",
]
