"""EN/VI tool workflow and resume authority remain identical."""
import pytest
import json
from hashlib import sha256
from pathlib import Path

from assessment_root.tool_contracts import (
    TOOL_PLAYBOOKS_EN, TOOL_PLAYBOOKS_VI, CONTRACTS, GRAPH_CONTRACTS, describe_tool,
)
from assessment_root.agent import (
    ROOT_INSTRUCTIONS, ROOT_INSTRUCTIONS_VI,
)
from assessment_root.skills import CATALOG, load_skill


@pytest.fixture
def isolated_english_skill_bundle(tmp_path, monkeypatch):
    """Synthetic approval exists only in this temporary, explicitly injected test dependency."""
    import runtime_instruction_bundle as runtime

    root = Path(__file__).resolve().parents[1]
    source_id = "skill." + CATALOG[0][0]
    inventory = json.loads((root / "instructions/inventory.json").read_text(encoding="utf-8"))
    entry = next(row for row in inventory["entries"] if row["sourceId"] == source_id)
    vi = (root / entry["vietnameseSourcePath"]).read_bytes()
    en = (root / entry["englishCandidatePath"]).read_bytes()
    (tmp_path / "source.vi.md").write_bytes(vi)
    (tmp_path / "runtime.en.md").write_bytes(en)
    digest = lambda value: sha256(value).hexdigest()
    aggregate = lambda content: digest(json.dumps([{"sourceId": source_id, "sha256": digest(content)}], separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    manifest = {
        "bundleSchemaVersion": "LCSP_EN_RUNTIME_BUNDLE_V1", "bundleId": "TEST_ONLY_SKILL_BUNDLE",
        "approvalStatus": "APPROVED", "approvalIdentity": "TEST_ONLY_REVIEWER", "approvalRevision": "TEST_ONLY_R1",
        "vietnameseInventorySha256": aggregate(vi), "englishBundleSha256": aggregate(en),
        "entries": [{"sourceId": source_id, "vietnameseSourcePath": "source.vi.md",
            "vietnameseSourceRevision": entry.get("vietnameseSourceRevision", "r1"), "vietnameseSourceSha256": digest(vi),
            "englishRuntimePath": "runtime.en.md", "englishRuntimeSha256": digest(en)}],
    }
    path = tmp_path / "test-only-manifest.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    bundle = runtime.ApprovedEnglishRuntimeBundle.load(tmp_path, path, expected_entry_ids={source_id},
        approval_verifier=lambda value: value["approvalIdentity"] == "TEST_ONLY_REVIEWER" and value["approvalRevision"] == "TEST_ONLY_R1")
    monkeypatch.setattr(runtime, "production_runtime_bundle", lambda: bundle)
    return bundle


def test_critical_tool_workflow_has_two_locales_and_no_schema_change():
    assert TOOL_PLAYBOOKS_EN.keys() == TOOL_PLAYBOOKS_VI.keys()
    assert set(TOOL_PLAYBOOKS_EN) == set(CONTRACTS) | set(GRAPH_CONTRACTS)
    assert len(TOOL_PLAYBOOKS_EN) == 21
    for name in TOOL_PLAYBOOKS_EN:
        for locale, keys in [("en", ("WHEN:", "READ:", "NEXT:", "FAILURE:")),
                             ("vi", ("KHI DÙNG:", "ĐỌC:", "TIẾP:", "LỖI:"))]:
            text = describe_tool(name, "Canonical typed API arguments", locale)
            assert text.startswith("Canonical typed API arguments")
            assert "TOOL WORKFLOW (non-normative)" in text
            assert all(token in text for token in keys)


def test_tool_instructions_do_not_grant_authority():
    for locale in ["en", "vi"]:
        context = describe_tool("get_assessment_context", "API query", locale)
        answer = describe_tool("submit_rule_decision", "API mutation", locale)
        human = describe_tool("open_human_request", "HITL interrupt", locale)
        assert ("checkpoint memory" in context if locale == "en" else "checkpoint memory" in context)
        assert ("HITL" in answer)
        assert ("legal verdict" in human if locale == "en" else "phán quyết pháp lý" in human)


@pytest.mark.parametrize("locale", ["en", "vi"])
def test_compaction_and_resume_keep_selected_locale_and_canonical_ids(locale, isolated_english_skill_bundle):
    root = ROOT_INSTRUCTIONS if locale == "en" else ROOT_INSTRUCTIONS_VI
    for key in ["get_assessment_context", "open_human_request",
                "cite_repository_source", "SELECTED_RULES", "FULL_RULE_SET"]:
        assert key in root
    for key in ["get_assessment_context", "submit_rule_decision"]:
        assert key in TOOL_PLAYBOOKS_EN and key in TOOL_PLAYBOOKS_VI
    # Presentation locale never selects model instruction language.
    skill = load_skill(CATALOG[0][0], locale)
    assert skill["locale"] == "en" and skill["authority"] == "NON_NORMATIVE_INVESTIGATION_GUIDANCE"
    assert skill["instructions"] == isolated_english_skill_bundle.instruction("skill." + CATALOG[0][0])
    assert skill["contentSha256"] == sha256(skill["instructions"].encode("utf-8")).hexdigest()
    assert skill == load_skill(CATALOG[0][0], "vi" if locale == "en" else "en")

@pytest.mark.parametrize("locale,keywords", [
    ("en", ("WHEN:", "READ:", "NEXT:", "FAILURE:")),
    ("vi", ("KHI DÙNG:", "ĐỌC:", "TIẾP:", "LỖI:")),
])
def test_every_governed_tool_has_actionable_bounded_playbook(locale, keywords):
    contracts = {**CONTRACTS, **GRAPH_CONTRACTS}
    for name in contracts:
        result = describe_tool(name, "Canonical schema and permissions.", locale)
        assert all(label in result for label in keywords), (locale, name)
        assert "Canonical schema and permissions." in result
        assert len(result) > 100
        assert "ASSESSMENT TOOL CONTRACT:" in result
    assert describe_tool("unknown-tool", "Keep original", locale) == "Keep original"


def test_both_locales_include_explicit_no_hallucination_decision_flow():
    for root in (ROOT_INSTRUCTIONS, ROOT_INSTRUCTIONS_VI):
        assert "get_assessment_context" in root
        assert "get_pinned_rule_set" in root
        assert "get_assessment_rule" in root
        assert "open_human_request" in root
        assert "NOT_ESTABLISHED" in root
        assert "record_search_coverage" in root
        assert "request_finalization" in root
    assert "Decision transaction" in ROOT_INSTRUCTIONS
    assert "Giao dịch ra quyết định" in ROOT_INSTRUCTIONS_VI
