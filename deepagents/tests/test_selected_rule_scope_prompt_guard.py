"""Static contract checks for selected-rule oversight scope instruction revisions.

These checks only verify packaging and policy wording. They cannot establish
legal-gold approval or measure real model semantic performance.
"""
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IDS = (
    "preparation.selected",
    "preparation.development-overlay",
    "skill.rule-preparation-actor-stage",
    "skill.rule-preparation-scope-quality",
)


def test_oversight_scope_instruction_sources_match_pending_candidate_inventory():
    inventory = json.loads((ROOT / "instructions/inventory.json").read_text(encoding="utf-8"))
    matching = {item["sourceId"]: item for item in inventory["entries"] if item["sourceId"] in IDS}
    assert set(matching) == set(IDS)
    for key in IDS:
        entry = matching[key]
        assert entry["reviewStatus"] == "PENDING_INDEPENDENT_REVIEW"
        vi = (ROOT / entry["vietnameseSourcePath"]).read_bytes()
        en = (ROOT / entry["englishCandidatePath"]).read_bytes()
        assert sha256(vi).hexdigest() == entry["sourceSha256"]
        assert sha256(en).hexdigest() == entry["englishCandidateSha256"]
        assert entry["candidateOriginSha256"] == entry["sourceSha256"]
        assert entry["translationProvenance"]["translationRevision"] == "r2"


def test_selected_run_system_prompt_separates_supervision_from_developer_duty():
    vi = (ROOT / "instructions/vi/preparation-selected.md").read_text(encoding="utf-8")
    en = (ROOT / "instructions/candidates/r1/preparation.selected.txt").read_text(encoding="utf-8")
    assert "## Cổng kiểm tra pháp lý trước khi sinh AssessmentRule" in vi
    assert "## Mandatory legal-to-AssessmentRule gate" in en
    for phrase in (
        "passive",
        "public-authority",
        "NON_ASSESSABLE",
        "nonRepositoryDuty=true",
        "requiredEvidence",
        "investigationGoals",
        "no AssessmentRule",
    ):
        assert phrase.lower() in en.lower()
    assert "không tự chứng minh" in vi
    assert "không tự thêm loại báo cáo" in vi


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
    assert "Administrative supervision versus developer controls" in overlay


def test_negative_supervision_case_is_not_a_fake_legal_gold_approval():
    # Source-derived regression scenario, not a provider/live-model test:
    source = (
        "Hệ thống trí tuệ nhân tạo có rủi ro trung bình được giám sát "
        "thông qua báo cáo, kiểm tra chọn mẫu hoặc đánh giá của tổ chức độc lập"
    )
    assert "được giám sát" in source
    prompt = (ROOT / "instructions/candidates/r1/preparation.selected.txt").read_text(encoding="utf-8")
    assert "supervision by reports, sample inspection or independent assessment" in prompt.lower()
    assert "not by itself" in prompt.lower()
    assert "return empty" in prompt.lower()
