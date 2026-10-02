"""Lightweight package-name signals used by persisted evidence consumers.

Repository discovery itself is performed by Deep Agents. These helpers only
normalize already-observed dependency names for compatibility with existing
report consumers.
"""

AI_PACKAGE_REGISTRY = {
    "openai", "openai-python", "anthropic", "google-genai", "google-generativeai",
    "google-cloud-aiplatform", "vertexai", "transformers", "datasets", "huggingface-hub",
    "diffusers", "langchain", "langchain-core", "langchain-community", "langchain-openai",
    "langchain-anthropic", "langchain-google-genai", "llama-index", "llama-index-core",
    "llama-index", "autogen", "pyautogen", "crewai", "haystack-ai", "semantic-kernel",
    "guidance", "torch", "tensorflow", "keras", "scikit-learn", "sklearn", "xgboost",
    "lightgbm", "@anthropic-ai/sdk", "@google/generative-ai", "llamaindex",
    "@huggingface/inference", "openrouter", "deepseek", "ollama", "boto3",
}


def normalize_package_name(name: str) -> str:
    return name.strip().lower().replace("_", "-")


def is_ai_package(name: str) -> bool:
    return normalize_package_name(name) in AI_PACKAGE_REGISTRY


__all__ = ["AI_PACKAGE_REGISTRY", "is_ai_package", "normalize_package_name"]
