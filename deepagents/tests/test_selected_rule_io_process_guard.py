"""Provider-free packaging checks for INPUT / OUTPUT / PROCESS Preparation semantics.

These assertions test instruction wiring and output schema guidance, not legal-gold
truth, model understanding, real provider calls or compliance performance.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def text(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def test_selected_preparation_includes_three_dimension_legal_gate_in_both_languages():
    vi = text("instructions/vi/preparation-selected.md")
    en = text("instructions/candidates/r1/preparation.selected.txt")
    assert "Cổng phân tích INPUT → OUTPUT → QUY TRÌNH" in vi
    assert "INPUT → OUTPUT → PROCESS legal semantic gate" in en
    for phrase in ("INPUT", "OUTPUT", "PROCESS", "unresolvedConditionBindings", "NON_ASSESSABLE",
                   "investigationGoals", "requiredEvidence", "developer", "source"):
        assert phrase.lower() in en.lower()
    assert "lựa chọn" not in vi or "Chọn ID/chọn tất cả" in vi
    assert "Explicit ID/bulk rule selection" in en
    assert "not an applicability verdict" in en.replace("**", "")


def test_packaged_skill_copies_and_development_overlay_match_runtime_registry():
    pairs = (
        ("instructions/candidates/r1/skill.rule-preparation-actor-stage.txt",
         "skills/rule-preparation-actor-stage/SKILL.md"),
        ("instructions/candidates/r1/skill.rule-preparation-scope-quality.txt",
         "skills/rule-preparation-scope-quality/SKILL.md"),
        ("instructions/candidates/r1/preparation.development-overlay.txt",
         "rule_set_preparation/instructions-development.md"),
    )
    for runtime, packaged in pairs:
        assert text(runtime) == text(packaged)
        assert "INPUT" in text(runtime) and "OUTPUT" in text(runtime) and "PROCESS" in text(runtime)
    assert "INPUT" in text("skills/rule-preparation-scope-quality/SKILL.vi.md")
    assert "QUY TRÌNH" in text("skills/rule-preparation-actor-stage/SKILL.vi.md")


def test_generated_output_schema_preserves_existing_evidence_contract():
    # The JSON schema is code-generated from Zod. Instruction wording must not
    # change these validated fields or introduce new compulsory file artifacts.
    schema = json.loads(text("rule_set_preparation/selected-output.schema.json"))
    rule = schema["properties"]["assessmentRules"]["items"]["properties"]
    assert rule["investigationGoals"]["type"] == "array"
    assert rule["requiredEvidence"]["type"] == "array"
    focus = rule["criteria"]["items"]["properties"]["investigationFocus"]["description"]
    assert "investigation strategy" in focus.lower()


def test_inventory_instruction_loading_requires_no_manual_approval_or_instruction_sha():
    inventory = json.loads(text("instructions/inventory.json"))
    ids = {row["sourceId"] for row in inventory["entries"]}
    assert {"preparation.selected", "preparation.development-overlay",
            "skill.rule-preparation-actor-stage", "skill.rule-preparation-scope-quality"} <= ids
    for row in inventory["entries"]:
        assert "sourceSha256" not in row
        assert "englishCandidateSha256" not in row
        assert "candidateOriginSha256" not in row


def test_selected_prompt_preserves_supported_duties_instead_of_blocking_on_uncertainty():
    # Static wiring only: guards against the gates drifting back into delete-on-doubt.
    en = text("instructions/candidates/r1/preparation.selected.txt").replace("**", "")
    vi = text("instructions/vi/preparation-selected.md").replace("**", "")
    for phrase in (
        "Default: preserve a source-supported duty",
        "ambiguity of actor is a legal-review note, not a ground to drop the duty",
        "is never a reason to drop the duty",
        "Trim criteria, not duties",
        "never removes a duty",
        "empty is the exception",
    ):
        assert phrase in en, phrase
    for phrase in ("Mặc định: giữ nghĩa vụ có căn cứ nguồn", "Cắt tiêu chí, không cắt nghĩa vụ", "rỗng là ngoại lệ"):
        assert phrase in vi, phrase
    assert "unresolvedConditionBindings" in en and "unresolvedConditionBindings" in vi
