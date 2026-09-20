from .protocol import FrameworkAnalysisResult, FrameworkCapability, FrameworkDetector
from .registry import FrameworkAdapterRegistry
from .rails import RailsFrameworkAdapter, RailsFrameworkDetector
from .aspnet import AspNetCoreFrameworkAdapter, AspNetCoreFrameworkDetector

__all__ = [
    "FrameworkAnalysisResult",
    "FrameworkCapability",
    "FrameworkDetector",
    "FrameworkAdapterRegistry",
    "RailsFrameworkAdapter",
    "RailsFrameworkDetector",
    "AspNetCoreFrameworkAdapter",
    "AspNetCoreFrameworkDetector",
]
