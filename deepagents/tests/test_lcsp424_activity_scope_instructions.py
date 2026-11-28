"""Provider-free instruction wiring regression; not a semantic accuracy benchmark."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_registered_scope_guidance_preserves_historical_and_evidence_authority():
    # Verify the actual registered runtime assets, rather than only legacy Markdown.
    entries = {
        row["sourceId"]: row
        for row in json.loads((ROOT / "instructions/inventory.json").read_text(
            encoding="utf-8"
        ))["entries"]
    }

    def english(source_id):
        return (ROOT / entries[source_id]["englishCandidatePath"]).read_text(
            encoding="utf-8"
        )

    root = english("assessment-root.system")
    assert "canonical product scope is software and AI development activities" in root
    assert "historical rule-set pin, including FULL_SOURCE" in root
    assert "Do not infer NOT_APPLICABLE or NON_COMPLIANT merely from missing evidence" in root
    assert "use the existing human-fact path" in root
    researcher = english("repository-researcher.system")
    assert "production configuration" in researcher
    assert "without asking customers or deciding applicability or compliance" in researcher
    assert "observation time of its evidence" in english("skill.assessment-system-boundaries")
    selected = english("preparation.selected")
    assert "Code-search feasibility alone does not make an operational-only duty" in selected
    assert "NO_REQUIREMENT" in selected
    assert "does not grant server scope approval" in selected
