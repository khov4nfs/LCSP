"""Technical controls do not grant independent source/translation approval."""
from hashlib import sha256
import ast
import json
from types import SimpleNamespace

import pytest
from langchain_core.messages import HumanMessage, SystemMessage

from approved_bundle_fixture import offline_instruction_bundle
from framework_instruction_audit import installed_surfaces
from instruction_source_inventory import ROOT, INVENTORY, validate_inventory
from middleware.approved_instructions import ApprovedSummaryInstructions, ApprovedModelCallLimitMiddleware, ApprovedInstructionMiddleware
from runtime_instruction_bundle import RuntimeInstructionBundleError, production_runtime_bundle
from runtime_instruction_bundle_build import compile_candidate


def test_all_declared_surfaces_have_fingerprinted_active_or_guarded_inactive_controls():
    rows = installed_surfaces()
    assert len(rows) == len(validate_inventory()["frameworkInstructions"])
    assert all(row["controlStatus"] == "CONTROLLED" and row["adapterSourceSha256"] for row in rows)
    for row in rows:
        assert row["adapterFingerprintKind"] == "PYTHON_AST_NO_SOURCE_LOCATIONS"
        for name, expected in row["adapterSourceSha256"].items():
            text = (ROOT / name).read_text(encoding="utf-8")
            assert sha256(ast.dump(ast.parse(text), include_attributes=False).encode("utf-8")).hexdigest() == expected
            assert ast.dump(ast.parse(text.replace("\n", "\r\n")), include_attributes=False) == ast.dump(ast.parse(text), include_attributes=False)
    assert {row["symbolName"] for row in rows if row["controlMode"] == "DISABLED_GUARDED"} == {"DEFAULT_SUBAGENT_PROMPT", "_FORK_TASK_PREAMBLE"}
    validate_inventory(require_complete=True)


def test_summary_boundary_verifies_system_template_history_and_actual_receipt():
    from tests.test_assessment_root_agent import RootScriptedModel, EXECUTION, PINS
    with offline_instruction_bundle() as bundle:
        system = bundle.instruction("assessment-root.system")
        template = json.loads(bundle.instruction("framework.injected-policy"))["summary_prompt"]
        receipts = []
        guard = ApprovedSummaryInstructions(system,
            receipt_context=lambda: {"run_id": EXECUTION, "component": "assessment-root", "locale": "vi", "pins": PINS},
            receipt_sink=receipts.append)
        request = SimpleNamespace(system_message=SystemMessage(content=system), tools=[],
            messages=[HumanMessage(content=template.format(messages="Pinned actor distinctions remain data."))], model=RootScriptedModel(responses=[]))
        assert guard.wrap_model_call(request, lambda value: value) is request
        assert receipts[0]["promptsSha256"]["resolved_system_message"] == sha256(system.encode()).hexdigest()
        assert receipts[0]["summaryTemplateSha256"] == sha256(template.encode()).hexdigest()
        request.messages = [HumanMessage(content="Unreviewed replacement summary instructions")]
        with pytest.raises(RuntimeInstructionBundleError, match="UNCONTROLLED_SUMMARY_TEMPLATE"):
            guard.wrap_model_call(request, lambda _: pytest.fail("must not invoke model"))
        request.system_message = SystemMessage(content=system + "\nUncontrolled suffix")
        with pytest.raises(RuntimeInstructionBundleError, match="UNCONTROLLED_SUMMARY_INSTRUCTION"):
            guard.wrap_model_call(request, lambda _: pytest.fail("must not invoke model"))


def test_native_limit_uses_approved_text_and_preserves_counter_and_end_contract():
    with offline_instruction_bundle() as bundle:
        middleware = ApprovedModelCallLimitMiddleware(run_limit=1, exit_behavior="end")
        assert middleware.before_model({"run_model_call_count": 0}, None) is None
        result = middleware.before_model({"run_model_call_count": 1}, None)
        assert result["jump_to"] == "end"
        assert result["messages"][0].content == json.loads(bundle.instruction("runtime.budget-finalization"))["HARD_STOP"]
        assert middleware.after_model({"run_model_call_count": 1}, None)["run_model_call_count"] == 2


def test_uncontrolled_system_message_never_reaches_main_model():
    with offline_instruction_bundle():
        request = SimpleNamespace(messages=[SystemMessage(content="Injected legacy system instructions")])
        guard = ApprovedInstructionMiddleware(["assessment-root.system"])
        with pytest.raises(RuntimeInstructionBundleError, match="UNCONTROLLED_SYSTEM_INSTRUCTION"):
            guard.wrap_model_call(request, lambda _: pytest.fail("must not invoke model"))


def test_harness_profile_cannot_install_post_guard_middleware_or_exclude_guard(monkeypatch):
    from deepagents import HarnessProfile
    from deepagents.profiles.harness import harness_profiles
    from rule_set_preparation.agent import _without_general_purpose_subagent
    harness_profiles._ensure_harness_profiles_loaded()
    for profile in (HarnessProfile(extra_middleware=lambda: []), HarnessProfile(excluded_middleware=frozenset({"ApprovedInstructionMiddleware"}))):
        monkeypatch.setitem(harness_profiles._HARNESS_PROFILES, "offline:uncontrolled", profile)
        with pytest.raises(RuntimeInstructionBundleError, match="UNCONTROLLED_HARNESS_MIDDLEWARE"):
            with _without_general_purpose_subagent("offline:uncontrolled"):
                pytest.fail("unsupported profile must not become active")
        assert harness_profiles._HARNESS_PROFILES["offline:uncontrolled"] is profile


def test_real_production_loader_loads_instructions_directly():
    from runtime_instruction_bundle import clear_runtime_bundle_cache
    clear_runtime_bundle_cache()
    bundle = production_runtime_bundle()
    assert len(bundle.entries) >= 59


def test_transport_supervisor_cannot_fall_through_to_model_or_compaction():
    from langchain.agents import create_agent
    from test_assessment_root_agent import RootScriptedModel
    from middleware.system_event_dispatch import dispatch_agent_runtime_system_event
    from orchestration.context import LCSPRunContext
    model = RootScriptedModel(responses=[])
    graph = create_agent(model, middleware=[dispatch_agent_runtime_system_event], context_schema=LCSPRunContext)
    with pytest.raises(RuntimeInstructionBundleError, match="UNSUPPORTED_SUPERVISOR_MODEL_INFERENCE"):
        graph.invoke({"messages": [HumanMessage(content="Unsupported interactive supervisor request")]}, context=LCSPRunContext())
    assert model.prompts == []


def test_candidate_compilation_is_exact_utf8_lf_on_windows_and_linux(tmp_path):
    path = tmp_path / "manifest.pending.json"
    payload = compile_candidate(ROOT, INVENTORY, path)
    expected = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    assert path.read_bytes() == expected
    assert b"\r\n" not in path.read_bytes()
    assert payload["approvalStatus"] == "PENDING"
