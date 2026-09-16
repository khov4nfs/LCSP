"""
Shared fixtures for deepagents test suite.

All fixtures default to isolated, ephemeral state. No shared mutable state between tests.
"""
import importlib.util
import os
import sys
import tempfile
from pathlib import Path
from typing import Generator

import pytest
from dotenv import dotenv_values, find_dotenv


ROOT_DIR = Path(__file__).resolve().parents[1]
ROOT_PATH = str(ROOT_DIR)
if ROOT_PATH not in sys.path:
    sys.path.insert(0, ROOT_PATH)

_SESSION_DOTENV_PATH = find_dotenv(usecwd=True)
_SESSION_DOTENV_KEYS = frozenset(
    dotenv_values(_SESSION_DOTENV_PATH).keys()
    if _SESSION_DOTENV_PATH
    else ()
)
for _dotenv_key in _SESSION_DOTENV_KEYS:
    os.environ.pop(_dotenv_key, None)


# Test bridge for historical tests that load legal utilities by physical file
# path instead of importing the package. Production code owns legal utilities
# under tools/legal.
_original_spec_from_file_location = importlib.util.spec_from_file_location


def _canonical_test_module_path(location: object) -> object:
    if not isinstance(location, (str, bytes, Path)):
        return location
    path = Path(location)
    legal_root = ROOT_DIR / "tools" / "legal"
    legacy_script_roots = (
        ROOT_DIR / "runtime" / "legal" / "scripts",
        ROOT_DIR / "runtime" / "legal" / "sources" / "scripts",
    )
    for legacy_scripts in legacy_script_roots:
        try:
            relative_script = path.relative_to(legacy_scripts)
        except ValueError:
            continue
        return legal_root / "sources" / "scripts" / relative_script

    legacy_extractions = {
        ROOT_DIR / "runtime" / "legal" / "official_text_extraction.py",
        ROOT_DIR / "runtime" / "legal" / "sources" / "official_text_extraction.py",
        ROOT_DIR
        / "runtime"
        / "legal"
        / "sources"
        / "extraction"
        / "official_text_extraction.py",
    }
    if path in legacy_extractions:
        return legal_root / "sources" / "extraction" / "official_text_extraction.py"
    return location


def _spec_from_file_location(name, location, *args, **kwargs):
    return _original_spec_from_file_location(
        name,
        _canonical_test_module_path(location),
        *args,
        **kwargs,
    )


importlib.util.spec_from_file_location = _spec_from_file_location


@pytest.fixture(autouse=True)
def isolated_process_environment() -> Generator[None, None, None]:
    """Keep repository ``.env`` values out of the unit-test process.

    Runtime helpers intentionally load the repository ``.env`` with
    ``override=False``. Full-suite collection can invoke those helpers before any
    autouse fixture starts, which would otherwise make a developer's provider,
    credentials, or runtime config become ambient test state.

    Repository ``.env`` keys are removed as soon as this conftest loads and again
    before/after every test. Tests that need runtime configuration must declare it
    explicitly with ``monkeypatch`` or a fixture. Pytest/plugin-owned environment
    variables are left untouched.
    """
    _clear_dotenv_environment()
    try:
        yield
    finally:
        _clear_dotenv_environment()


def _clear_dotenv_environment() -> None:
    for key in _SESSION_DOTENV_KEYS:
        os.environ.pop(key, None)


@pytest.fixture(autouse=True)
def isolated_legal_storage_root(
    tmp_path_factory: pytest.TempPathFactory,
    isolated_process_environment: None,
) -> Generator[None, None, None]:
    """Keep recovery artifacts and singleton locks out of the real .corpus root.

    Recovery artifacts double as triage completion markers, so a test writing into the
    developer's storage root can silently mark real LegalRules as already triaged.

    This deliberately does not use `monkeypatch`: requesting it here would build it
    before every test's own fixtures and so delay its undo past their teardown, which
    breaks tests that patch module globals their teardown still depends on.
    """
    previous = os.environ.get("LEGAL_SOURCE_STORAGE_ROOT")
    os.environ["LEGAL_SOURCE_STORAGE_ROOT"] = str(
        tmp_path_factory.mktemp("legal-storage")
    )
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop("LEGAL_SOURCE_STORAGE_ROOT", None)
        else:
            os.environ["LEGAL_SOURCE_STORAGE_ROOT"] = previous


@pytest.fixture
def workspace_dir() -> Generator[Path, None, None]:
    """Ephemeral workspace directory — deleted after each test."""
    with tempfile.TemporaryDirectory(prefix="lcsp-test-ws-") as tmp:
        yield Path(tmp)


@pytest.fixture
def sample_python_repo(workspace_dir: Path) -> Path:
    """Minimal Python repo with detectable AI usage."""
    (workspace_dir / "src").mkdir()
    (workspace_dir / "src" / "ai_client.py").write_text(
        "import openai\n"
        "client = openai.OpenAI()\n"
        "response = client.chat.completions.create(\n"
        "    model='gpt-4o',\n"
        "    messages=[{'role': 'user', 'content': msg}]\n"
        ")\n"
    )
    (workspace_dir / "requirements.txt").write_text("openai>=1.0.0\n")
    (workspace_dir / "pyproject.toml").write_text(
        "[project]\nname = 'test-ai-app'\ndependencies = ['openai>=1.0.0']\n"
    )
    return workspace_dir


@pytest.fixture
def sample_ts_repo(workspace_dir: Path) -> Path:
    """Minimal TypeScript repo with AI SDK usage."""
    src = workspace_dir / "src"
    src.mkdir()
    (src / "ai.ts").write_text(
        "import Anthropic from '@anthropic-ai/sdk';\n"
        "const client = new Anthropic();\n"
        "const message = await client.messages.create({model: 'claude-opus-4-5', max_tokens: 1024, messages: []});\n"
    )
    (workspace_dir / "package.json").write_text(
        '{"name": "test-ai-ts", "dependencies": {"@anthropic-ai/sdk": "^0.20.0"}}\n'
    )
    return workspace_dir


@pytest.fixture
def no_secrets_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure tests run without real API keys in environment."""
    for key in ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "LLM7_API_KEY", "GITHUB_TOKEN"]:
        monkeypatch.delenv(key, raising=False)


@pytest.fixture
def scan_job_payload() -> dict:
    """Minimal valid scan job message payload."""
    return {
        "job_id": "job-test-001",
        "snapshot_id": "snap-test-001",
        "workspace_path": "/tmp/lcsp-test-workspace",
        "config_hash": "sha256:abc123def456",
        "policy_token": "internal-policy-test-token",
    }
