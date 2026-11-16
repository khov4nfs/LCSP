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
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Mapping

SCANNER_VERSION = "LCSP_PRE_SCAN_V1"
DEFAULT_MAX_SCANNED_FILES = 10_000
DEFAULT_MAX_MANIFEST_SIZE_BYTES = 2 * 1024 * 1024  # 2 MB
DEFAULT_MAX_PATH_DEPTH = 25
REPOSITORY_PROFILE_PATH = "/workspace/runtime/repository_profile.json"
REPOSITORY_DISCOVERY_PATH = "/workspace/runtime/repository_discovery.json"
DISCOVERY_VERSION = "LCSP_DISCOVERY_V1"
DEFAULT_MAX_DISCOVERY_SOURCE_SIZE_BYTES = 1024 * 1024
DEFAULT_MAX_DISCOVERY_TOTAL_BYTES = 64 * 1024 * 1024
DEFAULT_MAX_DISCOVERY_GRAPH_TRACES = 50
DEFAULT_DISCOVERY_GRAPH_TRACE_DEPTH = 3
DEFAULT_DISCOVERY_GRAPH_RESULT_LIMIT = 100
DEFAULT_DISCOVERY_GRAPH_OUTPUT_TOKENS = 4_000
_TMP_SCANNER_PATH = "/tmp/.lcsp_scanner.py"

PROFILE_COLLECTION_LIMITS: Mapping[str, int] = {
    "languages": 100,
    "manifests": 500,
    "frameworks": 500,
    "buildSystems": 100,
    "ciWorkflows": 200,
    "containerization": 100,
    "candidateFacts": 500,
    "knownGaps": 1_000,
}
PROFILE_MANIFEST_DEPENDENCY_LIMIT = 5_000

_DISCOVERY_PROVIDER_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("OpenAI", re.compile(r"(?:from\s+['\"]openai['\"]|import\s+OpenAI|from\s+openai\s+import|openai\.)", re.I)),
    ("Anthropic", re.compile(r"(?:@anthropic-ai/sdk|from\s+anthropic\s+import|anthropic\.)", re.I)),
    ("Google AI", re.compile(r"(?:@google/(?:genai|generative-ai)|google\.generativeai|google\.genai)", re.I)),
    ("LangChain", re.compile(r"(?:langchain|@langchain/)")),
    ("Hugging Face", re.compile(r"(?:@huggingface/transformers|transformers\s+import|huggingface_hub)")),
    ("TensorFlow", re.compile(r"(?:@tensorflow/tfjs|tensorflow|\btf\.)", re.I)),
    ("PyTorch", re.compile(r"(?:from\s+torch\s+import|import\s+torch|\btorch\.)")),
    ("AI SDK", re.compile(r"(?:from\s+['\"]ai['\"]|@ai-sdk/|require\(['\"]ai['\"]\))")),
)

_DISCOVERY_DIRECT_CALL_PATTERN = re.compile(
    r"(?:responses\.create|chat\.completions\.create|messages\.create|"
    r"generateText\s*\(|streamText\s*\(|generateObject\s*\(|"
    r"generate_content\s*\(|pipeline\s*\(|"
    r"api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com)",
    re.I,
)

_DISCOVERY_HTTP_CLIENT_PATTERN = re.compile(
    r"(?:\bfetch\s*\(|\baxios\.(?:post|request)\s*\(|"
    r"\brequests\.(?:post|request)\s*\(|\bhttpx\.(?:post|request)\s*\()",
    re.I,
)

_DISCOVERY_CUSTOM_AI_ENDPOINT_PATTERN = re.compile(
    r"(?:AI[_-]?GATEWAY|LLM[_-]?GATEWAY|MODEL[_-]?ENDPOINT|"
    r"/v\d+/(?:chat/)?completions|/v\d+/responses|/v\d+/messages|"
    r"/(?:generate|inference)(?:/|['\"`]))",
    re.I,
)

_DISCOVERY_WRAPPER_CALL_PATTERN = re.compile(
    r"(?:llm|model|chain|agent|gateway|completion|inference)[\w.$]*\."
    r"(?:invoke|ainvoke|predict|generate)\s*\(",
    re.I,
)

_DISCOVERY_CONFIGURATION_PATTERN = re.compile(
    r"(?:openai|anthropic|langchain|huggingface|generative[_-]?ai|"
    r"[\"']?(?:llm|model(?:[_-]?(?:name|id|provider))?)[\"']?\s*[:=])",
    re.I,
)

_DISCOVERY_CONTROL_PATTERNS: tuple[tuple[str, re.Pattern[str], str], ...] = (
    ("DATA_PROTECTION", re.compile(r"\b(?:redact|mask|sanitize|anonymi[sz]e|pseudonymi[sz]e)\b", re.I), "AI_CONTROL"),
    ("ACCESS_CONTROL", re.compile(r"\b(?:authori[sz]e|permission|access[_ -]?control|rbac|pbac)\b", re.I), "AI_CONTROL"),
    ("AUDIT_LOGGING", re.compile(r"\b(?:audit|logger?|telemetry|trace)\b", re.I), "AI_CONTROL"),
    (
        "RETENTION",
        re.compile(
            r"\b(?:retention\w*|time[_ -]?to[_ -]?live|ttl|delete\w*|purge\w*)\b",
            re.I,
        ),
        "AI_CONTROL",
    ),
    ("HUMAN_OVERSIGHT", re.compile(r"\b(?:human[_ -]?review|approval|moderation|escalat)\w*\b", re.I), "AI_CONTROL"),
)

_DISCOVERY_DATA_FLOW_PATTERN = re.compile(
    r"\b(?:prompt|messages?|systemPrompt|userInput|modelInput|completion|modelOutput|response|result)\b",
    re.I,
)

_SOURCE_PATH_EDGE_WHITESPACE = " \t\n\v\f\r\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


def _canonical_source_path(value: object, *, maximum_length: int | None = None) -> bool:
    """Business purpose:
    Recognize an unambiguous repository-relative source path.

    Business rules:
    - Preserve literal interior spaces and Unicode; never trim or normalize.
    - Reject empty, absolute, traversal, repeated-separator and cross-platform ambiguous forms.

    Execution flow:
    1. Verify string type and canonical characters.
    2. Ensure segments do not include empty, '.', or '..'.

    Failure cases:
    - Non-canonical strings return False.

    Side effects:
    - Pure validation.
    """
    if not isinstance(value, str) or not value or value != value.strip(_SOURCE_PATH_EDGE_WHITESPACE):
        return False
    if maximum_length is not None and len(value.encode("utf-16-le", errors="surrogatepass")) // 2 > maximum_length:
        return False
    if re.search(r"[\x00-\x1f\x7f\\\\:%]", value):
        return False
    return all(segment not in {"", ".", ".."} for segment in value.split("/"))


def validate_source_path_prefix(value: object) -> str | None:
    """Business purpose:
    Validate source path prefix selection for repository scoping.

    Business rules:
    - None indicates the entire repository is selected.
    - Non-empty prefix must be a canonical relative repository path <= 1024 UTF-16 code units.

    Execution flow:
    1. If None, return None.
    2. Validate path canonical structure; raise ValueError if invalid.

    Failure cases:
    - Invalid path types or traversal syntax raise ValueError.

    Side effects:
    - Pure validation.
    """
    if value is None:
        return None
    if not _canonical_source_path(value, maximum_length=1024):
        raise ValueError("sourcePathPrefix must be a canonical repository-relative path")
    return value


def source_path_in_scope(path: str, source_path_prefix: str | None) -> bool:
    """Business purpose:
    Determine if a candidate path is within the designated source prefix scope.

    Business rules:
    - Prefix matches itself or descendants at path boundary.
    - Full repository matches everything.

    Execution flow:
    1. Check path validity.
    2. Check prefix prefixing or equality.

    Failure cases:
    - Malformed paths return False.

    Side effects:
    - Pure validation.
    """
    if path == ".":
        return source_path_prefix is None
    if not _canonical_source_path(path):
        return False
    return source_path_prefix is None or path == source_path_prefix or path.startswith(source_path_prefix + "/")


class WorkspaceNotFoundError(FileNotFoundError):
    """Business purpose:
    Typed exception raised when repository workspace path does not exist.

    Business rules:
    - Inherits from FileNotFoundError for standard filesystem exception handling.

    Execution flow:
    1. Instantiated when workspace directory is absent.

    Failure cases:
    - None.

    Side effects:
    - Pure exception type.
    """


class WorkspaceNotDirectoryError(NotADirectoryError):
    """Business purpose:
    Typed exception raised when repository workspace path exists but is not a directory.

    Business rules:
    - Inherits from NotADirectoryError for standard filesystem exception handling.

    Execution flow:
    1. Instantiated when workspace path points to a non-directory entry.

    Failure cases:
    - None.

    Side effects:
    - Pure exception type.
    """


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

# Ecosystem-specific AI aliases prevent an unrelated package with the same name
# from being classified as an AI dependency in another package registry.
NPM_AI_FRAMEWORK_CATALOG: Mapping[str, tuple[str, str]] = {
    "openai": ("OpenAI SDK", "AI_PROVIDER_SDK"),
    "@anthropic-ai/sdk": ("Anthropic SDK", "AI_PROVIDER_SDK"),
    "@google/generative-ai": ("Google Generative AI SDK", "AI_PROVIDER_SDK"),
    "@google/genai": ("Google Gen AI SDK", "AI_PROVIDER_SDK"),
    "@ai-sdk/openai": ("Vercel AI SDK OpenAI Provider", "AI_PROVIDER_SDK"),
    "@ai-sdk/anthropic": ("Vercel AI SDK Anthropic Provider", "AI_PROVIDER_SDK"),
    "@ai-sdk/google": ("Vercel AI SDK Google Provider", "AI_PROVIDER_SDK"),
    "ai": ("Vercel AI SDK", "AI_ORCHESTRATION"),
    "langchain": ("LangChain", "AI_ORCHESTRATION"),
    "@langchain/core": ("LangChain Core", "AI_ORCHESTRATION"),
    "@langchain/openai": ("LangChain OpenAI", "AI_ORCHESTRATION"),
    "@langchain/anthropic": ("LangChain Anthropic", "AI_ORCHESTRATION"),
    "@tensorflow/tfjs": ("TensorFlow.js", "ML_FRAMEWORK"),
    "@huggingface/transformers": ("Transformers.js", "ML_FRAMEWORK"),
}

