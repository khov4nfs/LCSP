from __future__ import annotations

from pathlib import Path

from lcsp_workers.scanner.evidence_assembler import EvidenceAssembler
from lcsp_workers.scanner.parsers.structural_augmentor import StructuralAugmentor
from lcsp_workers.scanner.parsers.tree_sitter_parser import StructuralParser
from lcsp_workers.scanner.tools.semgrep_tool import SemgrepFinding, SemgrepRunResult
from lcsp_workers.scanner.tools.tool_base import OUTCOME_SUCCESS, ToolExecutionResult


def _semgrep_result() -> SemgrepRunResult:
    return SemgrepRunResult(
        findings=[
            SemgrepFinding(
                rule_id="lcsp.openai-client",
                signal_type="provider_integration",
                file_path="src/ai.py",
                line_start=3,
                line_end=3,
                message="OpenAI client import detected",
                severity="INFO",
            )
        ],
        executions=[
            ToolExecutionResult(
                tool_name="semgrep_ai_usage",
                tool_version="semgrep 1.99.0",
                outcome=OUTCOME_SUCCESS,
                config_hash="sha256:semgrep-ai",
                messages=[],
            )
        ],
        redaction_applied=False,
    )


def test_structural_parser_falls_back_to_regex_for_route_and_async_patterns(tmp_path: Path) -> None:
    file_path = tmp_path / "src" / "ai.py"
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(
        "@router.get('/predict')\n"
        "async def predict(request):\n"
        "    return client.chat.completions.create(messages=[...] )\n",
        encoding="utf-8",
    )

    facts = StructuralParser().parse_file(file_path)
    assert any(fact.pattern_type == "route_handler" for fact in facts)
    assert any(fact.pattern_type == "async_ai_function" for fact in facts)
    assert all(fact.parse_source == "custom_regex_fallback" for fact in facts)


def test_structural_augmentor_links_facts_to_existing_findings(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    target = workspace / "src" / "ai.py"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        "@router.get('/predict')\n"
        "async def predict(request):\n"
        "    return client.chat.completions.create(messages=[...])\n",
        encoding="utf-8",
    )

    augmentor = StructuralAugmentor(workspace_path=str(workspace))
    facts = augmentor.augment(
        files=["src/ai.py"],
        finding_ids=["finding-1"],
    )

    assert len(facts) >= 2
    assert facts[0].ai_finding_ids == ["finding-1"]

    payload = EvidenceAssembler().assemble(
        scan_job_id="scan-job-1",
        syft_result=None,  # type: ignore[arg-type]
        semgrep_result=_semgrep_result(),
        coverage_notes=[],
        structural_facts=facts,
    )

    assert payload.evidence_payload["structural_facts"][0]["pattern_type"] == "route_handler"


def test_structural_augmentor_processes_files_without_ai_findings(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    target = workspace / "src" / "no_ai.py"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        "@app.get('/health')\n"
        "def health():\n"
        "    return {}\n",
        encoding="utf-8",
    )

    augmentor = StructuralAugmentor(workspace_path=str(workspace))
    facts = augmentor.augment(files=["src/no_ai.py"], finding_ids=[])

    assert len(facts) == 1
    assert facts[0].ai_finding_ids == []


def test_structural_augmentor_records_controller_and_route_for_nestjs(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    target = workspace / "src" / "controller.ts"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        "@Controller()\n"
        "export class AppController {\n"
        "  @Get('/generate')\n"
        "  async generate() {\n"
        "    return 1;\n"
        "  }\n"
        "}\n",
        encoding="utf-8",
    )

    augmentor = StructuralAugmentor(workspace_path=str(workspace))
    facts = augmentor.augment(files=["src/controller.ts"], finding_ids=["finding-2"])

    assert any(fact.pattern_type == "controller" and fact.graph_node_type == "CONTROLLER" for fact in facts)
    assert any(fact.pattern_type == "route_handler" and fact.graph_node_type == "ROUTE" for fact in facts)


def test_structural_augmentor_tracks_parser_failures_as_coverage_limitations(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    target = workspace / "src" / "ai.py"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("def broken():\n    return 1\n", encoding="utf-8")

    class ExplodingParser:
        def parse_file(self, file_path: str | Path) -> list[object]:
            raise RuntimeError("parser unavailable")

    augmentor = StructuralAugmentor(workspace_path=str(workspace))
    augmentor._parser = ExplodingParser()  # type: ignore[assignment]
    facts = augmentor.augment(files=["src/ai.py"], finding_ids=["finding-3"])

    assert facts == []
    assert any("SCAN_COVERAGE_LIMITATION" in note for note in augmentor.last_coverage_notes)
    assert any("src/ai.py" in note for note in augmentor.last_coverage_notes)


def test_structural_augmentor_processes_all_eligible_files_without_a_fixed_cap(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    for index in range(101):
        target = workspace / "src" / f"file_{index}.py"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("@app.get('/predict')\ndef predict():\n    return 1\n", encoding="utf-8")

    augmentor = StructuralAugmentor(workspace_path=str(workspace))
    facts = augmentor.augment(
        files=[str(workspace / "src" / f"file_{index}.py") for index in range(101)],
        finding_ids=["finding-4"],
    )

    assert len(facts) == 101
    assert not any("cap" in note.lower() for note in augmentor.last_coverage_notes)
