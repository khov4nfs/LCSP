from __future__ import annotations

import ast
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from tools.common.capabilities.managed.invocation import invocation_boundary_manifest
from tools.common.get_assessment_context.code import get_assessment_context
from tools.common.get_legal_corpus_readiness.code import get_legal_corpus_readiness
from tools.common.retrieve_legal_basis.code import retrieve_legal_basis
from tools.orchestration.request_targeted_reanalysis.code import (
    request_targeted_reanalysis,
)


def test_managed_deep_agent_project_exports_single_root_agent() -> None:
    source = (PROJECT_ROOT / "agent.py").read_text()
    tree = ast.parse(source)

    assigned_names = {
        target.id
        for node in tree.body
        if isinstance(node, ast.Assign)
        for target in node.targets
        if isinstance(target, ast.Name)
    }

    assert "agent" in assigned_names
    assert "agents" not in assigned_names
    assert "system_prompt=" not in source
    assert "context_schema=LCSPRunContext" in source


def test_managed_schedule_exports_static_schedule_declaration() -> None:
    schedule_path = PROJECT_ROOT / "schedules" / "legal_catalog_daily.py"
    source = schedule_path.read_text()
    tree = ast.parse(source)

    assigned_names = {
        target.id
        for node in tree.body
        if isinstance(node, ast.Assign)
        for target in node.targets
        if isinstance(target, ast.Name)
    }

    assert "schedule" in assigned_names
    assert "os.getenv" not in source
    assert "load_config" not in source


def test_authored_managed_tools_have_explicit_input_schema() -> None:
    authored_tools = (
        get_assessment_context,
        get_legal_corpus_readiness,
        retrieve_legal_basis,
        request_targeted_reanalysis,
    )

    for managed_tool in authored_tools:
        schema = managed_tool.args_schema.model_json_schema()
        assert schema["additionalProperties"] is False
        assert "assessment_id" in schema["properties"]
        assert "input" in schema["properties"]


def test_managed_project_separates_authored_tools_from_runtime() -> None:
    tool_packages = {
        path.name
        for path in (PROJECT_ROOT / "tools").iterdir()
        if path.is_dir() and not path.name.startswith("__")
    }
    assert tool_packages == {
        "common",
        "legal",
        "planner",
        "investigator",
        "resolver",
        "orchestration",
        "triage",
    }
    assert not (PROJECT_ROOT / "runtime").exists()
    assert (PROJECT_ROOT / "orchestration").is_dir()
    assert (PROJECT_ROOT / "subagents").is_dir()
    assert not (PROJECT_ROOT / "subagents.py").exists()
    assert (PROJECT_ROOT / "channels").is_dir()
    assert (PROJECT_ROOT / "connectors").is_dir()
    assert (PROJECT_ROOT / "evals" / "tasks").is_dir()
    assert (PROJECT_ROOT / "evals" / "scaffold").is_dir()
    assert (PROJECT_ROOT / "instructions.md").is_file()
    assert (PROJECT_ROOT / "identity.py").is_file()
    # MDA deployment-shared long-term memory is intentionally disabled for LCSP.
    assert not (PROJECT_ROOT / "memory.py").exists()
    assert not (PROJECT_ROOT / "orchestration" / "memory.py").exists()
    assert (PROJECT_ROOT / "middleware").is_dir()
    assert (PROJECT_ROOT / "sandbox" / "__init__.py").is_file()
    assert (PROJECT_ROOT / "skills" / "lcsp" / "SKILL.md").is_file()
    assert not (PROJECT_ROOT / "src").exists()
    assert not (PROJECT_ROOT / "scripts").exists()
    assert not list((PROJECT_ROOT / "tools").glob("*/lcsp_workers"))
    assert {
        path.name
        for path in (PROJECT_ROOT / "tools").glob("*.py")
    } == {"__init__.py"}
    assert not (PROJECT_ROOT / "tools" / "graph").exists()
    assert not (PROJECT_ROOT / "tools" / "classification").exists()


def test_all_former_consumers_remain_internal_managed_invocation_boundaries() -> None:
    manifest = invocation_boundary_manifest()

    assert len(manifest) == 23
    assert {entry["name"] for entry in manifest} >= {
        "scan_requested",
        "engineering_assessment_requested",
        "legal_change_detection_requested",
        "final_report_requested",
    }