PYTHON_AI_FRAMEWORK_CATALOG: Mapping[str, tuple[str, str]] = {
    "openai": ("OpenAI SDK", "AI_PROVIDER_SDK"),
    "anthropic": ("Anthropic SDK", "AI_PROVIDER_SDK"),
    "google-generativeai": ("Google Generative AI SDK", "AI_PROVIDER_SDK"),
    "google-genai": ("Google Gen AI SDK", "AI_PROVIDER_SDK"),
    "langchain": ("LangChain", "AI_ORCHESTRATION"),
    "langchain-core": ("LangChain Core", "AI_ORCHESTRATION"),
    "langchain-openai": ("LangChain OpenAI", "AI_ORCHESTRATION"),
    "langchain-anthropic": ("LangChain Anthropic", "AI_ORCHESTRATION"),
    "llama-index": ("LlamaIndex", "AI_ORCHESTRATION"),
    "tensorflow": ("TensorFlow", "ML_FRAMEWORK"),
    "torch": ("PyTorch", "ML_FRAMEWORK"),
    "transformers": ("Hugging Face Transformers", "ML_FRAMEWORK"),
    "scikit-learn": ("scikit-learn", "ML_FRAMEWORK"),
}

AI_DEPENDENCY_CATEGORIES = frozenset({
    "AI_PROVIDER_SDK",
    "AI_ORCHESTRATION",
    "ML_FRAMEWORK",
})

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


