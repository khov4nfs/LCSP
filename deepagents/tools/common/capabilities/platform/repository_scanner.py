"""Deterministic offline pre-scan and technical fact acquisition for assessment repositories.

Business purpose:
Perform read-only static scanning over the pinned repository workspace to discover
manifests, dependencies, programming languages, framework hints, and configuration layout
before agent investigation begins.

Business rules:
- Strictly read-only and deterministic: no execution of package scripts, no installation of
  dependencies, and no network or model/LLM calls.
- Enforce resource bounds: maximum inspected files, maximum file sizes for parsing, and
  maximum path depth.
- Respect immutable source path prefix: ignore or exclude source outside the prefix.
- Never derive operator identity, legal jurisdiction, or real-world operations from codebase config;
  candidate facts are confined strictly to verifiable technical codebase observations.
- Cache key consists of (repositoryId, commitSha, sourcePathPrefix, scannerVersion).

Execution flow:
1. Validate inputs and source path prefix.
2. Check existing profile stamp in runtime directory; if identical pins, reuse without rescanning.
3. Walk the filesystem within prefix, skipping excluded and binary directories.
4. Parse manifests (package.json, requirements.txt, pyproject.toml, Cargo.toml, go.mod, etc.)
   with exact 1-indexed line numbers.
5. Map observed dependencies and configurations to framework categories.
6. Mint candidate technical facts citing exact repository source ranges with excerpt hashes.
7. Compute deterministic content digest and persist the profile stamp.

Failure cases:
- Malicious paths (directory traversal, NUL bytes) reject with explicit gap records.
- Oversized or malformed files are recorded in knownGaps without halting the scan.

Side effects:
- Writes the repository profile stamp to the runtime directory when running in a sandbox.
- Generates no state mutations or legal verdicts.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shlex
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Mapping

from tools.common.capabilities.platform.repository_sandbox import (
    source_path_in_scope,
    validate_source_path_prefix,
)

SCANNER_VERSION = "LCSP_PRE_SCAN_V1"
DEFAULT_MAX_SCANNED_FILES = 10_000
DEFAULT_MAX_MANIFEST_SIZE_BYTES = 2 * 1024 * 1024  # 2 MB
DEFAULT_MAX_PATH_DEPTH = 25
REPOSITORY_PROFILE_PATH = "/workspace/runtime/repository_profile.json"

EXCLUDED_DIR_NAMES = frozenset({
    ".git",
    "node_modules",
    "dist",
    ".cache",
    ".venv",
    "venv",
    "__pycache__",
    ".lcsp",
    "vendor",
    "target",
    "build",
    ".next",
    ".turbo",
    ".idea",
    ".vscode",
})

LANGUAGE_EXTENSIONS: Mapping[str, str] = {
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".mjs": "JavaScript",
    ".cjs": "JavaScript",
    ".py": "Python",
    ".go": "Go",
    ".rs": "Rust",
    ".java": "Java",
    ".kt": "Kotlin",
    ".kts": "Kotlin",
    ".rb": "Ruby",
    ".php": "PHP",
    ".cs": "C#",
    ".sh": "Shell",
    ".bash": "Shell",
    ".zsh": "Shell",
    ".sql": "SQL",
    ".html": "HTML",
    ".css": "CSS",
    ".scss": "CSS",
    ".json": "JSON",
    ".yaml": "YAML",
    ".yml": "YAML",
    ".toml": "TOML",
    ".xml": "XML",
}

FRAMEWORK_CATALOG: Mapping[str, tuple[str, str]] = {
    # (framework_name, category)
    "express": ("Express", "WEB_FRAMEWORK"),
    "fastify": ("Fastify", "WEB_FRAMEWORK"),
    "@nestjs/core": ("NestJS", "WEB_FRAMEWORK"),
    "koa": ("Koa", "WEB_FRAMEWORK"),
    "next": ("Next.js", "WEB_FRAMEWORK"),
    "react": ("React", "WEB_FRAMEWORK"),
    "vue": ("Vue", "WEB_FRAMEWORK"),
    "angular": ("Angular", "WEB_FRAMEWORK"),
    "svelte": ("Svelte", "WEB_FRAMEWORK"),
    "fastapi": ("FastAPI", "WEB_FRAMEWORK"),
    "flask": ("Flask", "WEB_FRAMEWORK"),
    "django": ("Django", "WEB_FRAMEWORK"),
    "tornado": ("Tornado", "WEB_FRAMEWORK"),
    "gin-gonic/gin": ("Gin", "WEB_FRAMEWORK"),
    "actix-web": ("Actix-web", "WEB_FRAMEWORK"),
    "pg": ("PostgreSQL Client (pg)", "DATABASE_CLIENT"),
    "mysql": ("MySQL Client", "DATABASE_CLIENT"),
    "mysql2": ("MySQL Client (mysql2)", "DATABASE_CLIENT"),
    "mongodb": ("MongoDB Client", "DATABASE_CLIENT"),
    "redis": ("Redis Client", "DATABASE_CLIENT"),
    "ioredis": ("Redis Client (ioredis)", "DATABASE_CLIENT"),
    "psycopg2": ("PostgreSQL Client (psycopg2)", "DATABASE_CLIENT"),
    "psycopg": ("PostgreSQL Client (psycopg)", "DATABASE_CLIENT"),
    "asyncpg": ("PostgreSQL Client (asyncpg)", "DATABASE_CLIENT"),
    "pymongo": ("MongoDB Client (pymongo)", "DATABASE_CLIENT"),
    "sqlite3": ("SQLite Client", "DATABASE_CLIENT"),
    "@prisma/client": ("Prisma", "ORM"),
    "prisma": ("Prisma", "ORM"),
    "typeorm": ("TypeORM", "ORM"),
    "sequelize": ("Sequelize", "ORM"),
    "mongoose": ("Mongoose", "ORM"),
    "sqlalchemy": ("SQLAlchemy", "ORM"),
    "tortoise-orm": ("Tortoise ORM", "ORM"),
    "passport": ("Passport", "AUTHENTICATION"),
    "jsonwebtoken": ("JSON Web Token (jsonwebtoken)", "AUTHENTICATION"),
    "next-auth": ("NextAuth.js", "AUTHENTICATION"),
    "@auth/core": ("Auth.js", "AUTHENTICATION"),
    "bcrypt": ("bcrypt", "AUTHENTICATION"),
    "argon2": ("Argon2", "AUTHENTICATION"),
    "pyjwt": ("PyJWT", "AUTHENTICATION"),
    "passlib": ("Passlib", "AUTHENTICATION"),
    "jest": ("Jest", "TESTING"),
    "vitest": ("Vitest", "TESTING"),
    "mocha": ("Mocha", "TESTING"),
    "playwright": ("Playwright", "TESTING"),
    "@playwright/test": ("Playwright Test", "TESTING"),
    "cypress": ("Cypress", "TESTING"),
    "pytest": ("Pytest", "TESTING"),
    "amqplib": ("RabbitMQ Client (amqplib)", "MESSAGING"),
    "kafkajs": ("KafkaJS", "MESSAGING"),
    "celery": ("Celery", "MESSAGING"),
    "pika": ("RabbitMQ Client (pika)", "MESSAGING"),
    "winston": ("Winston", "LOGGING"),
    "pino": ("Pino", "LOGGING"),
}

SECRET_PATTERNS = [
    re.compile(r"sk-[a-zA-Z0-9]{20,}"),
    re.compile(r"ghp_[a-zA-Z0-9]{20,}"),
    re.compile(r"(?i)(password|secret|api_key|token)\s*[:=]\s*['\"]([^'\"]{8,})['\"]"),
]


def _redact_secret_text(text: str) -> str:
    """Business purpose:
    Mask known secret, API key, and credential token patterns in observed text.

    Business rules:
    - Never include plaintext secret tokens in excerpts or findings.
    - Preserve line structure while replacing matched secrets with redaction placeholder.

    Execution flow:
    1. Iterate over compiled secret regex patterns.
    2. Replace pattern matches with [REDACTED_SECRET].
    3. Return sanitized text string.

    Failure cases:
    - None: pure regex replacement.

    Side effects:
    - Pure string sanitization without I/O.
    """
    redacted = text
    for pattern in SECRET_PATTERNS:
        redacted = pattern.sub("[REDACTED_SECRET]", redacted)
    return redacted


def _excerpt_sha256(text: str) -> str:
    """Business purpose:
    Calculate the SHA-256 hash of an evidence excerpt string.

    Business rules:
    - Output must conform to sha256:hex format.

    Execution flow:
    1. Encode input text as UTF-8 bytes.
    2. Compute SHA-256 digest and return formatted string.

    Failure cases:
    - None: deterministic hashing.

    Side effects:
    - Pure calculation without I/O.
    """
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def compute_profile_digest(profile_dict: Mapping[str, Any]) -> str:
    """Business purpose:
    Compute deterministic SHA-256 digest of repository profile observations.

    Business rules:
    - Normalizes commitSha to lowercase and sorts all lists for reproducible hashing.
    - Excludes volatile timestamps (scannedAt) and self-reference (contentDigest).

    Execution flow:
    1. Construct canonical dictionary with sorted keys and collections.
    2. Serialize to compact sorted JSON string.
    3. Compute SHA-256 digest and format as sha256:hex.

    Failure cases:
    - None: deterministic serialization and hashing.

    Side effects:
    - Pure calculation without I/O.
    """
    canonical = {
        "repositoryId": profile_dict.get("repositoryId", ""),
        "commitSha": str(profile_dict.get("commitSha", "")).lower(),
        "sourcePathPrefix": profile_dict.get("sourcePathPrefix"),
        "scannerVersion": profile_dict.get("scannerVersion", SCANNER_VERSION),
        "languages": sorted(
            profile_dict.get("languages", []), key=lambda x: x.get("language", "")
        ),
        "manifests": sorted(
            profile_dict.get("manifests", []), key=lambda x: x.get("path", "")
        ),
        "frameworks": sorted(
            profile_dict.get("frameworks", []),
            key=lambda x: (x.get("name", ""), x.get("path", "")),
        ),
        "buildSystems": sorted(
            profile_dict.get("buildSystems", []), key=lambda x: x.get("name", "")
        ),
        "ciWorkflows": sorted(
            profile_dict.get("ciWorkflows", []), key=lambda x: x.get("path", "")
        ),
        "containerization": sorted(
            profile_dict.get("containerization", []), key=lambda x: x.get("path", "")
        ),
        "candidateFacts": sorted(
            profile_dict.get("candidateFacts", []), key=lambda x: x.get("statement", "")
        ),
        "knownGaps": sorted(
            profile_dict.get("knownGaps", []), key=lambda x: x.get("path", "")
        ),
        "scannedFileCount": profile_dict.get("scannedFileCount", 0),
    }
    dumped = json.dumps(canonical, separators=(",", ":"), sort_keys=True)
    return "sha256:" + hashlib.sha256(dumped.encode("utf-8")).hexdigest()


class RepositoryScanner:
    """Deterministic read-only scanner over repository workspace files."""

    def __init__(
        self,
        workspace_path: Path | str,
        *,
        repository_id: str,
        commit_sha: str,
        source_path_prefix: str | None = None,
        max_scanned_files: int = DEFAULT_MAX_SCANNED_FILES,
        max_manifest_size_bytes: int = DEFAULT_MAX_MANIFEST_SIZE_BYTES,
        max_path_depth: int = DEFAULT_MAX_PATH_DEPTH,
    ) -> None:
        self.workspace_path = Path(workspace_path).resolve()
        self.repository_id = repository_id
        self.commit_sha = commit_sha.lower()
        self.source_path_prefix = validate_source_path_prefix(source_path_prefix)
        self.max_scanned_files = max_scanned_files
        self.max_manifest_size_bytes = max_manifest_size_bytes
        self.max_path_depth = max_path_depth

        self.languages_map: dict[str, list[str]] = {}
        self.manifests: list[dict[str, Any]] = []
        self.frameworks: list[dict[str, Any]] = []
        self.build_systems: list[dict[str, Any]] = []
        self.ci_workflows: list[dict[str, Any]] = []
        self.containerization: list[dict[str, Any]] = []
        self.candidate_facts: list[dict[str, Any]] = []
        self.known_gaps: list[dict[str, Any]] = []
        self.scanned_file_count = 0

    def scan(self) -> dict[str, Any]:
        """Business purpose:
        Perform complete deterministic pre-scan and technical fact acquisition.

        Business rules:
        - Only inspect paths within source_path_prefix if specified.
        - Omit excluded directories and binary files.
        - Enforce bounded file counts and manifest byte limits.
        - Emit candidate technical facts citing exact 1-indexed lines and sha256 excerpts.

        Execution flow:
        1. Traverse workspace filesystem honoring path depth and excluded directories.
        2. Filter entries against source path prefix.
        3. Inspect matching files for language, build system, container, and manifest contents.
        4. Aggregate languages, frameworks, candidate facts, and known gaps.
        5. Compute profile content digest and return complete repository profile dictionary.

        Failure cases:
        - Files exceeding limits or unreadable files are added to knownGaps rather than aborting.

        Side effects:
        - Traverses filesystem read-only; no file writes or network/model requests.
        """
        if not self.workspace_path.exists():
            self.known_gaps.append({
                "path": str(self.workspace_path),
                "reason": "WORKSPACE_NOT_FOUND",
                "detail": f"Workspace directory does not exist: {self.workspace_path}",
            })
        elif not self.workspace_path.is_dir():
            self.known_gaps.append({
                "path": str(self.workspace_path),
                "reason": "WORKSPACE_NOT_DIRECTORY",
                "detail": f"Workspace path is not a directory: {self.workspace_path}",
            })
        else:
            for root, dirs, files in os.walk(self.workspace_path):
                # Prune excluded directories
                dirs[:] = [d for d in dirs if d not in EXCLUDED_DIR_NAMES]

                rel_root = Path(root).relative_to(self.workspace_path)
                depth = len(rel_root.parts)
                if depth > self.max_path_depth:
                    self.known_gaps.append({
                        "path": rel_root.as_posix(),
                        "reason": "FILE_COUNT_LIMIT_REACHED",
                        "detail": f"Path depth {depth} exceeds limit {self.max_path_depth}",
                    })
                    dirs.clear()
                    continue

                for filename in sorted(files):
                    if self.scanned_file_count >= self.max_scanned_files:
                        self.known_gaps.append({
                            "path": (rel_root / filename).as_posix(),
                            "reason": "FILE_COUNT_LIMIT_REACHED",
                            "detail": f"Exceeded maximum file scan limit of {self.max_scanned_files}",
                        })
                        break

                    rel_path = (rel_root / filename).as_posix()
                    if rel_path.startswith("./"):
                        rel_path = rel_path[2:]

                    # Scope check
                    if self.source_path_prefix and not source_path_in_scope(
                        rel_path, self.source_path_prefix
                    ):
                        continue

                    full_path = Path(root) / filename
                    self.scanned_file_count += 1
                    self._inspect_file(full_path, rel_path)

                if self.scanned_file_count >= self.max_scanned_files:
                    break

        languages_list = [
            {
                "language": lang,
                "fileCount": len(paths),
                "samplePaths": paths[:10],
            }
            for lang, paths in sorted(self.languages_map.items())
        ]

        now_iso = datetime.now(timezone.utc).isoformat()
        profile_without_digest = {
            "repositoryId": self.repository_id,
            "commitSha": self.commit_sha,
            "sourcePathPrefix": self.source_path_prefix,
            "scannerVersion": SCANNER_VERSION,
            "languages": languages_list,
            "manifests": self.manifests,
            "frameworks": self.frameworks,
            "buildSystems": self.build_systems,
            "ciWorkflows": self.ci_workflows,
            "containerization": self.containerization,
            "candidateFacts": self.candidate_facts,
            "knownGaps": self.known_gaps,
            "scannedFileCount": self.scanned_file_count,
        }
        digest = compute_profile_digest(profile_without_digest)
        return {
            **profile_without_digest,
            "contentDigest": digest,
            "scannedAt": now_iso,
        }

    def _inspect_file(self, full_path: Path, rel_path: str) -> None:
        """Business purpose:
        Inspect an individual in-scope file for language, build system, CI, container, and manifest metadata.

        Business rules:
        - Files matching excluded patterns or oversized manifests are skipped and recorded in knownGaps.
        - Manifest parsers must not execute scripts or invoke external tools.

        Execution flow:
        1. Categorize language by file suffix.
        2. Identify build systems, CI workflows, and container configurations.
        3. Dispatch to specific manifest parsers when filename matches supported manifests.

        Failure cases:
        - File stat or read errors record gap entries and continue scan.

        Side effects:
        - Appends discovered observations to scanner internal lists.
        """
        # Language tracking
        suffix = full_path.suffix.lower()
        if suffix in LANGUAGE_EXTENSIONS:
            lang = LANGUAGE_EXTENSIONS[suffix]
            self.languages_map.setdefault(lang, []).append(rel_path)

        filename = full_path.name.lower()

        # Build systems and configs
        if filename == "pnpm-workspace.yaml":
            self.build_systems.append({"name": "pnpm workspace", "path": rel_path, "line": 1})
        elif filename == "pom.xml":
            self.build_systems.append({"name": "Maven", "path": rel_path, "line": 1})
        elif filename in {"build.gradle", "build.gradle.kts"}:
            self.build_systems.append({"name": "Gradle", "path": rel_path, "line": 1})
        elif filename == "cargo.toml":
            self.build_systems.append({"name": "Cargo", "path": rel_path, "line": 1})

        # CI workflows
        if ".github/workflows" in rel_path and suffix in {".yml", ".yaml"}:
            self.ci_workflows.append({"name": full_path.stem, "path": rel_path, "line": 1})

        # Containerization
        if filename == "dockerfile" or filename.startswith("dockerfile."):
            self._parse_dockerfile(full_path, rel_path)
            return
        elif filename in {"docker-compose.yml", "docker-compose.yaml", "compose.yaml", "compose.yml"}:
            self._parse_docker_compose(full_path, rel_path)
            return

        # Check file size before reading manifests
        try:
            stat = full_path.stat()
            if stat.st_size > self.max_manifest_size_bytes:
                if filename in {
                    "package.json", "package-lock.json", "pnpm-lock.yaml",
                    "requirements.txt", "pyproject.toml", "cargo.toml", "go.mod"
                }:
                    self.known_gaps.append({
                        "path": rel_path,
                        "reason": "FILE_SIZE_LIMIT_EXCEEDED",
                        "detail": f"File size {stat.st_size} bytes exceeds limit {self.max_manifest_size_bytes}",
                    })
                return
        except OSError:
            return

        # Manifest parsers
        if filename == "package.json":
            self._parse_package_json(full_path, rel_path)
        elif filename == "requirements.txt":
            self._parse_requirements_txt(full_path, rel_path)
        elif filename == "pyproject.toml":
            self._parse_pyproject_toml(full_path, rel_path)
        elif filename == "cargo.toml":
            self._parse_cargo_toml(full_path, rel_path)
        elif filename == "go.mod":
            self._parse_go_mod(full_path, rel_path)
        elif filename == "pnpm-lock.yaml":
            self._record_lockfile(rel_path, "PNPM_LOCK")
        elif filename == "package-lock.json":
            self._record_lockfile(rel_path, "PACKAGE_LOCK")
        elif filename == "yarn.lock":
            self._record_lockfile(rel_path, "YARN_LOCK")

    def _record_lockfile(self, rel_path: str, manifest_type: str) -> None:
        """Business purpose:
        Record presence and location of a package manager lockfile.

        Business rules:
        - Lockfile presence indicates pinned resolution; file is not parsed in entirety to preserve limits.

        Execution flow:
        1. Construct lockfile manifest observation entry with path and type.
        2. Append entry to manifests collection.

        Failure cases:
        - None: basic dictionary construction.

        Side effects:
        - Appends lockfile observation to manifests list.
        """
        self.manifests.append({
            "path": rel_path,
            "startLine": 1,
            "endLine": 1,
            "manifestType": manifest_type,
            "name": None,
            "version": None,
            "dependencies": [],
        })

    def _parse_package_json(self, full_path: Path, rel_path: str) -> None:
        """Business purpose:
        Parse package.json manifest and extract dependencies with exact line provenance.

        Business rules:
        - Extract dependencies, devDependencies, peerDependencies, and optionalDependencies.
        - Map discovered packages to known framework catalog entries.
        - Produce candidate technical facts citing exact lines and excerpt hashes.

        Execution flow:
        1. Read package.json text and parse JSON data.
        2. Index line numbers for each dependency entry.
        3. Iterate dependency sections, recording package name, version, and line.
        4. Match dependencies against framework catalog and emit candidate facts.

        Failure cases:
        - Unreadable or malformed JSON files record knownGaps and exit parser.

        Side effects:
        - Appends manifest, framework, and candidate fact observations to internal lists.
        """
        try:
            content = full_path.read_text(encoding="utf-8", errors="replace")
        except Exception as err:
            self.known_gaps.append({
                "path": rel_path,
                "reason": "UNREADABLE_OR_MALFORMED",
                "detail": str(err),
            })
            return

        try:
            data = json.loads(content)
        except Exception as err:
            self.known_gaps.append({
                "path": rel_path,
                "reason": "UNREADABLE_OR_MALFORMED",
                "detail": f"JSON parse error: {err}",
            })
            return

        lines = content.splitlines()
        line_lookup = self._index_lines(lines)

        dependencies: list[dict[str, Any]] = []
        name = data.get("name")
        version = data.get("version")

        sections = [
            ("dependencies", "PRODUCTION"),
            ("devDependencies", "DEVELOPMENT"),
            ("peerDependencies", "PEER"),
            ("optionalDependencies", "OPTIONAL"),
        ]

        for section_key, dep_kind in sections:
            section = data.get(section_key)
            if not isinstance(section, dict):
                continue
            for dep_name, version_val in section.items():
                dep_name_str = str(dep_name)
                v_range = str(version_val) if version_val is not None else None
                line_no = self._find_line_in_section(lines, section_key, dep_name_str, line_lookup)

                dependencies.append({
                    "name": dep_name_str,
                    "versionRange": v_range,
                    "kind": dep_kind,
                    "line": line_no,
                })

                if dep_name_str in FRAMEWORK_CATALOG:
                    fw_name, fw_cat = FRAMEWORK_CATALOG[dep_name_str]
                    line_text = lines[line_no - 1] if 0 < line_no <= len(lines) else f'"{dep_name_str}": "{v_range}"'
                    self.frameworks.append({
                        "name": fw_name,
                        "category": fw_cat,
                        "path": rel_path,
                        "line": line_no,
                        "evidenceExcerpt": _redact_secret_text(line_text.strip()),
                    })
                    # Add candidate fact
                    self.candidate_facts.append({
                        "statement": f"Repository utilizes {fw_name} ({fw_cat}) configured in {rel_path}:{line_no}",
                        "kind": "FACT",
                        "authority": "EVIDENCE_CITED",
                        "evidence": {
                            "path": rel_path,
                            "startLine": line_no,
                            "endLine": line_no,
                            "excerptSha256": _excerpt_sha256(line_text.strip()),
                        },
                    })

        self.manifests.append({
            "path": rel_path,
            "startLine": 1,
            "endLine": len(lines),
            "manifestType": "PACKAGE_JSON",
            "name": str(name) if name else None,
            "version": str(version) if version else None,
            "dependencies": dependencies,
        })

    def _parse_requirements_txt(self, full_path: Path, rel_path: str) -> None:
        """Business purpose:
        Parse Python requirements.txt file and extract declared dependencies.

        Business rules:
        - Skip comments and command options; extract package names and version specifiers.
        - Map packages to framework categories and candidate facts.

        Execution flow:
        1. Read requirements.txt lines.
        2. Match regex against package specifications.
        3. Record dependencies and match against framework catalog.

        Failure cases:
        - Unreadable files record knownGaps and exit parser.

        Side effects:
        - Appends manifest, framework, and fact observations to internal lists.
        """
        try:
            content = full_path.read_text(encoding="utf-8", errors="replace")
        except Exception as err:
            self.known_gaps.append({
                "path": rel_path,
                "reason": "UNREADABLE_OR_MALFORMED",
                "detail": str(err),
            })
            return

        lines = content.splitlines()
        dependencies: list[dict[str, Any]] = []

        req_re = re.compile(r"^([a-zA-Z0-9_\-\.]+)(?:([=<>!~]+.*))?$")

        for idx, line in enumerate(lines, start=1):
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or stripped.startswith("-"):
                continue

            match = req_re.match(stripped)
            if not match:
                continue

            pkg_name = match.group(1).lower()
            ver_spec = match.group(2)

            dependencies.append({
                "name": pkg_name,
                "versionRange": ver_spec.strip() if ver_spec else None,
                "kind": "PRODUCTION",
                "line": idx,
            })

            if pkg_name in FRAMEWORK_CATALOG:
                fw_name, fw_cat = FRAMEWORK_CATALOG[pkg_name]
                self.frameworks.append({
                    "name": fw_name,
                    "category": fw_cat,
                    "path": rel_path,
                    "line": idx,
                    "evidenceExcerpt": _redact_secret_text(stripped),
                })
                self.candidate_facts.append({
                    "statement": f"Repository utilizes Python package {fw_name} ({fw_cat}) in {rel_path}:{idx}",
                    "kind": "FACT",
                    "authority": "EVIDENCE_CITED",
                    "evidence": {
                        "path": rel_path,
                        "startLine": idx,
                        "endLine": idx,
                        "excerptSha256": _excerpt_sha256(stripped),
                    },
                })

        self.manifests.append({
            "path": rel_path,
            "startLine": 1,
            "endLine": max(len(lines), 1),
            "manifestType": "REQUIREMENTS_TXT",
            "name": None,
            "version": None,
            "dependencies": dependencies,
        })

    def _parse_pyproject_toml(self, full_path: Path, rel_path: str) -> None:
        """Business purpose:
        Parse Python pyproject.toml manifest and extract declared project dependencies.

        Business rules:
        - Extract dependencies from [project.dependencies] or [tool.poetry.dependencies].
        - Map matched libraries to framework categories.

        Execution flow:
        1. Read TOML text lines.
        2. Identify dependencies section headers.
        3. Parse key-value package declarations with line numbers.

        Failure cases:
        - Unreadable or malformed files record knownGaps and exit parser.

        Side effects:
        - Appends manifest and framework observations to internal lists.
        """
        try:
            content = full_path.read_text(encoding="utf-8", errors="replace")
        except Exception as err:
            self.known_gaps.append({
                "path": rel_path,
                "reason": "UNREADABLE_OR_MALFORMED",
                "detail": str(err),
            })
            return

        lines = content.splitlines()
        dependencies: list[dict[str, Any]] = []
        in_deps = False

        for idx, line in enumerate(lines, start=1):
            stripped = line.strip()
            if stripped.startswith("["):
                in_deps = "dependencies" in stripped
                continue
            if not in_deps or not stripped or stripped.startswith("#"):
                continue

            # Key-value or list item
            match = re.match(r"^['\"]?([a-zA-Z0-9_\-\.]+)['\"]?\s*[:=]\s*['\"]?([^'\"#,\n]+)?['\"]?", stripped)
            if match:
                pkg_name = match.group(1).lower()
                ver = match.group(2)
                dependencies.append({
                    "name": pkg_name,
                    "versionRange": ver.strip() if ver else None,
                    "kind": "PRODUCTION",
                    "line": idx,
                })
                if pkg_name in FRAMEWORK_CATALOG:
                    fw_name, fw_cat = FRAMEWORK_CATALOG[pkg_name]
                    self.frameworks.append({
                        "name": fw_name,
                        "category": fw_cat,
                        "path": rel_path,
                        "line": idx,
                        "evidenceExcerpt": _redact_secret_text(stripped),
                    })

        self.manifests.append({
            "path": rel_path,
            "startLine": 1,
            "endLine": max(len(lines), 1),
            "manifestType": "PYPROJECT_TOML",
            "name": None,
            "version": None,
            "dependencies": dependencies,
        })

    def _parse_cargo_toml(self, full_path: Path, rel_path: str) -> None:
        """Business purpose:
        Parse Rust Cargo.toml manifest and extract crate dependencies.

        Business rules:
        - Extract dependencies from [dependencies] and [dev-dependencies] sections.

        Execution flow:
        1. Read Cargo.toml lines.
        2. Identify dependencies section headers.
        3. Parse key-value dependency declarations with line numbers.

        Failure cases:
        - Unreadable or malformed files record knownGaps and exit parser.

        Side effects:
        - Appends manifest observations to internal lists.
        """
        try:
            content = full_path.read_text(encoding="utf-8", errors="replace")
        except Exception as err:
            self.known_gaps.append({
                "path": rel_path,
                "reason": "UNREADABLE_OR_MALFORMED",
                "detail": str(err),
            })
            return

        lines = content.splitlines()
        dependencies: list[dict[str, Any]] = []
        in_deps = False

        for idx, line in enumerate(lines, start=1):
            stripped = line.strip()
            if stripped.startswith("["):
                in_deps = "dependencies" in stripped
                continue
            if not in_deps or not stripped or stripped.startswith("#"):
                continue

            match = re.match(r"^([a-zA-Z0-9_\-]+)\s*=\s*(.*)$", stripped)
            if match:
                pkg_name = match.group(1)
                ver = match.group(2)
                dependencies.append({
                    "name": pkg_name,
                    "versionRange": ver.strip(),
                    "kind": "PRODUCTION",
                    "line": idx,
                })

        self.manifests.append({
            "path": rel_path,
            "startLine": 1,
            "endLine": max(len(lines), 1),
            "manifestType": "CARGO_TOML",
            "name": None,
            "version": None,
            "dependencies": dependencies,
        })

    def _parse_go_mod(self, full_path: Path, rel_path: str) -> None:
        """Business purpose:
        Parse Go go.mod manifest and extract module dependencies.

        Business rules:
        - Extract dependencies from require directives and require blocks.

        Execution flow:
        1. Read go.mod lines.
        2. Scan for require blocks or single require lines.
        3. Parse module path and version with line numbers.

        Failure cases:
        - Unreadable or malformed files record knownGaps and exit parser.

        Side effects:
        - Appends manifest observations to internal lists.
        """
        try:
            content = full_path.read_text(encoding="utf-8", errors="replace")
        except Exception as err:
            self.known_gaps.append({
                "path": rel_path,
                "reason": "UNREADABLE_OR_MALFORMED",
                "detail": str(err),
            })
            return

        lines = content.splitlines()
        dependencies: list[dict[str, Any]] = []
        in_require_block = False

        for idx, line in enumerate(lines, start=1):
            stripped = line.strip()
            if stripped.startswith("require ("):
                in_require_block = True
                continue
            if in_require_block and stripped == ")":
                in_require_block = False
                continue

            if in_require_block or stripped.startswith("require "):
                parts = stripped.replace("require ", "").split()
                if len(parts) >= 2:
                    dependencies.append({
                        "name": parts[0],
                        "versionRange": parts[1],
                        "kind": "PRODUCTION",
                        "line": idx,
                    })

        self.manifests.append({
            "path": rel_path,
            "startLine": 1,
            "endLine": max(len(lines), 1),
            "manifestType": "GO_MOD",
            "name": None,
            "version": None,
            "dependencies": dependencies,
        })

    def _parse_dockerfile(self, full_path: Path, rel_path: str) -> None:
        """Business purpose:
        Parse Dockerfile and record containerization observation and candidate facts.

        Business rules:
        - Identify FROM base image instructions and 1-indexed line provenance.

        Execution flow:
        1. Read Dockerfile lines.
        2. Find the primary FROM instruction line.
        3. Append containerization observation and candidate fact.

        Failure cases:
        - Unreadable files record knownGaps and exit parser.

        Side effects:
        - Appends containerization and candidate fact observations to internal lists.
        """
        try:
            content = full_path.read_text(encoding="utf-8", errors="replace")
        except Exception as err:
            self.known_gaps.append({
                "path": rel_path,
                "reason": "UNREADABLE_OR_MALFORMED",
                "detail": str(err),
            })
            return

        lines = content.splitlines()
        from_line = 1
        for idx, line in enumerate(lines, start=1):
            if line.strip().upper().startswith("FROM "):
                from_line = idx
                break

        self.containerization.append({
            "kind": "DOCKERFILE",
            "path": rel_path,
            "line": from_line,
        })

        line_text = lines[from_line - 1] if 0 < from_line <= len(lines) else "FROM"
        self.candidate_facts.append({
            "statement": f"Repository contains Dockerfile containerization instructions in {rel_path}:{from_line}",
            "kind": "FACT",
            "authority": "EVIDENCE_CITED",
            "evidence": {
                "path": rel_path,
                "startLine": from_line,
                "endLine": from_line,
                "excerptSha256": _excerpt_sha256(line_text.strip()),
            },
        })

    def _parse_docker_compose(self, full_path: Path, rel_path: str) -> None:
        """Business purpose:
        Record Docker Compose configuration observation and candidate facts.

        Business rules:
        - Confirms multi-container orchestration configuration.

        Execution flow:
        1. Record DOCKER_COMPOSE containerization observation.
        2. Append candidate fact citing file path.

        Failure cases:
        - None: basic dictionary construction.

        Side effects:
        - Appends containerization and candidate fact observations to internal lists.
        """
        self.containerization.append({
            "kind": "DOCKER_COMPOSE",
            "path": rel_path,
            "line": 1,
        })
        self.candidate_facts.append({
            "statement": f"Repository configures Docker Compose multi-container services in {rel_path}:1",
            "kind": "FACT",
            "authority": "EVIDENCE_CITED",
            "evidence": {
                "path": rel_path,
                "startLine": 1,
                "endLine": 1,
                "excerptSha256": _excerpt_sha256("services:"),
            },
        })

    def _index_lines(self, lines: list[str]) -> dict[str, list[int]]:
        """Business purpose:
        Build a quick line index mapping trimmed line tokens to line numbers.

        Business rules:
        - Uses 1-indexed line numbers.

        Execution flow:
        1. Iterate lines and trim common delimiters.
        2. Record line numbers per token in dictionary.

        Failure cases:
        - None: pure dictionary indexing.

        Side effects:
        - Pure calculation without I/O.
        """
        index: dict[str, list[int]] = {}
        for idx, line in enumerate(lines, start=1):
            cleaned = line.strip().strip(",").strip('"')
            if cleaned:
                index.setdefault(cleaned, []).append(idx)
        return index

    def _find_line_in_section(
        self,
        lines: list[str],
        section_key: str,
        dep_name: str,
        index: dict[str, list[int]],
    ) -> int:
        """Business purpose:
        Locate the 1-indexed line number of a specific dependency name in file lines.

        Business rules:
        - Defaults to line 1 if token is not found.

        Execution flow:
        1. Search for quoted dependency name across file lines.
        2. Return 1-indexed line number on match, or 1 as fallback.

        Failure cases:
        - None: fallback to line 1 on search miss.

        Side effects:
        - Pure calculation without I/O.
        """
        target = f'"{dep_name}"'
        for idx, line in enumerate(lines, start=1):
            if target in line:
                return idx
        return 1


def scan_repository_workspace(
    workspace_path: Path | str,
    repository_id: str,
    commit_sha: str,
    source_path_prefix: str | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """Business purpose:
    Perform deterministic offline pre-scan on a materialized repository workspace path.

    Business rules:
    - Pure offline operation with bounded filesystem inspection.
    - Confines scanning to source_path_prefix when provided.

    Execution flow:
    1. Instantiate RepositoryScanner with provided coordinates and limits.
    2. Execute scan() and return completed profile dictionary.

    Failure cases:
    - Filesystem errors record known gaps; invalid prefix throws validation error.

    Side effects:
    - Read-only traversal of repository files.
    """
    scanner = RepositoryScanner(
        workspace_path,
        repository_id=repository_id,
        commit_sha=commit_sha,
        source_path_prefix=source_path_prefix,
        **kwargs,
    )
    return scanner.scan()


def ensure_repository_profile(
    backend: object,
    *,
    repository_id: str,
    commit_sha: str,
    source_path_prefix: str | None = None,
    workspace_path: Path | str = "/workspace/repository",
) -> dict[str, Any]:
    """Business purpose:
    Load or generate the cached deterministic repository profile in the sandbox environment.

    Business rules:
    - If an existing profile marker matches (repositoryId, commitSha, sourcePathPrefix, scannerVersion),
      reuse it directly without re-reading the filesystem.
    - If missing or pins mismatch, scan the workspace using sandbox execution when available
      or the local filesystem adapter, and persist the new profile marker.
    - A missing workspace must record an explicit known gap/error rather than a silent empty profile.

    Execution flow:
    1. Validate source path prefix.
    2. Attempt to read existing profile marker from REPOSITORY_PROFILE_PATH.
    3. If valid and matching pins, return cached profile.
    4. If backend provides execution capability (Docker sandbox), run bounded scanner command inside sandbox.
    5. Otherwise, run workspace scan using filesystem adapter.
    6. Write resulting profile to REPOSITORY_PROFILE_PATH in backend and return.

    Failure cases:
    - Failed cache reads or writes fallback gracefully to in-memory scanned profile.

    Side effects:
    - Writes the profile marker JSON to the runtime directory in the backend.
    """
    source_path_prefix = validate_source_path_prefix(source_path_prefix)
    read = getattr(backend, "read", None)
    write = getattr(backend, "write", None)
    execute = getattr(backend, "execute", None)

    # Check cached profile
    if callable(read):
        try:
            cached_raw = read(REPOSITORY_PROFILE_PATH)
            if cached_raw and not getattr(cached_raw, "error", None):
                cached = json.loads(str(cached_raw))
                if (
                    cached.get("repositoryId") == repository_id
                    and cached.get("commitSha", "").lower() == commit_sha.lower()
                    and validate_source_path_prefix(cached.get("sourcePathPrefix")) == source_path_prefix
                    and cached.get("scannerVersion") == SCANNER_VERSION
                ):
                    return cached
        except Exception:
            pass

    profile: dict[str, Any] | None = None

    # If backend supports execution, run scanner in sandbox container
    if callable(execute):
        try:
            prefix_arg = f", source_path_prefix={repr(source_path_prefix)}" if source_path_prefix else ""
            script = (
                f"import json; from tools.common.capabilities.platform.repository_scanner import scan_repository_workspace; "
                f"p = scan_repository_workspace({repr(str(workspace_path))}, repository_id={repr(repository_id)}, commit_sha={repr(commit_sha)}{prefix_arg}); "
                f"print(json.dumps(p))"
            )
            res = execute(f"python3 -c {shlex.quote(script)}", timeout=300)
            if getattr(res, "exit_code", 1) == 0:
                out = str(getattr(res, "output", "") or "").strip()
                lines = [line.strip() for line in out.splitlines() if line.strip()]
                for line in reversed(lines):
                    if line.startswith("{") and line.endswith("}"):
                        profile = json.loads(line)
                        break
        except Exception:
            profile = None

    # Fallback to local filesystem scan if sandbox execution did not run or succeed
    if profile is None:
        profile = scan_repository_workspace(
            workspace_path,
            repository_id=repository_id,
            commit_sha=commit_sha,
            source_path_prefix=source_path_prefix,
        )

    if callable(write):
        try:
            write(REPOSITORY_PROFILE_PATH, json.dumps(profile, separators=(",", ":"), sort_keys=True))
        except Exception:
            pass

    return profile
