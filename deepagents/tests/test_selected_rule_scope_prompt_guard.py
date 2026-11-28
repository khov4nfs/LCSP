"""Static contract checks for selected-rule oversight scope instruction revisions.

These checks only verify packaging and policy wording. They cannot establish
legal-gold approval or measure real model semantic performance.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IDS = (
    "preparation.selected",
    "preparation.development-overlay",
    "skill.rule-preparation-actor-stage",
    "skill.rule-preparation-scope-quality",
)


def test_oversight_scope_instruction_sources_are_registered_without_approval_or_hashes():
    inventory = json.loads((ROOT / "instructions/inventory.json").read_text(encoding="utf-8"))
    matching = {item["sourceId"]: item for item in inventory["entries"] if item["sourceId"] in IDS}
    assert set(matching) == set(IDS)
    for key in IDS:
        entry = matching[key]
        vi = (ROOT / entry["vietnameseSourcePath"]).read_text(encoding="utf-8")
        en = (ROOT / entry["englishCandidatePath"]).read_text(encoding="utf-8")
        assert vi.strip() and en.strip()
        assert "sourceSha256" not in entry and "englishCandidateSha256" not in entry
        assert entry["translationProvenance"]["translationRevision"] == "r2"


def test_selected_run_system_prompt_separates_supervision_from_developer_duty():
    vi = (ROOT / "instructions/vi/preparation-selected.md").read_text(encoding="utf-8")
    en = (ROOT / "instructions/candidates/r1/preparation.selected.txt").read_text(encoding="utf-8")
    assert "passive description of government inspection alone does not establish a customer duty" in en
    assert "câu bị động mô tả cách cơ quan kiểm tra chưa đủ để xác lập nghĩa vụ" in vi
    for prompt in (en, vi):
        assert "nonRepositoryDuty=true" in prompt
        assert "coverage.state=NON_ASSESSABLE" in prompt
    assert "Never reference a NON_ASSESSABLE requirement from an AssessmentRule" in en
    assert "AssessmentRule không tham chiếu requirement NON_ASSESSABLE" in vi


def test_scope_skills_and_overlay_keep_development_source_authority():
    checks = (
        ("rule-preparation-actor-stage", "Passive-voice addressee"),
        ("rule-preparation-scope-quality", "oversight mechanisms are not repository document duties"),
    )
    for name, heading in checks:
        runtime = (ROOT / f"instructions/candidates/r1/skill.{name}.txt").read_text(encoding="utf-8")
        packaged = (ROOT / f"skills/{name}/SKILL.md").read_text(encoding="utf-8")
        source = (ROOT / f"skills/{name}/SKILL.vi.md").read_text(encoding="utf-8")
        assert runtime == packaged
        assert heading.lower() in runtime.lower()
        assert "không" in source.lower()
    overlay = (ROOT / "instructions/candidates/r1/preparation.development-overlay.txt").read_text(encoding="utf-8")
    assert overlay == (ROOT / "rule_set_preparation/instructions-development.md").read_text(encoding="utf-8")
    assert "Administrative supervision versus system controls" in overlay


def test_supervision_examples_leave_outputs_empty_only_for_procedure_without_duty():
    vi = (ROOT / "instructions/vi/preparation-selected.md").read_text(encoding="utf-8")
    en = (ROOT / "instructions/candidates/r1/preparation.selected.txt").read_text(encoding="utf-8")
    vi_example = next(line for line in vi.splitlines() if line.startswith("- **Giám sát hành chính:**"))
    en_example = next(line for line in en.splitlines() if line.startswith("- **Administrative supervision:**"))

    assert "Giám sát thông qua báo cáo, kiểm tra chọn mẫu hoặc đánh giá của tổ chức độc lập" in vi_example
    assert "chưa xác lập nghĩa vụ của nhà phát triển" in vi_example
    assert "Giữ mọi nghĩa vụ được quy định riêng" in vi_example
    assert "chỉ quy định thủ tục giám sát, trả legalRequirements và assessmentRules rỗng" in vi_example
    assert "Supervision by reports, sample inspection or independent assessment" in en_example
    assert "does not by itself impose a developer duty" in en_example
    assert "Preserve any separately stated duty" in en_example
    assert "only the supervision procedure, return empty legalRequirements and assessmentRules" in en_example


def test_selected_scope_includes_system_verifiable_operational_notification():
    # Guard against lifecycle-stage suppression in both registered prompt sources.
    en = (ROOT / "instructions/candidates/r1/preparation.selected.txt").read_text(encoding="utf-8")
    vi = (ROOT / "instructions/vi/preparation-selected.md").read_text(encoding="utf-8")
    assert "development-relevant duty" not in en
    assert "out-of-scope LegalRequirement" not in en
    assert "system-verifiable obligation" in en
    assert "nghĩa vụ liên quan phát triển" not in vi
    assert "LegalRequirement ngoài phạm vi" not in vi
    assert "chứng cứ giao nhận hoặc vận hành" in vi
