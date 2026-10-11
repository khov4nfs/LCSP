from __future__ import annotations

import importlib
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))


def test_removed_llm_infrastructure_has_no_runtime_tree() -> None:
    llm = PROJECT_ROOT / "runtime" / "infrastructure" / "llm"

    assert not llm.exists()


def test_sandbox_is_owned_by_lcsp_docker_backend() -> None:
    module = importlib.import_module(
        "tools.common.capabilities.platform.docker_sandbox"
    )

    assert Path(str(module.__file__)).resolve() == (
        PROJECT_ROOT / "tools" / "common" / "capabilities" / "platform" / "docker_sandbox.py"
    )
    assert module.DEFAULT_IMAGE == "lcsp-agent-runtime:dev"


def test_legacy_model_runtime_is_removed() -> None:
    orchestration = PROJECT_ROOT / "orchestration"
    assert not (orchestration / "deep_agent_client.py").exists()
    assert not (orchestration / "provider_fallback.py").exists()
    assert not (orchestration / "model_runtime.py").exists()
    assert not (PROJECT_ROOT / "skills" / "lcsp").exists()
    assert (PROJECT_ROOT / "assessment_root" / "agent.py").is_file()
    assert (PROJECT_ROOT / "assessment_root" / "instructions.md").is_file()
    assert (PROJECT_ROOT / "rule_set_preparation" / "agent.py").is_file()
