from __future__ import annotations

import ast
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from tools.common.capabilities.agent_runtime.invocation import invocation_boundary_manifest
from tools.common.get_legal_corpus_readiness.code import get_legal_corpus_readiness
from tools.common.retrieve_legal_basis.code import retrieve_legal_basis
from tools import mcp


def test_deep_agent_project_exports_single_native_root_agent() -> None:
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
    assert "create_deep_agent(" in source
    assert "system_prompt=SYSTEM_PROMPT" in source
    assert "context_schema=LCSPRunContext" in source
    assert "skills=[(REPOSITORY_SKILLS, \"LCSP Runtime\")]" in source
    assert "load_optional_mcp_tools()" in source


def test_remote_mcp_tools_are_optional_by_default(monkeypatch) -> None:
    monkeypatch.delenv("LCSP_ENABLE_REMOTE_MCP", raising=False)
    assert mcp.load_optional_mcp_tools() == []
    assert mcp.MCP_SERVER_TARGETS == {
        "langchain_docs": "https://docs.langchain.com/mcp",
        "langchain_reference": "https://reference.langchain.com/mcp",
    }


def test_legal_catalog_schedule_exports_application_owned_config() -> None:
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

    assert "LEGAL_CATALOG_MAINTENANCE_CRON" in assigned_names
    assert "LEGAL_CATALOG_MAINTENANCE_TIMEZONE" in assigned_names
    assert "LEGAL_CATALOG_MAINTENANCE_PROMPT" in assigned_names
    assert "_".join(("define", "schedule")) not in source
    assert "os.getenv" not in source
    assert "load_config" not in source


def test_authored_agent_tools_have_explicit_input_schema() -> None:
    authored_tools = (
        get_legal_corpus_readiness,
        retrieve_legal_basis,
    )

    for agent_tool in authored_tools:
        schema = agent_tool.args_schema.model_json_schema()
        assert schema["additionalProperties"] is False
        assert "assessment_id" not in schema["properties"]
        assert "user_id" not in schema["properties"]
        assert "workflow_run_id" not in schema["properties"]
        assert "artifact_versions" not in schema["properties"]
        assert "input" not in schema["properties"]
        assert set(schema["properties"]) - {"correlationId", "correlation_id"}


def test_agent_project_separates_authored_tools_from_runtime() -> None:
    tool_packages = {
        path.name
        for path in (PROJECT_ROOT / "tools").iterdir()
        if path.is_dir() and not path.name.startswith("__")
    }
    assert tool_packages == {
        "common",
        "legal",
        "triage",
    }
    assert not (PROJECT_ROOT / "runtime").exists()
    assert (PROJECT_ROOT / "orchestration").is_dir()
    assert (PROJECT_ROOT / "subagents").is_dir()
    assert not (PROJECT_ROOT / "subagents.py").exists()
    assert not (PROJECT_ROOT / "channels").exists()
    assert not (PROJECT_ROOT / "connectors").exists()
    assert (PROJECT_ROOT / "evals" / "tasks").is_dir()
    assert (PROJECT_ROOT / "evals" / "scaffold").is_dir()
    assert (PROJECT_ROOT / "instructions.md").is_file()
    assert not (PROJECT_ROOT / "identity.py").exists()
    assert not (PROJECT_ROOT / "memory.py").exists()
    assert not (PROJECT_ROOT / "orchestration" / "memory.py").exists()
    assert (PROJECT_ROOT / "middleware").is_dir()
    assert not (PROJECT_ROOT / "sandbox" / "__init__.py").exists()
    assert (PROJECT_ROOT / "tools" / "common" / "capabilities" / "platform" / "docker_sandbox.py").is_file()
    assert "REPOSITORY_SKILLS" in (
        PROJECT_ROOT / "tools" / "common" / "capabilities" / "platform" / "repository_sandbox.py"
    ).read_text(encoding="utf-8")
    assert (PROJECT_ROOT / "tools" / "mcp.py").is_file()
    skill_packages = {
        path.name
        for path in (PROJECT_ROOT / "skills").iterdir()
        if path.is_dir() and not path.name.startswith("__")
    }
    assert skill_packages == {"interview-context", "lcsp", "legal-rule-triage"}
    assert (PROJECT_ROOT / "skills" / "lcsp" / "SKILL.md").is_file()
    assert (PROJECT_ROOT / "skills" / "legal-rule-triage" / "SKILL.md").is_file()
    assert not (PROJECT_ROOT / "skills" / "deep_agent_skills").exists()
    assert not (PROJECT_ROOT / "src").exists()
    assert not (PROJECT_ROOT / "scripts").exists()
    assert not list((PROJECT_ROOT / "tools").glob("*/lcsp_workers"))
    assert {
        path.name
        for path in (PROJECT_ROOT / "tools").glob("*.py")
    } == {"__init__.py", "mcp.py"}
    assert not (PROJECT_ROOT / "tools" / "graph").exists()
    assert not (PROJECT_ROOT / "tools" / "classification").exists()


def test_all_former_consumers_remain_internal_agent_runtime_invocation_boundaries() -> None:
    manifest = invocation_boundary_manifest()

    assert len(manifest) == 21
    assert {entry["name"] for entry in manifest} >= {
        "scan_requested",
        "engineering_assessment_requested",
        "assessment_interview_resume_requested",
        "assessment_interview_pause_requested",
        "legal_rule_triage_requested",
        "legal_change_detection_requested",
        "agent_runtime_health_requested",
        "final_report_requested",
    }
    assert {
        "name": "agent_runtime_health_requested",
        "target": "tools.common.capabilities.agent_runtime.health_boundary:AgentRuntimeHealthBoundary",
        "boundary_source": "agent-runtime.health",
        "source_event": "internal.agent-runtime.health.v1",
    } in manifest
    assert {
        "name": "legal_rule_triage_requested",
        "target": "tools.triage.legal_rule_triage.boundary:LegalRuleTriageBoundary",
        "boundary_source": "legal.engineering-rule-readiness",
        "source_event": "command.legal-rule-triage.requested.v1",
    } in manifest
