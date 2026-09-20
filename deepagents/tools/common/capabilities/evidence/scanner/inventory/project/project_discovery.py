"""Deterministic, safe project discovery from repository manifests."""
from __future__ import annotations

import hashlib
import json
import tomllib
from dataclasses import replace
from pathlib import Path
from typing import Iterable

from .project_detector import ProjectDetector
from .project_types import ProjectDescriptor, ProjectDiscoveryResult
from ..language.language_classifier import LanguageClassifier


EXCLUDED_DIRS = {".git", "node_modules", "dist", "build", "vendor", ".venv", "venv", "__pycache__"}


def _walk_files(workspace: Path, patterns: Iterable[str]) -> list[Path]:
    found: set[Path] = set()
    for pattern in patterns:
        for path in workspace.rglob(pattern):
            if not path.is_file() or any(part in EXCLUDED_DIRS for part in path.relative_to(workspace).parts):
                continue
            found.add(path.resolve(strict=False))
    return sorted(found, key=lambda p: p.relative_to(workspace).as_posix())


def _stable_id(relative_root: str, primary_manifest: str, name: str | None) -> str:
    payload = json.dumps(
        {"root": relative_root, "manifest": primary_manifest, "name": name or ""},
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return f"project-{hashlib.sha256(payload).hexdigest()[:20]}"


def _descriptor(
    workspace: Path,
    root: Path,
    manifest: Path,
    *,
    name: str | None,
    kind: str,
    evidence: str,
) -> ProjectDescriptor:
    relative_root = root.relative_to(workspace).as_posix() if root != workspace else ""
    relative_manifest = manifest.relative_to(workspace).as_posix()
    return ProjectDescriptor(
        project_id=_stable_id(relative_root, relative_manifest, name),
        root_path=root,
        relative_root=relative_root,
        project_name=name,
        project_kind=kind,
        manifest_paths=(relative_manifest,),
        discovery_evidence=(evidence,),
    )


def _read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}


def _read_toml(path: Path) -> dict:
    try:
        with path.open("rb") as stream:
            value = tomllib.load(stream)
        return value if isinstance(value, dict) else {}
    except (OSError, tomllib.TOMLDecodeError):
        return {}


class PackageJsonDetector:
    name = "package-json"

    def detect(self, workspace: Path) -> tuple[ProjectDescriptor, ...]:
        descriptors = []
        for manifest in _walk_files(workspace, ("package.json",)):
            payload = _read_json(manifest)
            name = payload.get("name") if isinstance(payload.get("name"), str) else None
            descriptor = _descriptor(workspace, manifest.parent, manifest, name=name, kind="javascript", evidence="package.json")
            if not payload:
                descriptor = replace(descriptor, limitations=("manifest_parse_failed:package.json",))
            descriptors.append(descriptor)
        return tuple(descriptors)


class PythonManifestDetector:
    name = "python-manifest"

    def detect(self, workspace: Path) -> tuple[ProjectDescriptor, ...]:
        manifests = _walk_files(workspace, ("pyproject.toml", "setup.py", "setup.cfg", "requirements*.txt"))
        grouped: dict[Path, list[Path]] = {}
        for manifest in manifests:
            root = manifest.parent
            grouped.setdefault(root, []).append(manifest)
        descriptors = []
        for root, paths in sorted(grouped.items(), key=lambda item: item[0].relative_to(workspace).as_posix()):
            primary = next((p for p in paths if p.name == "pyproject.toml"), paths[0])
            name = None
            if primary.name == "pyproject.toml":
                payload = _read_toml(primary)
                project = payload.get("project") if isinstance(payload.get("project"), dict) else {}
                name = project.get("name") if isinstance(project.get("name"), str) else None
            descriptor = _descriptor(workspace, root, primary, name=name, kind="python", evidence=primary.name)
            if primary.name == "pyproject.toml" and not _read_toml(primary):
                descriptor = replace(descriptor, limitations=("manifest_parse_failed:pyproject.toml",))
            descriptors.append(replace(descriptor, manifest_paths=tuple(sorted(p.relative_to(workspace).as_posix() for p in paths))))
        return tuple(descriptors)


class RecognitionManifestDetector:
    name = "ecosystem-recognition"
    _patterns = {
        "dotnet": ("*.csproj", "*.sln", "Directory.Build.props", "Directory.Packages.props"),
        "ruby": ("Gemfile", "*.gemspec"),
        "jvm": ("pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"),
        "go": ("go.mod",),
        "rust": ("Cargo.toml",),
        "flutter": ("pubspec.yaml",),
        "php": ("composer.json",),
        "ios": ("*.xcodeproj", "*.xcworkspace", "Package.swift", "Podfile"),
        "android": ("AndroidManifest.xml",),
    }

    def detect(self, workspace: Path) -> tuple[ProjectDescriptor, ...]:
        descriptors = []
        for kind, patterns in sorted(self._patterns.items()):
            for manifest in _walk_files(workspace, patterns):
                descriptors.append(_descriptor(workspace, manifest.parent, manifest, name=None, kind=kind, evidence=manifest.name))
        # Xcode project/workspace bundles are directories, so they are detected
        # separately from file manifests without traversing generated contents.
        for pattern in ("*.xcodeproj", "*.xcworkspace"):
            for bundle in sorted(workspace.rglob(pattern), key=lambda p: p.relative_to(workspace).as_posix()):
                if bundle.is_dir() and not any(part in EXCLUDED_DIRS for part in bundle.relative_to(workspace).parts):
                    descriptors.append(_descriptor(workspace, bundle.parent, bundle, name=None, kind="ios", evidence=bundle.name))
        return tuple(descriptors)


