from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable

from .protocol import FrameworkAdapter, FrameworkAnalysisResult, FrameworkCapability, FrameworkDetector


class FrameworkAdapterRegistry:
    def __init__(
        self,
        adapters: Iterable[FrameworkAdapter] = (),
        detectors: Iterable[FrameworkDetector] = (),
    ) -> None:
        self._adapters: list[FrameworkAdapter] = []
        self._detectors: list[FrameworkDetector] = []
        self.detection_limitations: list[str] = []
        for adapter in adapters:
            self.register(adapter)
        for detector in detectors:
            self.register_detector(detector)

    @classmethod
    def default(cls) -> "FrameworkAdapterRegistry":
        from .aspnet import AspNetCoreFrameworkAdapter, AspNetCoreFrameworkDetector
        from .rails import RailsFrameworkAdapter, RailsFrameworkDetector
        from .spring import SpringFrameworkAdapter, SpringFrameworkDetector
        from .php_frameworks import LaravelFrameworkAdapter, LaravelFrameworkDetector, SymfonyFrameworkAdapter, SymfonyFrameworkDetector
        from .mobile import AndroidFrameworkAdapter, AndroidFrameworkDetector, FlutterFrameworkAdapter, FlutterFrameworkDetector, IOSFrameworkAdapter, IOSFrameworkDetector, ReactNativeFrameworkAdapter, ReactNativeFrameworkDetector
        from .python_ts_frontend import (
            AngularFrameworkAdapter, AngularFrameworkDetector, DjangoFrameworkAdapter,
            DjangoFrameworkDetector, ElectronFrameworkAdapter, ElectronFrameworkDetector,
            ExpressFrameworkAdapter, ExpressFrameworkDetector, FastApiFrameworkAdapter,
            FastApiFrameworkDetector, FlaskFrameworkAdapter, FlaskFrameworkDetector,
            NestJsFrameworkAdapter, NestJsFrameworkDetector, NextJsFrameworkAdapter,
            NextJsFrameworkDetector, NuxtFrameworkAdapter, NuxtFrameworkDetector,
            ReactFrameworkAdapter, ReactFrameworkDetector, SvelteFrameworkAdapter,
            SvelteFrameworkDetector, SvelteKitFrameworkAdapter, SvelteKitFrameworkDetector,
            VueFrameworkAdapter, VueFrameworkDetector,
        )

        return cls(
            (
                AndroidFrameworkAdapter(), AspNetCoreFrameworkAdapter(), AngularFrameworkAdapter(),
                DjangoFrameworkAdapter(), ElectronFrameworkAdapter(), ExpressFrameworkAdapter(),
                FastApiFrameworkAdapter(), FlaskFrameworkAdapter(), FlutterFrameworkAdapter(),
                IOSFrameworkAdapter(), LaravelFrameworkAdapter(), NestJsFrameworkAdapter(),
                NextJsFrameworkAdapter(), NuxtFrameworkAdapter(), RailsFrameworkAdapter(),
                ReactFrameworkAdapter(), ReactNativeFrameworkAdapter(), SpringFrameworkAdapter(),
                SvelteFrameworkAdapter(), SvelteKitFrameworkAdapter(), SymfonyFrameworkAdapter(),
                VueFrameworkAdapter(),
            ),
            (
                AndroidFrameworkDetector(), AngularFrameworkDetector(), AspNetCoreFrameworkDetector(),
                DjangoFrameworkDetector(), ElectronFrameworkDetector(), ExpressFrameworkDetector(),
                FastApiFrameworkDetector(), FlaskFrameworkDetector(), FlutterFrameworkDetector(),
                IOSFrameworkDetector(), LaravelFrameworkDetector(), NestJsFrameworkDetector(),
                NextJsFrameworkDetector(), NuxtFrameworkDetector(), RailsFrameworkDetector(),
                ReactFrameworkDetector(), ReactNativeFrameworkDetector(), SpringFrameworkDetector(),
                SvelteFrameworkDetector(), SvelteKitFrameworkDetector(), SymfonyFrameworkDetector(),
                VueFrameworkDetector(),
            ),
        )

    def register(self, adapter: FrameworkAdapter) -> None:
        if any(item.framework == adapter.framework for item in self._adapters):
            raise ValueError(f"framework adapter already registered: {adapter.framework}")
        self._adapters.append(adapter)
        self._adapters.sort(key=lambda item: item.framework)

    def register_detector(self, detector: FrameworkDetector) -> None:
        if any(item.name == detector.name for item in self._detectors):
            raise ValueError(f"framework detector already registered: {detector.name}")
        self._detectors.append(detector)
        self._detectors.sort(key=lambda item: item.name)

    def detect(self, project, workspace: Path, language_result: Any) -> tuple[str, ...]:
        detected: set[str] = set()
        self.detection_limitations = []
        for detector in self._detectors:
            try:
                detected.update(detector.detect(project, workspace, language_result))
            except (KeyboardInterrupt, SystemExit):
                raise
            except Exception as error:
                self.detection_limitations.append(
                    f"framework detection failed ({detector.name}): {type(error).__name__}"
                )
        return tuple(sorted(detected))

    def analyze(self, framework: str, project, workspace: Path, language_result: Any) -> FrameworkAnalysisResult:
        adapter = next((item for item in self._adapters if item.supports(framework)), None)
        if adapter is None:
            from tools.common.capabilities.evidence.scanner.analyzers.protocol import ANALYZER_UNSUPPORTED

            return FrameworkAnalysisResult(
                framework=framework,
                project_id=project.project_id,
                status=ANALYZER_UNSUPPORTED,
                capabilities=FrameworkCapability(),
                coverage_limitations=(f"no framework adapter registered: {framework}",),
            )
        try:
            return adapter.analyze(project, workspace, language_result)
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception as error:
            from tools.common.capabilities.evidence.scanner.analyzers.protocol import ANALYZER_FAILED

            return FrameworkAnalysisResult(
                framework=framework,
                project_id=project.project_id,
                status=ANALYZER_FAILED,
                capabilities=adapter.capabilities(),
                coverage_limitations=(f"framework analysis failed: {type(error).__name__}",),
            )