def _bounded_profile_collection(
    name: str,
    values: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Business purpose:
    Keep one RepositoryProfile collection inside its published V1 contract limit without losing coverage transparency.

    Business rules:
    - Retain deterministic scanner order up to the exact contract maximum.
    - Every omitted observation produces one explicit collection-limit gap.
    - Unknown collection names fail closed instead of inventing an unbounded default.

    Execution flow:
    1. Resolve the checked-in contract limit for the named collection.
    2. Return the original observations when already within bounds.
    3. Otherwise return the bounded prefix and one omission receipt.

    Failure cases:
    - An unknown collection raises KeyError and aborts artifact construction.

    Side effects:
    - Pure in-memory projection; source observations and scanner state are not mutated.
    """
    limit = PROFILE_COLLECTION_LIMITS[name]
    if len(values) <= limit:
        return values, None
    return values[:limit], {
        "path": "",
        "reason": "COLLECTION_LIMIT_REACHED",
        "detail": (
            f"Profile collection {name} contained {len(values)} observations; "
            f"retained the first {limit} and omitted {len(values) - limit}."
        ),
    }


def _bounded_manifest_dependencies(
    manifests: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Business purpose:
    Bound dependency observations inside each retained manifest while preserving an explicit omission record.

    Business rules:
    - Each manifest may expose at most the V1 contract's 5,000 dependency rows.
    - Manifest identity and source lines remain unchanged; only excess dependency rows are omitted.
    - The input manifest dictionaries are never mutated.

    Execution flow:
    1. Inspect each retained manifest's dependency collection.
    2. Copy and truncate only manifests that exceed the contract limit.
    3. Emit one path-bound collection gap per truncated manifest.

    Failure cases:
    - Malformed non-list dependency values are left for the existing profile validator to reject.

    Side effects:
    - Pure in-memory projection with no filesystem or cache writes.
    """
    bounded: list[dict[str, Any]] = []
    gaps: list[dict[str, Any]] = []
    for manifest in manifests:
        dependencies = manifest.get("dependencies")
        if (
            not isinstance(dependencies, list)
            or len(dependencies) <= PROFILE_MANIFEST_DEPENDENCY_LIMIT
        ):
            bounded.append(manifest)
            continue
        bounded.append(
            {
                **manifest,
                "dependencies": dependencies[:PROFILE_MANIFEST_DEPENDENCY_LIMIT],
            }
        )
        gaps.append(
            {
                "path": str(manifest.get("path", "")),
                "reason": "COLLECTION_LIMIT_REACHED",
                "detail": (
                    f"Manifest dependencies contained {len(dependencies)} observations; "
                    f"retained the first {PROFILE_MANIFEST_DEPENDENCY_LIMIT} and omitted "
                    f"{len(dependencies) - PROFILE_MANIFEST_DEPENDENCY_LIMIT}."
                ),
            }
        )
    return bounded, gaps


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
        - Bound every V1 output collection and record explicit omissions instead of returning a schema-invalid artifact.
        - Emit candidate technical facts citing exact 1-indexed lines and sha256 excerpts.

        Execution flow:
        1. Traverse workspace filesystem honoring path depth and excluded directories.
        2. Filter entries against source path prefix.
        3. Inspect matching files for language, build system, container, and manifest contents.
        4. Aggregate and contract-bound languages, manifests, frameworks, candidate facts, and known gaps.
        5. Compute profile content digest and return the valid bounded repository profile dictionary.

        Failure cases:
        - Files or observation collections exceeding limits are added to knownGaps rather than aborting or silently omitting coverage.

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

        bounded_collections: dict[str, list[dict[str, Any]]] = {}
        collection_gaps: list[dict[str, Any]] = []
        raw_collections = {
            "languages": languages_list,
            "manifests": self.manifests,
            "frameworks": self.frameworks,
            "buildSystems": self.build_systems,
            "ciWorkflows": self.ci_workflows,
            "containerization": self.containerization,
            "candidateFacts": self.candidate_facts,
        }
        for name, values in raw_collections.items():
            bounded, gap = _bounded_profile_collection(name, values)
            bounded_collections[name] = bounded
            if gap is not None:
                collection_gaps.append(gap)
        bounded_collections["manifests"], dependency_gaps = (
            _bounded_manifest_dependencies(bounded_collections["manifests"])
        )
        collection_gaps.extend(dependency_gaps)

        all_gaps = [*self.known_gaps, *collection_gaps]
        known_gap_limit = PROFILE_COLLECTION_LIMITS["knownGaps"]
        if len(all_gaps) > known_gap_limit:
            omitted = len(all_gaps) - (known_gap_limit - 1)
            all_gaps = [
                *all_gaps[: known_gap_limit - 1],
                {
                    "path": "",
                    "reason": "COLLECTION_LIMIT_REACHED",
                    "detail": (
                        f"Profile collection knownGaps exceeded {known_gap_limit}; "
                        f"omitted {omitted} additional gap records."
                    ),
                },
            ]

        now_iso = datetime.now(timezone.utc).isoformat()
        profile_without_digest = {
            "repositoryId": self.repository_id,
            "commitSha": self.commit_sha,
            "sourcePathPrefix": self.source_path_prefix,
            "scannerVersion": SCANNER_VERSION,
            "languages": bounded_collections["languages"],
            "manifests": bounded_collections["manifests"],
            "frameworks": bounded_collections["frameworks"],
            "buildSystems": bounded_collections["buildSystems"],
            "ciWorkflows": bounded_collections["ciWorkflows"],
            "containerization": bounded_collections["containerization"],
            "candidateFacts": bounded_collections["candidateFacts"],
            "knownGaps": all_gaps,
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
                line_no = self._find_line_in_section(lines, section_key, dep_name_str)

                dependencies.append({
                    "name": dep_name_str,
                    "versionRange": v_range,
                    "kind": dep_kind,
                    "line": line_no,
                })

                framework = NPM_AI_FRAMEWORK_CATALOG.get(dep_name_str) or FRAMEWORK_CATALOG.get(dep_name_str)
                if framework:
                    fw_name, fw_cat = framework
                    line_text = lines[line_no - 1] if 0 < line_no <= len(lines) else f'"{dep_name_str}": "{v_range}"'
                    self.frameworks.append({
                        "name": fw_name,
                        "category": fw_cat,
                        "path": rel_path,
                        "line": line_no,
                        "evidenceExcerpt": _redact_secret_text(line_text.strip()),
                    })
                    # Add candidate fact
                    statement = (
                        f"Manifest declares {fw_name} dependency ({fw_cat}) in {rel_path}:{line_no}; "
                        "the declaration alone does not establish runtime AI use"
                        if fw_cat in AI_DEPENDENCY_CATEGORIES
                        else f"Repository utilizes {fw_name} ({fw_cat}) configured in {rel_path}:{line_no}"
                    )
                    self.candidate_facts.append({
                        "statement": statement,
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

    def _record_python_dependency(
        self,
        dependencies: list[dict[str, Any]],
        *,
        raw_name: str,
        version_range: str | None,
        kind: str,
        line: int,
        rel_path: str,
        evidence_excerpt: str,
    ) -> None:
        """Business purpose:
        Record one declared Python dependency and any evidence-backed framework hint.

        Business rules:
        - Normalize distribution names according to PEP 503 before catalogue matching.
        - Use only the Python AI catalogue so registry name collisions cannot fabricate AI facts.
        - AI candidate facts describe the declaration only and never imply runtime use.

        Execution flow:
        1. Normalize the declared distribution name and append it to the manifest dependencies.
        2. Resolve a matching common or Python-specific framework catalogue entry.
        3. Append exact-line framework evidence and a declaration-only candidate fact.

        Failure cases:
        - Uncatalogued packages remain manifest dependencies without a framework observation or fact.

        Side effects:
        - Appends dependency, framework, and candidate-fact observations to scanner state.
        """
        package_name = re.sub(r"[-_.]+", "-", raw_name.lower())
        dependencies.append({
            "name": package_name,
            "versionRange": version_range,
            "kind": kind,
            "line": line,
        })

        framework = PYTHON_AI_FRAMEWORK_CATALOG.get(package_name) or FRAMEWORK_CATALOG.get(package_name)
        if not framework:
            return

        fw_name, fw_cat = framework
        self.frameworks.append({
            "name": fw_name,
            "category": fw_cat,
            "path": rel_path,
            "line": line,
            "evidenceExcerpt": _redact_secret_text(evidence_excerpt),
        })
        statement = (
            f"Manifest declares {fw_name} dependency ({fw_cat}) in {rel_path}:{line}; "
            "the declaration alone does not establish runtime AI use"
            if fw_cat in AI_DEPENDENCY_CATEGORIES
            else f"Repository utilizes Python package {fw_name} ({fw_cat}) in {rel_path}:{line}"
        )
        self.candidate_facts.append({
            "statement": statement,
            "kind": "FACT",
            "authority": "EVIDENCE_CITED",
            "evidence": {
                "path": rel_path,
                "startLine": line,
                "endLine": line,
                "excerptSha256": _excerpt_sha256(evidence_excerpt),
            },
        })

    def _parse_requirements_txt(self, full_path: Path, rel_path: str) -> None:
        """Business purpose:
        Parse Python requirements.txt file and extract declared dependencies.

        Business rules:
        - Skip comments and command options; accept PEP 508 extras, direct references, and spacing.
        - Normalize Python distribution names before framework matching.

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

        req_re = re.compile(r"^([a-zA-Z0-9][a-zA-Z0-9_\-\.]*)(?:\[[^\]]+\])?\s*(.*)$")

        for idx, line in enumerate(lines, start=1):
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or stripped.startswith("-"):
                continue

            match = req_re.match(stripped)
            if not match:
                continue

            ver_spec = match.group(2).strip()
            self._record_python_dependency(
                dependencies,
                raw_name=match.group(1),
                version_range=ver_spec or None,
                kind="PRODUCTION",
                line=idx,
                rel_path=rel_path,
                evidence_excerpt=stripped,
            )

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
        - Support PEP 621 project arrays, optional-dependency arrays, and Poetry dependency tables.
        - Treat optional and Poetry group dependencies as non-production declarations.
        - Match only exact dependency table shapes; unrelated TOML tables never emit facts.
        - Normalize Python distribution names before framework matching.

        Execution flow:
        1. Read TOML text lines.
        2. Track the exact TOML section and any active dependency array.
        3. Parse requirement strings or Poetry key-value declarations with exact line numbers.
        4. Record each dependency through the Python ecosystem catalogue.

        Failure cases:
        - Unreadable or malformed files record knownGaps and exit parser.

        Side effects:
        - Appends manifest, framework, and candidate-fact observations to internal lists.
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
        current_section = ""
        active_array_kind: str | None = None
        requirement_re = re.compile(
            r"^([a-zA-Z0-9][a-zA-Z0-9_\-\.]*)(?:\[[^\]]+\])?\s*(.*)$"
        )
        poetry_section_re = re.compile(
            r"^tool\.poetry(?:\.group\.([a-zA-Z0-9_-]+))?\.dependencies$"
        )

        for idx, line in enumerate(lines, start=1):
            stripped = line.strip()
            section_match = re.match(r"^\[([^\]]+)\]$", stripped)
            if section_match:
                current_section = section_match.group(1)
                active_array_kind = None
                continue
            if not stripped or stripped.startswith("#"):
                continue

            poetry_section = poetry_section_re.match(current_section)
            if poetry_section:
                match = re.match(
                    r"^['\"]?([a-zA-Z0-9_\-\.]+)['\"]?\s*=\s*(.+)$",
                    stripped,
                )
                if not match or match.group(1).lower() == "python":
                    continue
                group_name = poetry_section.group(1)
                dependency_kind = (
                    "PRODUCTION"
                    if group_name is None
                    else "DEVELOPMENT"
                    if group_name.lower() == "dev"
                    else "OPTIONAL"
                )
                self._record_python_dependency(
                    dependencies,
                    raw_name=match.group(1),
                    version_range=match.group(2).strip().strip("'\""),
                    kind=dependency_kind,
                    line=idx,
                    rel_path=rel_path,
                    evidence_excerpt=stripped,
                )
                continue

            if current_section == "project" and re.match(r"^dependencies\s*=\s*\[", stripped):
                active_array_kind = "PRODUCTION"
            elif current_section == "project.optional-dependencies":
                optional_group = re.match(r"^[a-zA-Z0-9_-]+\s*=\s*\[", stripped)
                if optional_group:
                    active_array_kind = "OPTIONAL"

            if active_array_kind is None:
                continue

            for requirement in re.findall(r"['\"]([^'\"]+)['\"]", stripped):
                match = requirement_re.match(requirement.strip())
                if not match:
                    continue
                version_range = match.group(2).strip()
                self._record_python_dependency(
                    dependencies,
                    raw_name=match.group(1),
                    version_range=version_range or None,
                    kind=active_array_kind,
                    line=idx,
                    rel_path=rel_path,
                    evidence_excerpt=stripped,
                )

            if "]" in stripped:
                active_array_kind = None

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
    ) -> int:
        """Business purpose:
        Locate a package declaration within its exact package.json dependency section.

        Business rules:
        - Ignore matching package names in metadata and other dependency sections.
        - Defaults to line 1 if token is not found.

        Execution flow:
        1. Locate the requested dependency section object.
        2. Track its object depth while searching for the quoted package key.
        3. Return the matching line, or line 1 as a defensive fallback.

        Failure cases:
        - None: fallback to line 1 on search miss.

        Side effects:
        - Pure calculation without I/O.
        """
        section_target = f'"{section_key}"'
        dependency_target = f'"{dep_name}"'
        in_section = False
        object_depth = 0

        for idx, line in enumerate(lines, start=1):
            if not in_section:
                if section_target not in line:
                    continue
                in_section = True
                object_depth = line.count("{") - line.count("}")
                continue

            if dependency_target in line:
                return idx

            object_depth += line.count("{") - line.count("}")
            if object_depth <= 0:
                break
        return 1


def _discovery_sha256(value: str) -> str:
    """Business purpose:
    Produce the common prefixed digest used by discovery identities and provenance fields.

    Business rules:
    - Hash the exact UTF-8 representation supplied by the caller.
    - Return lowercase SHA-256 with the shared ``sha256:`` prefix.

    Execution flow:
    1. Encode the input as UTF-8.
    2. Compute SHA-256 and format the canonical identifier.

    Failure cases:
    - Encoding failures propagate rather than substituting source content.

    Side effects:
    - Pure calculation without filesystem or network access.
    """
    return f"sha256:{hashlib.sha256(value.encode('utf-8')).hexdigest()}"


def _discovery_source_classification(path: str) -> str:
    """Business purpose:
    Classify source location without treating directory placement as runtime reachability.

    Business rules:
    - Tests, examples, generated and vendored paths retain explicit classifications.
    - All other files are only classified as production-shaped; this never confirms execution.

    Execution flow:
    1. Tokenize the lowercase repository-relative path.
    2. Apply the most specific non-production path classification.
    3. Fall back to PRODUCTION classification without changing reachability.

    Failure cases:
    - None; unknown path naming conservatively falls back to production-shaped source.

    Side effects:
    - Pure classification without source mutation.
    """
    lowered = path.lower()
    segments = set(PurePosixPath(lowered).parts)
    if segments.intersection({"vendor", "vendored", "third_party", "third-party"}):
        return "UNKNOWN"
    if segments.intersection({"generated", "__generated__", "gen"}) or ".generated." in lowered:
        return "GENERATED"
    if segments.intersection({"examples", "example", "samples", "sample", "demo", "demos"}):
        return "EXAMPLE_ONLY"
    if segments.intersection({"test", "tests", "__tests__", "spec", "specs", "fixtures"}) or re.search(
        r"(?:^|/)[^/]+\.(?:test|spec)\.[^/]+$", lowered
    ):
        return "TEST_ONLY"
    return "PRODUCTION_CANDIDATE"


def _discovery_symbol(lines: list[str], line_number: int) -> str | None:
    """Business purpose:
    Attach a nearby declared symbol to a discovery signal without claiming a resolved call graph.

    Business rules:
    - Inspect at most twenty preceding lines in the same file.
    - Return only explicit function, class, method, or arrow-function declarations.

    Execution flow:
    1. Walk backward from the signal within the bounded window.
    2. Match supported Python and JavaScript/TypeScript declaration forms.
    3. Return the nearest symbol name or null.

    Failure cases:
    - Unsupported syntax returns null and leaves graph reachability unresolved.

    Side effects:
    - Pure in-memory source inspection.
    """
    start = max(0, line_number - 21)
    declaration = re.compile(
        r"^\s*(?:async\s+)?(?:def|function|class)\s+([A-Za-z_$][\w$]*)|"
        r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>"
    )
    for index in range(line_number - 1, start - 1, -1):
        match = declaration.search(lines[index])
        if match:
            return match.group(1) or match.group(2)
    return None


def _discovery_range(
    *,
    path: str,
    line_number: int,
    line: str,
    symbol: str | None,
    signal_type: str,
    classification: str,
    technology_relevance: list[str],
    explanation: str,
    evidence_strength: str,
) -> dict[str, Any]:
    """Business purpose:
    Build a provenance-bound RelevanceMap range without persisting raw customer source.

    Business rules:
    - Bind path, one-indexed range, signal and exact line digest into a deterministic identity.
    - Classification is separate from reachability; static discovery never confirms production execution.
    - Rule relevance starts empty until server-side candidate matching uses the pinned rule set.

    Execution flow:
    1. Hash the exact source line and immutable range coordinates.
    2. Populate source classification, relevance and conservative reachability.
    3. Record unresolved graph edges and audited expansion state.

    Failure cases:
    - Invalid coordinates are rejected later by the shared discovery contract.

    Side effects:
    - Pure dictionary creation; raw source is not retained in the result.
    """
    source_digest = _discovery_sha256(line)
    range_id = _discovery_sha256(
        json.dumps(
            [path, line_number, line_number, signal_type, source_digest],
            separators=(",", ":"),
            ensure_ascii=False,
        )
    )
    return {
        "rangeId": range_id,
        "path": path,
        "startLine": line_number,
        "endLine": line_number,
        "sourceDigest": source_digest,
        "symbol": symbol,
        "signalType": signal_type,
        "sourceClassification": classification,
        "reachability": "NOT_ESTABLISHED",
        "observationStatus": "OBSERVED_SOURCE_FACT",
        "technologyRelevance": technology_relevance,
        "useCaseIds": [],
        "ruleRelevance": [],
        "evidenceStrength": evidence_strength,
        "explanation": explanation,
        "callers": [],
        "callees": [],
        "unresolvedEdges": ["Static discovery did not resolve runtime callers or dependency-injection edges."],
        "coverageGaps": [],
        "expansionState": "PERMITTED",
    }


def compute_discovery_digest(discovery: Mapping[str, Any]) -> str:
    """Business purpose:
    Bind the complete deterministic discovery observation payload to one integrity digest.

    Business rules:
    - Exclude generatedAt, contentDigest and discoveryId as volatile or self-referential fields.
    - Preserve array order and recursively sort object keys through canonical JSON output.

    Execution flow:
    1. Remove excluded fields from the top-level artifact.
    2. Serialize canonical compact JSON with sorted keys.
    3. Return the prefixed SHA-256 digest.

    Failure cases:
    - Non-serializable payload values raise instead of producing a partial digest.

    Side effects:
    - Pure calculation without persistence or authorization changes.
    """
    canonical = {
        key: value
        for key, value in discovery.items()
        if key not in {"generatedAt", "contentDigest", "discoveryId"}
    }
    encoded = json.dumps(
        canonical,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    return _discovery_sha256(encoded)


def _append_discovery_gap(
    discovery: dict[str, Any],
    *,
    path: str,
    reason: str,
    detail: str,
) -> None:
    """Business purpose:
    Preserve graph coverage limitations inside the bounded discovery contract.

    Business rules:
    - Keep at most 2,000 known gaps and never silently imply complete coverage.
    - Deduplicate identical gap records produced by repeated range traces.

    Execution flow:
    1. Build the bounded gap record.
    2. Append it when unique and capacity remains.
    3. Replace the final slot with an omission marker when capacity is exhausted.

    Failure cases:
    - A full collection records a generic omitted-gap marker instead of exceeding the contract.

    Side effects:
    - Mutates only the in-memory discovery known-gap collection.
    """
    gaps = discovery.setdefault("knownGaps", [])
    gap = {"path": path[:1024], "reason": reason, "detail": detail[:1000]}
    if gap in gaps:
        return
    if len(gaps) < 2_000:
        gaps.append(gap)
        return
    gaps[-1] = {
        "path": "",
        "reason": "INCOMPLETE_COVERAGE",
        "detail": "Known-gap collection reached its limit; additional graph coverage gaps were omitted.",
    }


def _append_range_gap(source_range: dict[str, Any], detail: str) -> None:
    """Business purpose:
    Attach a graph limitation to the exact source priority affected by it.

    Business rules:
    - Preserve unique messages only and remain within the 100-item range contract.
    - Never convert an omitted graph result into evidence that an edge is absent.

    Execution flow:
    1. Normalize the bounded detail.
    2. Append it when unique and capacity remains.
    3. Add a final omission marker if more limitations cannot be represented.

    Failure cases:
    - Full range collections retain a generic incomplete-coverage marker.

    Side effects:
    - Mutates only the supplied source range.
    """
    gaps = source_range.setdefault("coverageGaps", [])
    bounded = detail[:1000]
    if bounded in gaps:
        return
    if len(gaps) < 100:
        gaps.append(bounded)
        return
    gaps[-1] = "Additional graph coverage gaps were omitted at the range contract limit."


def _parse_last_json_object(output: str) -> dict[str, Any] | None:
    """Business purpose:
    Extract the structured Codebase Memory result from bounded CLI output.

    Business rules:
    - Accept only a JSON object emitted on a complete output line.
    - Ignore diagnostic lines without interpreting them as graph evidence.

    Execution flow:
    1. Walk non-empty output lines from last to first.
    2. Decode candidate object lines.
    3. Return the first valid object.

    Failure cases:
    - Missing or malformed JSON returns None so the caller records a coverage gap.

    Side effects:
    - Pure parsing without persistence or source access.
    """
    for line in reversed([line.strip() for line in output.splitlines() if line.strip()]):
        if not (line.startswith("{") and line.endswith("}")):
            continue
        try:
            parsed = json.loads(line)
        except (TypeError, ValueError):
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def _parse_graph_trace_table(table: Any) -> tuple[list[str], bool] | None:
    """Business purpose:
    Convert Codebase Memory grouped caller/callee rows into bounded qualified names.

    Business rules:
    - Require the documented grouped-table shape with explicit columns and groups.
    - Keep exact names up to 500 characters and at most 100 unique entries.

    Execution flow:
    1. Locate the name column.
    2. Combine each group's qualified-name prefix with its name cell.
    3. Sort, deduplicate and bound the collected names.

    Failure cases:
    - Unrecognized table shapes return None; invalid or excess rows mark the result truncated.

    Side effects:
    - Pure parsing without graph or discovery mutation.
    """
    if not isinstance(table, dict):
        return None
    columns = table.get("cols")
    groups = table.get("groups")
    if not isinstance(columns, list) or not isinstance(groups, list) or "name" not in columns:
        return None
    name_index = columns.index("name")
    names: set[str] = set()
    omitted = False
    for group in groups:
        if not isinstance(group, dict) or not isinstance(group.get("rows"), list):
            return None
        prefix = group.get("qn_prefix", "")
        if not isinstance(prefix, str):
            return None
        for row in group["rows"]:
            if not isinstance(row, list) or name_index >= len(row) or not isinstance(row[name_index], str):
                omitted = True
                continue
            name = row[name_index].strip()
            if not name:
                omitted = True
                continue
            qualified_name = f"{prefix}.{name}" if prefix else name
            if len(qualified_name) > 500:
                omitted = True
                continue
            names.add(qualified_name)
    ordered = sorted(names)
    if len(ordered) > DEFAULT_DISCOVERY_GRAPH_RESULT_LIMIT:
        omitted = True
        ordered = ordered[:DEFAULT_DISCOVERY_GRAPH_RESULT_LIMIT]
    return ordered, omitted


def _finalize_graph_enriched_discovery(discovery: dict[str, Any]) -> dict[str, Any]:
    """Business purpose:
    Rebind graph-enriched discovery content to its integrity identity and coverage ledger.

    Business rules:
    - Preserve the original immutable repository, commit, scope, scanner, graph and cache pins.
    - Recompute coverage counters and digest after every graph enrichment outcome.

    Execution flow:
    1. Refresh bounded coverage counters from the artifact collections.
    2. Mark truncation when scanner or graph results were explicitly bounded.
    3. Recompute contentDigest and discoveryId over the complete payload.

    Failure cases:
    - Malformed ledgers raise rather than produce an apparently valid artifact.

    Side effects:
    - Mutates and returns the supplied in-memory discovery payload.
    """
    impact = discovery["resourceLedger"]["coverageImpact"]
    impact["knownGapCount"] = len(discovery["knownGaps"])
    impact["unresolvedCallCount"] = len(discovery["unresolvedCalls"])
    impact["unsupportedLanguageCount"] = len(discovery["unsupportedLanguages"])
    impact["truncated"] = any(
        gap.get("reason")
        in {
            "FILE_COUNT_LIMIT_REACHED",
            "FILE_SIZE_LIMIT_EXCEEDED",
            "TOTAL_BYTE_BUDGET_REACHED",
            "INCOMPLETE_COVERAGE",
        }
        for gap in discovery["knownGaps"]
        if isinstance(gap, dict)
    )
    digest = compute_discovery_digest(discovery)
    discovery["discoveryId"] = digest
    discovery["contentDigest"] = digest
    return discovery


def _enrich_repository_discovery_from_graph(
    discovery: Mapping[str, Any],
    *,
    execute: Callable[..., Any],
    max_traces: int = DEFAULT_MAX_DISCOVERY_GRAPH_TRACES,
) -> dict[str, Any]:
    """Business purpose:
    Reuse the pinned Codebase Memory index to prioritize cross-file callers and callees
    for discovered AI invocation symbols.

    Business rules:
    - Query only the existing graph engine; do not build a second AST or call graph.
    - Bound traversal count, depth and returned names, while recording every truncation
      or unsupported result.
    - Graph topology never proves production reachability, legal applicability, compliance,
      or evidence acceptance.
    - Dependency injection, interfaces, async jobs, events and dynamic configuration remain
      explicit unresolved edges.

    Execution flow:
    1. Copy the scanner artifact and identify unique invocation symbols by exact path.
    2. Trace a bounded set in both directions against the already pinned graph index.
    3. Populate bounded caller/callee priorities or record fail-closed range and artifact gaps.
    4. Recompute the coverage ledger and integrity digest without changing cache pins.

    Failure cases:
    - Missing graph identity, ambiguous symbols, execution failures and unrecognized output
      remain unresolved coverage.
    - Excess trace candidates or graph rows are truncated explicitly, never interpreted as absence.

    Side effects:
    - Executes bounded read-only Codebase Memory queries and returns an enriched in-memory copy.
    """
    if max_traces <= 0:
        raise ValueError("max_traces must be positive")
    enriched = json.loads(json.dumps(dict(discovery), ensure_ascii=False))
    invocation_signals = {"AI_SDK_CALL", "RAW_AI_HTTP_CALL", "AI_WRAPPER"}
    relevant_ranges = [
        source_range
        for source_range in enriched.get("sourceRanges", [])
        if source_range.get("signalType") in invocation_signals
    ]
    if not relevant_ranges:
        return _finalize_graph_enriched_discovery(enriched)

    graph_version = enriched.get("graphIndexVersion")
    if graph_version == "UNAVAILABLE":
        detail = (
            "Codebase Memory graph was unavailable; static callers and runtime "
            "reachability remain unresolved."
        )
        for source_range in relevant_ranges:
            _append_range_gap(source_range, detail)
        _append_discovery_gap(
            enriched,
            path="",
            reason="GRAPH_UNAVAILABLE",
            detail=detail,
        )
        return _finalize_graph_enriched_discovery(enriched)

    missing_symbol_ranges = [
        source_range
        for source_range in relevant_ranges
        if not source_range.get("symbol")
    ]
    if missing_symbol_ranges:
        detail = (
            "No enclosing symbol was identified, so graph callers/callees could not be traced; "
            "runtime absence is not established."
        )
        for source_range in missing_symbol_ranges:
            _append_range_gap(source_range, detail)
        _append_discovery_gap(
            enriched,
            path="",
            reason="UNRESOLVED_REACHABILITY",
            detail=detail,
        )

    candidates: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for source_range in relevant_ranges:
        path = source_range.get("path")
        symbol = source_range.get("symbol")
        if isinstance(path, str) and isinstance(symbol, str) and symbol:
            candidates.setdefault((path, symbol), []).append(source_range)
    ordered_candidates = sorted(candidates.items(), key=lambda item: item[0])
    if len(ordered_candidates) > max_traces:
        detail = (
            f"Graph trace budget {max_traces} was reached; additional invocation symbols "
            "remain unresolved."
        )
        for _, source_ranges in ordered_candidates[max_traces:]:
            for source_range in source_ranges:
                _append_range_gap(source_range, detail)
        _append_discovery_gap(
            enriched,
            path="",
            reason="INCOMPLETE_COVERAGE",
            detail=detail,
        )
        ordered_candidates = ordered_candidates[:max_traces]

    from .codebase_memory import CODEBASE_MEMORY_PROJECT, codebase_memory_cli

    unresolved_edge = (
        "Codebase Memory static CALLS edges do not establish dependency-injection, interface, async-job, "
        "event-handler, dynamic-configuration, or production-runtime reachability."
    )
    _append_discovery_gap(
        enriched,
        path="",
        reason="UNRESOLVED_REACHABILITY",
        detail=unresolved_edge,
    )
    for (path, symbol), source_ranges in ordered_candidates:
        command = codebase_memory_cli(
            "trace_path",
            {
                "project": CODEBASE_MEMORY_PROJECT,
                "function_name": symbol,
                "file_path": path,
                "direction": "both",
                "depth": DEFAULT_DISCOVERY_GRAPH_TRACE_DEPTH,
                "format": "json",
                "limit": DEFAULT_DISCOVERY_GRAPH_RESULT_LIMIT,
                "max_output_tokens": DEFAULT_DISCOVERY_GRAPH_OUTPUT_TOKENS,
            },
        )
        try:
            result = execute(command, timeout=30)
        except Exception:
            result = None
        output = str(getattr(result, "output", "") or "") if result is not None else ""
        exit_code = getattr(result, "exit_code", 1) if result is not None else 1
        payload = _parse_last_json_object(output) if exit_code == 0 else None
        callers_result = _parse_graph_trace_table(payload.get("callers")) if payload else None
        callees_result = _parse_graph_trace_table(payload.get("callees")) if payload else None
        if callers_result is None or callees_result is None:
            detail = (
                f"Codebase Memory could not return a structured caller/callee trace for {path}:{symbol}; "
                "runtime reachability remains unresolved."
            )
            for source_range in source_ranges:
                source_range["unresolvedEdges"] = [unresolved_edge]
                _append_range_gap(source_range, detail)
            _append_discovery_gap(
                enriched,
                path=path,
                reason="UNRESOLVED_REACHABILITY",
                detail=detail,
            )
            continue

        callers, callers_truncated = callers_result
        callees, callees_truncated = callees_result
        callers_total = payload.get("callers_total")
        callees_total = payload.get("callees_total")
        callers_relation = payload.get("callers_total_relation")
        callees_relation = payload.get("callees_total_relation")
        graph_reported_truncation = payload.get("truncated") is True
        callers_truncated = (
            callers_truncated
            or (isinstance(callers_total, int) and callers_total > len(callers))
            or callers_relation not in {None, "eq"}
            or graph_reported_truncation
        )
        callees_truncated = (
            callees_truncated
            or (isinstance(callees_total, int) and callees_total > len(callees))
            or callees_relation not in {None, "eq"}
            or graph_reported_truncation
        )
        for source_range in source_ranges:
            source_range["callers"] = callers
            source_range["callees"] = callees
            source_range["unresolvedEdges"] = [unresolved_edge]
            if not callers and not callees:
                _append_range_gap(
                    source_range,
                    "The static graph returned no caller/callee edges; runtime absence is not established.",
                )
            if callers_truncated or callees_truncated:
                _append_range_gap(
                    source_range,
                    "Graph caller/callee rows exceeded discovery bounds or contained unsupported rows.",
                )
        if not callers and not callees:
            _append_discovery_gap(
                enriched,
                path=path,
                reason="UNRESOLVED_REACHABILITY",
                detail=(
                    f"The static graph returned no caller/callee edges for {path}:{symbol}; "
                    "runtime absence is not established."
                ),
            )
        if callers_truncated or callees_truncated:
            _append_discovery_gap(
                enriched,
                path=path,
                reason="INCOMPLETE_COVERAGE",
                detail=(
                    f"Graph caller/callee results for {path}:{symbol} were bounded or "
                    "contained unsupported rows."
                ),
            )

    return _finalize_graph_enriched_discovery(enriched)


def scan_repository_discovery(
    workspace_path: Path | str,
    *,
    repository_id: str,
    commit_sha: str,
    source_path_prefix: str | None = None,
    max_scanned_files: int = DEFAULT_MAX_SCANNED_FILES,
    max_source_size_bytes: int = DEFAULT_MAX_DISCOVERY_SOURCE_SIZE_BYTES,
    max_total_source_bytes: int = DEFAULT_MAX_DISCOVERY_TOTAL_BYTES,
    max_ranges: int = 10_000,
    max_path_depth: int = DEFAULT_MAX_PATH_DEPTH,
    graph_index_version: str = "UNAVAILABLE",
) -> dict[str, Any]:
    """Business purpose:
    Discover source-backed AI invocation candidates and nearby relevant logic before rule assessment.

    Business rules:
    - Scan JavaScript, TypeScript, Python and bounded AI-related configuration statically; never execute customer code or contact a network/model.
    - Keep classification distinct from verified reachability and record unsupported languages, skipped paths,
      unresolved calls and incomplete coverage instead of treating missing observations as evidence of absence.
    - Retain only digests and bounded metadata, never raw source excerpts.
    - Ranked ranges are investigation priorities with audited expansion permitted, not an absolute allowlist.

    Execution flow:
    1. Walk the pinned source scope under file, size and depth bounds.
    2. Detect provider imports, direct SDK/raw HTTP invocations and nearby data/control signals.
    3. Group invocation ranges into candidate AI use cases and record unresolved graph/reachability questions.
    4. Bind scanner signature, cache identity and deterministic content digest into the result.

    Failure cases:
    - Missing or non-directory workspaces produce an explicit incomplete-coverage gap.
    - Oversized, binary and unreadable files are skipped with gaps; scanning continues within bounds.
    - Invalid non-positive limits or maxRanges above the shared contract maximum reject before traversal.

    Side effects:
    - Performs read-only bounded filesystem traversal; creates no facts, decisions, rule selections, or source writes.
    """
    workspace = Path(workspace_path).resolve()
    prefix = validate_source_path_prefix(source_path_prefix)
    if max_scanned_files <= 0 or max_source_size_bytes <= 0 or max_total_source_bytes <= 0:
        raise ValueError("Discovery file and byte limits must be positive")
    if max_ranges <= 0 or max_ranges > 10_000:
        raise ValueError("max_ranges must be between 1 and 10000")
    if not isinstance(graph_index_version, str) or not graph_index_version or len(graph_index_version) > 200:
        raise ValueError("graph_index_version must be a non-empty string of at most 200 characters")
    source_ranges: list[dict[str, Any]] = []
    use_cases: list[dict[str, Any]] = []
    known_gaps: list[dict[str, Any]] = []
    skipped_paths: list[str] = []
    unresolved_calls: list[str] = []
    unsupported_languages: set[str] = set()
    scanned_file_count = 0
    bytes_inspected = 0
    supported_suffixes = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"}
    configuration_suffixes = {".json", ".yaml", ".yml", ".toml"}
    code_suffixes = set(LANGUAGE_EXTENSIONS) - {".json", ".yaml", ".yml", ".toml", ".xml", ".html", ".css", ".scss", ".sql"}

    if not workspace.exists() or not workspace.is_dir():
        known_gaps.append(
            {
                "path": "",
                "reason": "INCOMPLETE_COVERAGE",
                "detail": "Repository workspace is unavailable or is not a directory.",
            }
        )
    else:
        stop = False
        for root, dirs, files in os.walk(workspace):
            rel_root = Path(root).relative_to(workspace)
            relative_root = "" if rel_root.as_posix() == "." else rel_root.as_posix()
            excluded = sorted(name for name in dirs if name in EXCLUDED_DIR_NAMES)
            for name in excluded:
                skipped = f"{relative_root}/{name}".lstrip("/")
                if source_path_in_scope(skipped, prefix) and _canonical_source_path(
                    skipped, maximum_length=1024
                ):
                    skipped_paths.append(skipped)
                elif source_path_in_scope(skipped, prefix):
                    known_gaps.append(
                        {
                            "path": "",
                            "reason": "INCOMPLETE_COVERAGE",
                            "detail": "An excluded path exceeded the contract path limit and was omitted.",
                        }
                    )
            dirs[:] = sorted(name for name in dirs if name not in EXCLUDED_DIR_NAMES)
            if len(rel_root.parts) > max_path_depth:
                known_gaps.append(
                    {
                        "path": relative_root if len(relative_root) <= 1024 else "",
                        "reason": "INCOMPLETE_COVERAGE",
                        "detail": f"Path depth exceeds discovery limit {max_path_depth}.",
                    }
                )
                dirs.clear()
                continue

            for filename in sorted(files):
                rel_path = (rel_root / filename).as_posix().removeprefix("./")
                if not source_path_in_scope(rel_path, prefix):
                    continue
                if not _canonical_source_path(rel_path, maximum_length=1024):
                    known_gaps.append(
                        {
                            "path": "",
                            "reason": "INCOMPLETE_COVERAGE",
                            "detail": "A source path exceeded the contract path limit and was omitted.",
                        }
                    )
                    continue
                suffix = Path(filename).suffix.lower()
                if suffix in code_suffixes and suffix not in supported_suffixes:
                    language = LANGUAGE_EXTENSIONS.get(suffix, suffix)
                    unsupported_languages.add(language)
                    continue
                is_configuration = suffix in configuration_suffixes and filename.lower() not in {
                    "package.json",
                    "package-lock.json",
                    "pnpm-lock.yaml",
                    "yarn.lock",
                    "pyproject.toml",
                }
                if suffix not in supported_suffixes and not is_configuration:
                    continue
                if scanned_file_count >= max_scanned_files:
                    known_gaps.append(
                        {
                            "path": rel_path,
                            "reason": "FILE_COUNT_LIMIT_REACHED",
                            "detail": f"Discovery file limit {max_scanned_files} was reached.",
                        }
                    )
                    stop = True
                    break
                scanned_file_count += 1
                full_path = Path(root) / filename
                try:
                    file_size = full_path.stat().st_size
                    if file_size > max_source_size_bytes:
                        known_gaps.append(
                            {
                                "path": rel_path,
                                "reason": "FILE_SIZE_LIMIT_EXCEEDED",
                                "detail": f"Source file exceeds discovery byte limit {max_source_size_bytes}.",
                            }
                        )
                        continue
                    if bytes_inspected + file_size > max_total_source_bytes:
                        known_gaps.append(
                            {
                                "path": rel_path,
                                "reason": "TOTAL_BYTE_BUDGET_REACHED",
                                "detail": f"Discovery total byte budget {max_total_source_bytes} was reached before this file.",
                            }
                        )
                        stop = True
                        break
                    raw = full_path.read_bytes()
                    bytes_inspected += len(raw)
                    if b"\0" in raw:
                        known_gaps.append(
                            {
                                "path": rel_path,
                                "reason": "UNREADABLE_OR_MALFORMED",
                                "detail": "Binary source file was not inspected.",
                            }
                        )
                        continue
                    content = raw.decode("utf-8")
                except (OSError, UnicodeError) as err:
                    known_gaps.append(
                        {
                            "path": rel_path,
                            "reason": "UNREADABLE_OR_MALFORMED",
                            "detail": str(err)[:1000] or "Source file could not be read.",
                        }
                    )
                    continue

                lines = content.splitlines()
                if is_configuration:
                    for line_number, line in enumerate(lines, start=1):
                        if not _DISCOVERY_CONFIGURATION_PATTERN.search(line):
                            continue
                        source_ranges.append(
                            _discovery_range(
                                path=rel_path,
                                line_number=line_number,
                                line=line,
                                symbol=None,
                                signal_type="CONFIGURATION",
                                classification="CONFIGURATION",
                                technology_relevance=["MODEL_CONFIGURATION"],
                                explanation=(
                                    "Configuration contains an AI/model-related key or provider reference; "
                                    "its value is not retained and runtime use is not established."
                                ),
                                evidence_strength="DIRECT_SOURCE",
                            )
                        )
                    continue

                providers = sorted(
                    {provider for provider, pattern in _DISCOVERY_PROVIDER_PATTERNS if pattern.search(content)}
                )
                classification = _discovery_source_classification(rel_path)
                file_range_ids: list[str] = []
                invocation_range_ids: list[str] = []

                for line_number, line in enumerate(lines, start=1):
                    matching_providers = [
                        provider for provider, pattern in _DISCOVERY_PROVIDER_PATTERNS if pattern.search(line)
                    ]
                    is_custom_ai_http_call = bool(
                        _DISCOVERY_HTTP_CLIENT_PATTERN.search(line)
                        and _DISCOVERY_CUSTOM_AI_ENDPOINT_PATTERN.search(line)
                    )
                    is_direct_call = bool(
                        _DISCOVERY_DIRECT_CALL_PATTERN.search(line)
                        or is_custom_ai_http_call
                    )
                    is_wrapper_call = bool(_DISCOVERY_WRAPPER_CALL_PATTERN.search(line))
                    is_call = is_direct_call or is_wrapper_call
                    if not matching_providers and not is_call:
                        continue
                    signal_type = "AI_WRAPPER" if is_wrapper_call and not is_direct_call else (
                        "AI_SDK_CALL" if is_call else "AI_SDK_IMPORT"
                    )
                    if is_custom_ai_http_call or (
                        is_direct_call and re.search(r"https?://", line, re.I)
                    ):
                        signal_type = "RAW_AI_HTTP_CALL"
                    provider_text = ", ".join(matching_providers or providers) or "an unresolved AI provider"
                    wrapper_without_provider = is_wrapper_call and not is_direct_call and not providers
                    source_range = _discovery_range(
                        path=rel_path,
                        line_number=line_number,
                        line=line,
                        symbol=_discovery_symbol(lines, line_number),
                        signal_type=signal_type,
                        classification=classification,
                        technology_relevance=(
                            ["RELATED_LOGIC"]
                            if wrapper_without_provider
                            else ["AI_INVOCATION"] if is_call else ["AI_ORCHESTRATION"]
                        ),
                        explanation=(
                            "A model-like wrapper method is present without a recognized provider; "
                            "it is an investigation hypothesis, not a verified AI invocation."
                            if wrapper_without_provider
                            else
                            f"Static source contains a candidate invocation of {provider_text}."
                            if is_call
                            else f"Static source imports or references {provider_text}; runtime use is not established."
                        ),
                        evidence_strength=(
                            "HEURISTIC"
                            if wrapper_without_provider
                            else "STRUCTURAL" if is_wrapper_call else "DIRECT_SOURCE"
                        ),
                    )
                    if wrapper_without_provider:
                        source_range["observationStatus"] = "INFERRED_HYPOTHESIS"
                    elif is_wrapper_call:
                        source_range["observationStatus"] = "CANDIDATE_FINDING"
                    source_ranges.append(source_range)
                    file_range_ids.append(source_range["rangeId"])
                    if is_call:
                        invocation_range_ids.append(source_range["rangeId"])

                if not invocation_range_ids:
                    for line_number, line in enumerate(lines, start=1):
                        control_match = next(
                            (
                                label
                                for label, pattern, _ in _DISCOVERY_CONTROL_PATTERNS
                                if pattern.search(line)
                            ),
                            None,
                        )
                        if not control_match:
                            continue
                        related = _discovery_range(
                            path=rel_path,
                            line_number=line_number,
                            line=line,
                            symbol=_discovery_symbol(lines, line_number),
                            signal_type="CONTROL",
                            classification=classification,
                            technology_relevance=["RELATED_LOGIC"],
                            explanation=(
                                f"Source contains a {control_match} signal that may be relevant to "
                                "rule-specific investigation; it is not proof of AI use or compliance."
                            ),
                            evidence_strength="HEURISTIC",
                        )
                        related["observationStatus"] = "CANDIDATE_FINDING"
                        source_ranges.append(related)
                    continue

                use_case_id = _discovery_sha256(
                    json.dumps(
                        [repository_id, commit_sha.lower(), prefix, rel_path, invocation_range_ids],
                        separators=(",", ":"),
                    )
                )
                nearby_range_ids: list[str] = []
                invocation_lines = {
                    item["startLine"]
                    for item in source_ranges
                    if item["rangeId"] in invocation_range_ids
                }
                for line_number, line in enumerate(lines, start=1):
                    if not any(abs(line_number - invocation_line) <= 40 for invocation_line in invocation_lines):
                        continue
                    control_match = next(
                        ((label, relevance) for label, pattern, relevance in _DISCOVERY_CONTROL_PATTERNS if pattern.search(line)),
                        None,
                    )
                    data_flow = bool(_DISCOVERY_DATA_FLOW_PATTERN.search(line))
                    if not control_match and not data_flow:
                        continue
                    if any(
                        item["path"] == rel_path and item["startLine"] == line_number
                        for item in source_ranges
                    ):
                        continue
                    label = control_match[0] if control_match else "AI_DATA_FLOW"
                    relevance = control_match[1] if control_match else "AI_DATA_FLOW"
                    related = _discovery_range(
                        path=rel_path,
                        line_number=line_number,
                        line=line,
                        symbol=_discovery_symbol(lines, line_number),
                        signal_type="CONTROL" if control_match else "DATA_FLOW",
                        classification=classification,
                        technology_relevance=[relevance],
                        explanation=f"Nearby source contains a {label} signal relevant to the candidate AI invocation.",
                        evidence_strength="HEURISTIC",
                    )
                    related["observationStatus"] = "CANDIDATE_FINDING"
                    source_ranges.append(related)
                    nearby_range_ids.append(related["rangeId"])

                all_use_case_ranges = [*invocation_range_ids, *nearby_range_ids]
                for item in source_ranges:
                    if item["rangeId"] in all_use_case_ranges:
                        item["useCaseIds"] = [use_case_id]
                unresolved = (
                    f"{rel_path}: runtime entry point, dependency-injection path, async/event reachability, "
                    "and dynamic configuration were not resolved by static discovery."
                )
                unresolved_calls.append(unresolved)
                invocation_observations = {
                    item["observationStatus"]
                    for item in source_ranges
                    if item["rangeId"] in invocation_range_ids
                }
                use_cases.append(
                    {
                        "useCaseId": use_case_id,
                        "name": (
                            f"Candidate {' / '.join(providers) if providers else 'AI'} use in {rel_path}"
                        )[:300],
                        "observationStatus": (
                            "INFERRED_HYPOTHESIS"
                            if invocation_observations == {"INFERRED_HYPOTHESIS"}
                            else "CANDIDATE_FINDING"
                        ),
                        "providerOrFramework": " / ".join(providers) if providers else None,
                        "invocationRangeIds": invocation_range_ids,
                        "inputRangeIds": [
                            range_id
                            for range_id in nearby_range_ids
                            if next(item for item in source_ranges if item["rangeId"] == range_id)["signalType"] == "DATA_FLOW"
                        ],
                        "outputRangeIds": [],
                        "controlRangeIds": [
                            range_id
                            for range_id in nearby_range_ids
                            if next(item for item in source_ranges if item["rangeId"] == range_id)["signalType"] == "CONTROL"
                        ],
                        "unresolvedQuestions": [
                            "Is this candidate reachable in the deployed production environment?",
                            "What operational purpose, data categories, retention and human oversight apply?",
                        ],
                    }
                )
            if stop:
                break

    signal_priority = {
        "RAW_AI_HTTP_CALL": 0,
        "AI_SDK_CALL": 0,
        "AI_WRAPPER": 1,
        "CONTROL": 2,
        "DATA_FLOW": 2,
        "CONFIGURATION": 3,
        "AI_SDK_IMPORT": 4,
    }
    classification_priority = {
        "REACHABLE_PRODUCTION": 0,
        "PRODUCTION_CANDIDATE": 1,
        "CONFIGURATION": 2,
        "UNKNOWN": 3,
        "GENERATED": 4,
        "TEST_ONLY": 5,
        "EXAMPLE_ONLY": 5,
    }
    observation_priority = {
        "OBSERVED_SOURCE_FACT": 0,
        "CANDIDATE_FINDING": 1,
        "INFERRED_HYPOTHESIS": 2,
        "CUSTOMER_CONFIRMED_FACT": 3,
        "UNKNOWN": 4,
    }
    strength_priority = {
        "DIRECT_SOURCE": 0,
        "STRUCTURAL": 1,
        "HEURISTIC": 2,
        "UNKNOWN": 3,
    }
    source_ranges.sort(
        key=lambda item: (
            signal_priority.get(item["signalType"], 99),
            observation_priority.get(item["observationStatus"], 99),
            classification_priority.get(item["sourceClassification"], 99),
            strength_priority.get(item["evidenceStrength"], 99),
            item["path"],
            item["startLine"],
            item["rangeId"],
        )
    )

    if len(source_ranges) > max_ranges:
        source_ranges = source_ranges[:max_ranges]
        retained_ids = {item["rangeId"] for item in source_ranges}
        for use_case in use_cases:
            for field_name in ("invocationRangeIds", "inputRangeIds", "outputRangeIds", "controlRangeIds"):
                use_case[field_name] = [
                    range_id for range_id in use_case[field_name] if range_id in retained_ids
                ]
        use_cases = [use_case for use_case in use_cases if use_case["invocationRangeIds"]]
        known_gaps.append(
            {
                "path": "",
                "reason": "INCOMPLETE_COVERAGE",
                "detail": f"Discovery range limit {max_ranges} was reached.",
            }
        )

    if len(use_cases) > 2_000:
        use_cases = use_cases[:2_000]
        known_gaps.append(
            {
                "path": "",
                "reason": "INCOMPLETE_COVERAGE",
                "detail": "AI use-case collection reached the contract limit of 2000 entries.",
            }
        )
    for use_case in use_cases:
        for field_name in (
            "invocationRangeIds",
            "inputRangeIds",
            "outputRangeIds",
            "controlRangeIds",
        ):
            if len(use_case[field_name]) <= 500:
                continue
            use_case[field_name] = use_case[field_name][:500]
            known_gaps.append(
                {
                    "path": "",
                    "reason": "INCOMPLETE_COVERAGE",
                    "detail": (
                        f"Use-case {field_name} collection reached the contract limit of 500 entries."
                    ),
                }
            )
    retained_use_case_ids = {use_case["useCaseId"] for use_case in use_cases}
    for source_range in source_ranges:
        source_range["useCaseIds"] = [
            use_case_id
            for use_case_id in source_range["useCaseIds"]
            if use_case_id in retained_use_case_ids
        ]

    if len(unresolved_calls) > 2_000:
        unresolved_calls = unresolved_calls[:2_000]
        known_gaps.append(
            {
                "path": "",
                "reason": "INCOMPLETE_COVERAGE",
                "detail": "Unresolved-call collection reached the contract limit of 2000 entries.",
            }
        )

    unsupported_language_list = sorted(unsupported_languages)
    if len(unsupported_language_list) > 100:
        unsupported_language_list = unsupported_language_list[:100]
        known_gaps.append(
            {
                "path": "",
                "reason": "INCOMPLETE_COVERAGE",
                "detail": "Unsupported-language collection reached the contract limit of 100 entries.",
            }
        )

    bounded_skipped_paths = sorted(set(skipped_paths))
    if len(bounded_skipped_paths) > 2_000:
        bounded_skipped_paths = bounded_skipped_paths[:2_000]
        known_gaps.append(
            {
                "path": "",
                "reason": "INCOMPLETE_COVERAGE",
                "detail": "Skipped-path collection reached the contract limit of 2000 entries.",
            }
        )

    if len(known_gaps) > 2_000:
        known_gaps = [
            *known_gaps[:1_999],
            {
                "path": "",
                "reason": "INCOMPLETE_COVERAGE",
                "detail": "Known-gap collection exceeded the contract limit; additional gaps were omitted.",
            },
        ]

    scanner_source = Path(__file__).read_bytes()
    scanner_signature = f"sha256:{hashlib.sha256(scanner_source).hexdigest()}"
    cache_identity = _discovery_sha256(
        json.dumps(
            [
                repository_id,
                commit_sha.lower(),
                prefix,
                SCANNER_VERSION,
                DISCOVERY_VERSION,
                scanner_signature,
                graph_index_version,
            ],
            separators=(",", ":"),
        )
    )
    discovery_without_digest = {
        "repositoryId": repository_id,
        "commitSha": commit_sha.lower(),
        "sourcePathPrefix": prefix,
        "scannerVersion": SCANNER_VERSION,
        "discoveryVersion": DISCOVERY_VERSION,
        "scannerSignature": scanner_signature,
        "graphIndexVersion": graph_index_version,
        "cacheIdentity": cache_identity,
        "sourceRanges": source_ranges,
        "aiUseCases": use_cases,
        "ruleCandidates": [],
        "knownGaps": known_gaps,
        "unsupportedLanguages": unsupported_language_list,
        "skippedPaths": bounded_skipped_paths,
        "unresolvedCalls": unresolved_calls,
        "resourceLedger": {
            "budget": {
                "maxFiles": max_scanned_files,
                "maxBytes": max_total_source_bytes,
                "maxRanges": max_ranges,
            },
            "usage": {
                "filesScanned": scanned_file_count,
                "bytesInspected": bytes_inspected,
                "rangesProduced": len(source_ranges),
            },
            "remaining": {
                "files": max(0, max_scanned_files - scanned_file_count),
                "bytes": max(0, max_total_source_bytes - bytes_inspected),
                "ranges": max(0, max_ranges - len(source_ranges)),
            },
            "coverageImpact": {
                "knownGapCount": len(known_gaps),
                "unresolvedCallCount": len(unresolved_calls),
                "unsupportedLanguageCount": len(unsupported_language_list),
                "truncated": any(
                    gap["reason"]
                    in {
                        "FILE_COUNT_LIMIT_REACHED",
                        "FILE_SIZE_LIMIT_EXCEEDED",
                        "TOTAL_BYTE_BUDGET_REACHED",
                        "INCOMPLETE_COVERAGE",
                    }
                    for gap in known_gaps
                ),
            },
            "expansionHistory": [],
        },
        "scannedFileCount": scanned_file_count,
    }
    content_digest = compute_discovery_digest(discovery_without_digest)
    return {
        **discovery_without_digest,
        "discoveryId": content_digest,
        "contentDigest": content_digest,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }


def validate_repository_discovery_error(
    discovery: Any,
    *,
    repository_id: str,
    commit_sha: str,
    source_path_prefix: str | None,
    scanner_signature: str | None = None,
    graph_index_version: str | None = None,
) -> str | None:
    """Business purpose:
    Reject stale, malformed or pin-mismatched repository discovery before reuse or persistence.

    Business rules:
    - Repository, commit, source scope, scanner/discovery versions and optional scanner signature must match.
    - Content digest and discovery identity must bind the complete deterministic payload.
    - Required observation collections must remain arrays; missing output is never evidence of absence.

    Execution flow:
    1. Validate coordinates, versions, signature and collection shapes.
    2. Recompute cache identity from immutable scanner coordinates.
    3. Recompute the content digest and require discoveryId to match it.

    Failure cases:
    - Return a descriptive string for every invalid or stale artifact; return null only for valid input.

    Side effects:
    - Pure validation without cache mutation or source access.
    """
    if not isinstance(discovery, dict):
        return "discovery must be a dictionary"
    prefix = validate_source_path_prefix(source_path_prefix)
    if discovery.get("repositoryId") != repository_id:
        return "repositoryId mismatch"
    if str(discovery.get("commitSha", "")).lower() != commit_sha.lower():
        return "commitSha mismatch"
    if validate_source_path_prefix(discovery.get("sourcePathPrefix")) != prefix:
        return "sourcePathPrefix mismatch"
    if discovery.get("scannerVersion") != SCANNER_VERSION or discovery.get("discoveryVersion") != DISCOVERY_VERSION:
        return "discovery version mismatch"
    signature = discovery.get("scannerSignature")
    if not isinstance(signature, str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", signature):
        return "invalid scannerSignature"
    if scanner_signature is not None and signature != scanner_signature:
        return "scannerSignature mismatch"
    graph_version = discovery.get("graphIndexVersion")
    if not isinstance(graph_version, str) or not graph_version or len(graph_version) > 200:
        return "invalid graphIndexVersion"
    if graph_index_version is not None and graph_version != graph_index_version:
        return "graphIndexVersion mismatch"
    expected_cache_identity = _discovery_sha256(
        json.dumps(
            [
                repository_id,
                commit_sha.lower(),
                prefix,
                SCANNER_VERSION,
                DISCOVERY_VERSION,
                signature,
                graph_version,
            ],
            separators=(",", ":"),
        )
    )
    if discovery.get("cacheIdentity") != expected_cache_identity:
        return "cacheIdentity mismatch"
    for key in (
        "sourceRanges",
        "aiUseCases",
        "ruleCandidates",
        "knownGaps",
        "unsupportedLanguages",
        "skippedPaths",
        "unresolvedCalls",
    ):
        if not isinstance(discovery.get(key), list):
            return f"field '{key}' must be a list"
    if not isinstance(discovery.get("scannedFileCount"), int) or discovery["scannedFileCount"] < 0:
        return "scannedFileCount must be a non-negative integer"
    if not isinstance(discovery.get("resourceLedger"), dict):
        return "resourceLedger must be a dictionary"
    expected_digest = compute_discovery_digest(discovery)
    if discovery.get("contentDigest") != expected_digest or discovery.get("discoveryId") != expected_digest:
        return "contentDigest or discoveryId mismatch"
    return None


def ensure_repository_discovery(
    backend: object,
    *,
    repository_id: str,
    commit_sha: str,
    source_path_prefix: str | None = None,
    workspace_path: Path | str = "/workspace/repository",
    graph_index_version: str = "UNAVAILABLE",
) -> dict[str, Any]:
    """Business purpose:
    Reuse or produce a versioned repository discovery artifact inside the guarded repository sandbox.

    Business rules:
    - Reuse requires exact pins, versions, content integrity and the current scanner source signature.
    - Docker-capable backends execute only the staged trusted scanner with isolated Python.
    - Sandbox failures fail closed; no host-filesystem fallback may inspect customer source.

    Execution flow:
    1. Validate scope and current scanner signature, then inspect the cached runtime artifact.
    2. Reuse only a fully valid artifact bound to the current signature and immutable coordinates.
    3. Otherwise execute discovery inside the sandbox, or use local traversal only for non-executing test backends.
    4. Reuse the pinned Codebase Memory graph for bounded caller/callee priorities when available.
    5. Validate and write the new artifact marker for deterministic reuse.

    Failure cases:
    - Staging, execution, JSON parsing or validation failures raise RuntimeError without returning partial results.

    Side effects:
    - May write a trusted scanner staging file and repository discovery marker inside the sandbox runtime area.
    """
    prefix = validate_source_path_prefix(source_path_prefix)
    read = getattr(backend, "read", None)
    write = getattr(backend, "write", None)
    execute = getattr(backend, "execute", None)
    scanner_source = Path(__file__).read_text(encoding="utf-8")
    scanner_signature = _discovery_sha256(scanner_source)

    if callable(read):
        try:
            cached_raw = read(REPOSITORY_DISCOVERY_PATH)
            cached_str: str | None = None
            if isinstance(cached_raw, str):
                cached_str = cached_raw
            elif hasattr(cached_raw, "file_data") and isinstance(cached_raw.file_data, dict):
                cached_str = cached_raw.file_data.get("content")
            elif not getattr(cached_raw, "error", None) and hasattr(cached_raw, "content"):
                cached_str = cached_raw.content
            elif hasattr(cached_raw, "read"):
                cached_str = cached_raw.read()
            if cached_str:
                cached = json.loads(str(cached_str))
                if validate_repository_discovery_error(
                    cached,
                    repository_id=repository_id,
                    commit_sha=commit_sha,
                    source_path_prefix=prefix,
                    scanner_signature=scanner_signature,
                    graph_index_version=graph_index_version,
                ) is None:
                    return cached
        except Exception:
            pass

    if callable(execute):
        if not callable(write):
            raise RuntimeError("Sandbox backend does not provide required write capability to stage trusted discovery scanner")
        staged_path = f"/tmp/.lcsp_scanner_{scanner_signature.removeprefix('sha256:')[:16]}.py"
        try:
            write_result = write(staged_path, scanner_source)
        except Exception as err:
            raise RuntimeError(f"Failed to stage discovery scanner into sandbox: {err}") from err
        write_error = getattr(write_result, "error", None) or (
            write_result.get("error") if isinstance(write_result, dict) else None
        )
        if write_error:
            raise RuntimeError(f"Failed to stage discovery scanner into sandbox: {write_error}")
        prefix_flag = f" --source-path-prefix {shlex.quote(prefix)}" if prefix else ""
        command = (
            f"python3 -I {staged_path} --artifact discovery "
            f"--workspace {shlex.quote(str(workspace_path))} "
            f"--repository-id {shlex.quote(repository_id)} "
            f"--commit-sha {shlex.quote(commit_sha)}{prefix_flag} "
            f"--graph-index-version {shlex.quote(graph_index_version)}"
        )
        try:
            result = execute(command, timeout=300)
        except Exception as err:
            raise RuntimeError(f"Docker sandbox repository discovery execution failed: {err}") from err
        exit_code = getattr(result, "exit_code", getattr(result, "returncode", None))
        if exit_code != 0:
            output = getattr(result, "output", "") or getattr(result, "stderr", "")
            raise RuntimeError(f"Docker sandbox repository discovery failed with exit code {exit_code}: {output}")
        lines = [line.strip() for line in str(getattr(result, "output", "") or "").splitlines() if line.strip()]
        discovered = None
        for line in reversed(lines):
            if line.startswith("{") and line.endswith("}"):
                try:
                    discovered = json.loads(line)
                    break
                except Exception:
                    continue
        if discovered is None:
            raise RuntimeError("Docker sandbox repository discovery produced no valid JSON output")
    else:
        discovered = scan_repository_discovery(
            workspace_path,
            repository_id=repository_id,
            commit_sha=commit_sha,
            source_path_prefix=prefix,
            graph_index_version=graph_index_version,
        )

    if callable(execute):
        discovered = _enrich_repository_discovery_from_graph(
            discovered,
            execute=execute,
        )

    validation_error = validate_repository_discovery_error(
        discovered,
        repository_id=repository_id,
        commit_sha=commit_sha,
        source_path_prefix=prefix,
        scanner_signature=scanner_signature,
        graph_index_version=graph_index_version,
    )
    if validation_error:
        raise RuntimeError(f"Repository discovery produced invalid artifact: {validation_error}")
    if callable(write):
        write_result = write(
            REPOSITORY_DISCOVERY_PATH,
            json.dumps(discovered, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
        )
        write_error = getattr(write_result, "error", None) or (
            write_result.get("error") if isinstance(write_result, dict) else None
        )
        if write_error:
            raise RuntimeError(f"Failed to persist repository discovery marker: {write_error}")
    return discovered


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


def validate_repository_profile_error(
    profile: Any,
    *,
    repository_id: str,
    commit_sha: str,
    source_path_prefix: str | None,
) -> str | None:
    """Business purpose:
    Validate that a repository profile matches expected coordinates, required schema, and digest.

    Business rules:
    - Verifies repositoryId, commitSha (case-insensitive), sourcePathPrefix, and scannerVersion.
    - Requires all observation collections to be lists and scannedFileCount to be a non-negative int.
    - Asserts contentDigest matches the calculated deterministic SHA-256 digest.

    Execution flow:
    1. Check top-level type is a dictionary.
    2. Check coordinates match expected arguments.
    3. Verify required collection keys exist and are lists.
    4. Compute expected content digest and compare against profile contentDigest.
    5. Return None if valid, or an error string describing the mismatch.

    Failure cases:
    - Any missing field, wrong type, pin mismatch, or digest discrepancy returns an error string.

    Side effects:
    - Pure computation without I/O or state modification.
    """
    if not isinstance(profile, dict):
        return "profile must be a dictionary"
    if profile.get("repositoryId") != repository_id:
        return f"repositoryId mismatch: expected {repository_id}, got {profile.get('repositoryId')}"
    if str(profile.get("commitSha", "")).lower() != commit_sha.lower():
        return f"commitSha mismatch: expected {commit_sha.lower()}, got {profile.get('commitSha')}"
    if validate_source_path_prefix(profile.get("sourcePathPrefix")) != source_path_prefix:
        return f"sourcePathPrefix mismatch: expected {source_path_prefix}, got {profile.get('sourcePathPrefix')}"
    if profile.get("scannerVersion") != SCANNER_VERSION:
        return f"scannerVersion mismatch: expected {SCANNER_VERSION}, got {profile.get('scannerVersion')}"
    if not isinstance(profile.get("scannedFileCount"), int) or profile["scannedFileCount"] < 0:
        return "scannedFileCount must be a non-negative integer"
    for key in (
        "languages",
        "manifests",
        "frameworks",
        "buildSystems",
        "ciWorkflows",
        "containerization",
        "candidateFacts",
        "knownGaps",
    ):
        if not isinstance(profile.get(key), list):
            return f"field '{key}' must be a list"

    digest = profile.get("contentDigest")
    if not isinstance(digest, str) or not digest.startswith("sha256:"):
        return f"invalid contentDigest format: {digest}"

    expected_digest = compute_profile_digest(profile)
    if digest != expected_digest:
        return f"contentDigest mismatch: expected {expected_digest}, got {digest}"

    return None


def is_valid_repository_profile(
    profile: Any,
    *,
    repository_id: str,
    commit_sha: str,
    source_path_prefix: str | None,
) -> bool:
    """Business purpose:
    Boolean predicate verifying repository profile validity.

    Business rules:
    - Returns True if and only if validate_repository_profile_error returns None.

    Execution flow:
    1. Delegate to validate_repository_profile_error.
    2. Return boolean result.

    Failure cases:
    - Returns False for invalid profiles.

    Side effects:
    - Pure computation without I/O or state modification.
    """
    return validate_repository_profile_error(
        profile,
        repository_id=repository_id,
        commit_sha=commit_sha,
        source_path_prefix=source_path_prefix,
    ) is None


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
    - If an existing profile marker matches (repositoryId, commitSha, sourcePathPrefix, scannerVersion)
      and has a valid schema and content digest, reuse it directly without rescanning.
    - If missing or invalid, scan the workspace.
    - When backend provides execution capability (Docker sandbox backend), run bounded scanner command
      inside the sandbox using isolated Python (`python3 -I`) and scrubbed sys.path.
    - If sandbox execution fails, raise an explicit RuntimeError; NEVER fall back to the host filesystem.
    - Validate returned profile schema and verify content digest integrity before returning or caching.
    - A missing workspace must record an explicit known gap/error rather than a silent empty profile.

    Execution flow:
    1. Validate source path prefix.
    2. Attempt to read existing profile marker from REPOSITORY_PROFILE_PATH.
    3. If valid and matching pins and content digest, return cached profile.
    4. If backend provides execution capability (callable `execute`), run bounded scanner inside sandbox.
    5. If execution fails or output is invalid, raise RuntimeError without fallback.
    6. If backend lacks execution capability, run scan using local filesystem adapter.
    7. Validate profile schema and content digest.
    8. Write valid profile to REPOSITORY_PROFILE_PATH in backend and return.

    Failure cases:
    - Sandbox execution failure or malformed output raises RuntimeError.
    - Profile validation failure raises RuntimeError.

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
            cached_str: str | None = None
            if isinstance(cached_raw, str):
                cached_str = cached_raw
            elif hasattr(cached_raw, "file_data") and isinstance(cached_raw.file_data, dict):
                cached_str = cached_raw.file_data.get("content")
            elif not getattr(cached_raw, "error", None) and hasattr(cached_raw, "content"):
                cached_str = cached_raw.content
            elif hasattr(cached_raw, "read"):
                cached_str = cached_raw.read()

            if cached_str:
                cached = json.loads(str(cached_str))
                if is_valid_repository_profile(
                    cached,
                    repository_id=repository_id,
                    commit_sha=commit_sha,
                    source_path_prefix=source_path_prefix,
                ):
                    return cached
        except Exception:
            pass

    profile: dict[str, Any]

    # If backend supports execution, run scanner in sandbox container with isolated Python
    if callable(execute):
        if not callable(write):
            raise RuntimeError("Sandbox backend does not provide required write capability to stage trusted scanner")

        # Stage the trusted, self-contained scanner into /tmp in the sandbox backend
        # Version the staged path with the scanner's content digest to prevent stale script execution
        scanner_source = Path(__file__).read_text(encoding="utf-8")
        scanner_digest = hashlib.sha256(scanner_source.encode("utf-8")).hexdigest()
        staged_scanner_path = f"/tmp/.lcsp_scanner_{scanner_digest[:16]}.py"

        try:
            write_result = write(staged_scanner_path, scanner_source)
        except Exception as err:
            raise RuntimeError(f"Failed to stage pre-scan tool into sandbox: {err}") from err

        write_err = getattr(write_result, "error", None) or (
            write_result.get("error") if isinstance(write_result, dict) else None
        )
        if write_err:
            raise RuntimeError(f"Failed to stage pre-scan tool into sandbox: {write_err}")

        prefix_flag = f" --source-path-prefix {shlex.quote(source_path_prefix)}" if source_path_prefix else ""
        cmd = (
            f"python3 -I {staged_scanner_path} "
            f"--workspace {shlex.quote(str(workspace_path))} "
            f"--repository-id {shlex.quote(repository_id)} "
            f"--commit-sha {shlex.quote(commit_sha)}"
            f"{prefix_flag}"
        )
        try:
            res = execute(cmd, timeout=300)
        except Exception as err:
            raise RuntimeError(f"Docker sandbox repository pre-scan execution failed: {err}") from err

        exit_code = getattr(res, "exit_code", None)
        if exit_code is None and hasattr(res, "returncode"):
            exit_code = res.returncode
        if exit_code != 0:
            out_err = getattr(res, "output", "") or getattr(res, "stderr", "")
            raise RuntimeError(f"Docker sandbox repository pre-scan failed with exit code {exit_code}: {out_err}")

        out = str(getattr(res, "output", "") or "").strip()
        lines = [line.strip() for line in out.splitlines() if line.strip()]
        scanned_profile = None
        for line in reversed(lines):
            if line.startswith("{") and line.endswith("}"):
                try:
                    scanned_profile = json.loads(line)
                    break
                except Exception:
                    continue

        if not scanned_profile:
            raise RuntimeError("Docker sandbox repository pre-scan produced no valid JSON profile output")

        validation_error = validate_repository_profile_error(
            scanned_profile,
            repository_id=repository_id,
            commit_sha=commit_sha,
            source_path_prefix=source_path_prefix,
        )
        if validation_error:
            raise RuntimeError(f"Docker sandbox repository pre-scan produced invalid profile: {validation_error}")

        profile = scanned_profile
    else:
        # Fallback to local filesystem scan only when backend has no execution capability (e.g. offline tests)
        profile = scan_repository_workspace(
            workspace_path,
            repository_id=repository_id,
            commit_sha=commit_sha,
            source_path_prefix=source_path_prefix,
        )
        validation_error = validate_repository_profile_error(
            profile,
            repository_id=repository_id,
            commit_sha=commit_sha,
            source_path_prefix=source_path_prefix,
        )
        if validation_error:
            raise RuntimeError(f"Repository pre-scan produced invalid profile: {validation_error}")

    if callable(write):
        try:
            write(REPOSITORY_PROFILE_PATH, json.dumps(profile, separators=(",", ":"), sort_keys=True))
        except Exception:
            pass

    return profile


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Deterministic offline repository pre-scan")
    parser.add_argument("--workspace", required=True, help="Workspace directory to scan")
    parser.add_argument("--repository-id", required=True, help="Repository ID")
    parser.add_argument("--commit-sha", required=True, help="Commit SHA")
    parser.add_argument("--source-path-prefix", default=None, help="Optional source path prefix")
    parser.add_argument(
        "--artifact",
        choices=("profile", "discovery"),
        default="profile",
        help="Artifact to emit without changing the historical profile contract",
    )
    parser.add_argument(
        "--graph-index-version",
        default="UNAVAILABLE",
        help="Pinned Codebase Memory index stamp for discovery cache identity",
    )
    parsed_args = parser.parse_args()

    if parsed_args.artifact == "discovery":
        scanned = scan_repository_discovery(
            parsed_args.workspace,
            repository_id=parsed_args.repository_id,
            commit_sha=parsed_args.commit_sha,
            source_path_prefix=parsed_args.source_path_prefix or None,
            graph_index_version=parsed_args.graph_index_version,
        )
    else:
        scanned = scan_repository_workspace(
            parsed_args.workspace,
            repository_id=parsed_args.repository_id,
            commit_sha=parsed_args.commit_sha,
            source_path_prefix=parsed_args.source_path_prefix or None,
        )
    print(json.dumps(scanned, separators=(",", ":"), sort_keys=True))