class ProjectDetectorRegistry:
    def __init__(self, detectors: Iterable[ProjectDetector] = ()) -> None:
        self._detectors: list[ProjectDetector] = []
        for detector in detectors:
            self.register(detector)

    @classmethod
    def default(cls) -> "ProjectDetectorRegistry":
        return cls((PackageJsonDetector(), PythonManifestDetector(), RecognitionManifestDetector()))

    def register(self, detector: ProjectDetector) -> None:
        if any(item.name == detector.name for item in self._detectors):
            raise ValueError(f"project detector already registered: {detector.name}")
        self._detectors.append(detector)
        self._detectors.sort(key=lambda item: item.name)

    def discover(self, workspace: str | Path) -> ProjectDiscoveryResult:
        root = Path(workspace).resolve(strict=False)
        descriptors: list[ProjectDescriptor] = []
        limitations: list[str] = []
        for detector in self._detectors:
            try:
                descriptors.extend(detector.detect(root))
            except Exception as exc:
                limitations.append(f"project_detector_failed:{detector.name}:{type(exc).__name__}")
        merged = self._merge(root, descriptors, limitations)
        limitations.extend(
            limitation
            for descriptor in merged
            for limitation in descriptor.limitations
        )
        return ProjectDiscoveryResult(
            projects=tuple(merged),
            limitations=tuple(sorted(set(limitations))),
            file_ownership={},
            unowned_files=(),
        )

    @staticmethod
    def _merge(workspace: Path, descriptors: list[ProjectDescriptor], limitations: list[str]) -> list[ProjectDescriptor]:
        by_root: dict[str, list[ProjectDescriptor]] = {}
        for descriptor in descriptors:
            by_root.setdefault(descriptor.relative_root, []).append(descriptor)
        merged: list[ProjectDescriptor] = []
        for relative_root, values in sorted(by_root.items()):
            ordered = sorted(values, key=lambda item: (item.manifest_paths[0], item.project_id))
            primary = next((item for item in ordered if item.project_kind in {"javascript", "python"}), ordered[0])
            manifests = tuple(sorted({path for item in ordered for path in item.manifest_paths}))
            descriptor_limitations = tuple(
                sorted({limitation for item in ordered for limitation in item.limitations})
            )
            names = sorted({item.project_name for item in ordered if item.project_name})
            kinds = sorted({item.project_kind for item in ordered if item.project_kind})
            if len(names) > 1:
                limitations.append(f"project_metadata_conflict:{relative_root}:name")
            merged.append(
                replace(
                    primary,
                    manifest_paths=manifests,
                    project_name=names[0] if names else None,
                    project_kind=kinds[0] if len(kinds) == 1 else primary.project_kind,
                    limitations=descriptor_limitations,
                )
            )
        ids_by_root = {item.relative_root: item.project_id for item in merged}
        result = []
        for item in merged:
            parent_roots = [
                root
                for root in ids_by_root
                if root != item.relative_root
                and (root == "" or item.relative_root.startswith(f"{root}/"))
            ]
            parent_root = max(parent_roots, key=len) if parent_roots else None
            result.append(replace(item, parent_project_id=ids_by_root.get(parent_root)))
        return result


class ProjectDiscovery:
    def __init__(self, registry: ProjectDetectorRegistry | None = None) -> None:
        self.registry = registry or ProjectDetectorRegistry.default()

    def discover(self, workspace: str | Path, classifications=None) -> ProjectDiscoveryResult:
        result = self.registry.discover(workspace)
        root = Path(workspace).resolve(strict=False)
        classifications = (
            tuple(classifications)
            if classifications is not None
            else tuple(LanguageClassifier().classify_workspace(root))
        )
        ownership: dict[str, str] = {}
        unowned: list[str] = []
        projects = sorted(result.projects, key=lambda item: len(item.relative_root), reverse=True)
        for classification in classifications:
            relative_file = classification.file_path
            owner = next((project for project in projects if not project.relative_root or relative_file == project.relative_root or relative_file.startswith(f"{project.relative_root}/")), None)
            if owner is None:
                unowned.append(relative_file)
            else:
                ownership[relative_file] = owner.project_id
        language_by_project: dict[str, set[str]] = {project.project_id: set() for project in result.projects}
        for classification in classifications:
            project_id = ownership.get(classification.file_path)
            if project_id:
                language_by_project.setdefault(project_id, set()).add(classification.language)
        updated_projects = tuple(
            replace(project, detected_languages=tuple(sorted(language_by_project.get(project.project_id, set()))))
            for project in result.projects
        )
        return replace(
            result,
            projects=updated_projects,
            file_ownership=dict(sorted(ownership.items())),
            unowned_files=tuple(sorted(unowned)),
            classifications=classifications,
        )
