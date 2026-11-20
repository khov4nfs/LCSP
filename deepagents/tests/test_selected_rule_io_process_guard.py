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
                   "investigationGoals", "requiredEvidence", "source"):
        assert phrase.lower() in en.lower()
    assert "Chọn ID/chọn tất cả" in vi
    assert "Explicit ID/bulk rule selection" in en
    assert "not an applicability verdict" in en.replace("**", "")


def test_selected_prompt_preserves_principles_and_identifies_missing_source_context():
    vi = text("instructions/vi/preparation-selected.md")
    en = text("instructions/candidates/r1/preparation.selected.txt")
    for prompt in (vi, en):
        assert "Ngữ cảnh pháp lý" in prompt
        assert "Thiếu căn cứ" in prompt
    assert "Điều 4 khoản 1" in vi and "điểm d khoản 1 Điều 14" in vi
    assert "Article 4(1)" in en and "Article 14(1)(d)" in en
    assert "Một chiều có căn cứ là đủ" in vi
    assert "One grounded dimension is enough" in en
    assert "Nếu thiếu câu dẫn khoản 1" in vi
    assert "If the Article 14(1) lead-in is missing" in en


def test_selected_prompt_prepares_oversight_prohibition_with_general_actor_and_open_scope():
    vi = text("instructions/vi/preparation-selected.md")
    en = text("instructions/candidates/r1/preparation.selected.txt")
    assert "Tổ chức, cá nhân thuộc phạm vi điều chỉnh" in vi
    assert "organizations and individuals within the law's scope" in en
    assert "Không yêu cầu luật mô tả từng bước triển khai" in vi
    assert "Do not require the law to state implementation steps" in en

    vi_example = vi.split("**Ví dụ Điều 7 khoản 4:**", 1)[1].splitlines()[0]
    en_example = en.split("**Article 7(4) example:**", 1)[1].splitlines()[0]
    for example in (vi_example, en_example):
        for field in ("LegalRequirement", "AssessmentRule", "PROHIBITION", "unresolvedConditionBindings"):
            assert field in example
    assert "không giới hạn toàn bộ lệnh cấm vào nhánh này" in vi_example
    assert "without narrowing the entire prohibition" in en_example
    assert "Chưa tìm thấy cơ chế hoặc bằng chứng" in vi_example
    assert "Missing evidence or an unidentified mechanism is inconclusive" in en_example


def test_selected_prompt_allows_a_general_actor_for_positive_duties():
    vi = text("instructions/vi/preparation-selected.md")
    en = text("instructions/candidates/r1/preparation.selected.txt")
    assert "Với cả nghĩa vụ phải làm và điều cấm" in vi
    assert "For both positive duties and prohibitions" in en
    assert "ghi chủ thể chưa xác định" in vi
    assert "mark the role unresolved" in en

    vi_example = vi.split("**Ví dụ giả định về nghĩa vụ tích cực:**", 1)[1].splitlines()[0]
    en_example = en.split("**Hypothetical positive duty:**", 1)[1].splitlines()[0]
    for example in (vi_example, en_example):
        for field in ("LegalRequirement", "AssessmentRule", "DUTY"):
            assert field in example
    assert "giữ đúng vai trò đó" in vi_example
    assert "keep that role in the requirement" in en_example


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
        "mark the role unresolved and preserve the supported conduct",
        "never removes a duty",
        "Both arrays are empty only when no duty is established",
        "missing material scope does not make a duty unconditional",
    ):
        assert phrase in en, phrase
    for phrase in (
        "Mặc định: giữ nghĩa vụ có căn cứ nguồn",
        "Giữ nghĩa vụ khi còn thiếu một chiều",
        "Cả hai mảng chỉ rỗng khi nguồn chưa xác lập nghĩa vụ",
        "thiếu căn cứ về phạm vi không biến nghĩa vụ thành vô điều kiện",
    ):
        assert phrase.casefold() in vi.casefold(), phrase
    assert "unresolvedConditionBindings" in en and "unresolvedConditionBindings" in vi
