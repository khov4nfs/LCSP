from __future__ import annotations

from dataclasses import dataclass, field


USAGE_DECLARED = "declared"
USAGE_USED = "used"
USAGE_UNUSED = "unused"
USAGE_TRANSITIVE = "transitive"
USAGE_MISSING = "missing"
USAGE_UNCERTAIN = "uncertain"

AI_PACKAGE_REGISTRY = {
    "openai",
    "openai-python",
    "anthropic",
    "google-genai",
    "google-generativeai",
    "google-cloud-aiplatform",
    "vertexai",
    "transformers",
    "datasets",
    "huggingface-hub",
    "diffusers",
    "langchain",
    "langchain-core",
    "langchain-community",
    "langchain-openai",
    "langchain-anthropic",
    "langchain-google-genai",
    "llama-index",
    "llama-index-core",
    "llama_index",
    "autogen",
    "pyautogen",
    "crewai",
    "haystack-ai",
    "semantic-kernel",
    "guidance",
    "torch",
    "tensorflow",
    "keras",
    "scikit-learn",
    "sklearn",
    "xgboost",
    "lightgbm",
    "@anthropic-ai/sdk",
    "@google/generative-ai",
    "llamaindex",
    "@huggingface/inference",
}


@dataclass(frozen=True)
class DependencyUsageFact:
    """One tool's observation about how a package appears in the repository."""

    package_name: str
    version: str | None
    ecosystem: str
    usage_state: str
    source_tool: str
    file_refs: list[str] = field(default_factory=list)
    is_ai_relevant: bool = False


@dataclass(frozen=True)
class PackageDependency:
    """Normalized package record combining SBOM identity and usage observations."""

    name: str
    version: str | None
    ecosystem: str
    purl: str | None
    usage_facts: list[DependencyUsageFact]
    confidence_boost: float
    is_ai_relevant: bool = False


def normalize_package_name(name: str) -> str:
    """Canonicalize package spelling before cross-tool matching."""
    return name.strip().lower().replace("_", "-")


def is_ai_package(name: str) -> bool:
    """Return whether a package is in the deterministic AI dependency registry."""
    normalized = normalize_package_name(name)
    return normalized in AI_PACKAGE_REGISTRY
