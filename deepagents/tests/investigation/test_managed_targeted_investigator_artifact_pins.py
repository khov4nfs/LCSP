import pytest

from tools.common.capabilities.assessment.investigation.engineering_rule import (
    managed_targeted_investigator as managed,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.managed_targeted_investigator import (
    _LegalPinningApiProxy,
    assert_managed_investigator_artifact_pins,
)
from tools.common.capabilities.assessment.planning.engineering_rule.confirmed_business_context import (
    ConfirmedBusinessContextStatement,
    ConfirmedStructuredBusinessContext,
)


class RecordingAdapter:
    def __init__(self) -> None:
        self.catalog_version_id = None
        self.corpus_version_id = None

    def pin_legal_scope(
        self,
        *,
        catalog_version_id=None,
        corpus_version_id=None,
    ) -> None:
        if catalog_version_id:
            self.catalog_version_id = catalog_version_id
        if corpus_version_id:
            self.corpus_version_id = corpus_version_id


class LegalApi:
    def __init__(self, *, catalog="catalog-1", corpus="corpus-1") -> None:
        self.catalog = catalog
        self.corpus = corpus

    def get_active_legal_rule_catalog(self):
        return {"versionId": self.catalog, "rules": []}

    def get_active_legal_corpus(self):
        return {"versionId": self.corpus}

    def get_accepted_technical_evidence_report(self, report_id: str):
        assert report_id == "ter-1"
        return {
            "id": "ter-1",
            "snapshot_id": "snapshot-1",
            "user_id": "customer-1",
            "evidence_payload": {
                "evidence_graph": {
                    "graph_id": "graph-1",
                    "snapshot_id": "snapshot-1",
                    "commit_sha": "abc123",
                    "node_count": 0,
                    "edge_count": 0,
                    "nodes": [],
                    "edges": [],
                    "source_anchors": [],
                    "evidence_refs": [],
                    "graph_hash": "sha256:graph",
                }
            },
        }


CONTINUATION = {
    "affectedRuleIds": ["ENG-1"],
    "artifactVersions": {
        "technicalEvidenceReportId": "ter-1",
        "repositorySnapshotId": "snapshot-1",
        "legalRuleCatalogVersionId": "catalog-1",
        "legalCorpusVersionId": "corpus-1",
    },
}


def test_production_legal_proxy_pins_the_versions_actually_loaded_by_pipeline() -> None:
    adapter = RecordingAdapter()
    proxy = _LegalPinningApiProxy(LegalApi(), adapter)

    assert proxy.get_active_legal_rule_catalog()["versionId"] == "catalog-1"
    assert proxy.get_active_legal_corpus()["versionId"] == "corpus-1"

    assert adapter.catalog_version_id == "catalog-1"
    assert adapter.corpus_version_id == "corpus-1"


def test_exact_continuation_accepts_identical_legal_artifact_pins() -> None:
    assert_managed_investigator_artifact_pins(LegalApi(), CONTINUATION)


def test_exact_continuation_rejects_changed_legal_catalog() -> None:
    with pytest.raises(RuntimeError, match="legal rule catalog pin is stale"):
        assert_managed_investigator_artifact_pins(
            LegalApi(catalog="catalog-2"),
            CONTINUATION,
        )


def test_exact_continuation_rejects_changed_legal_corpus() -> None:
    with pytest.raises(RuntimeError, match="legal corpus pin is stale"):
        assert_managed_investigator_artifact_pins(
            LegalApi(corpus="corpus-2"),
            CONTINUATION,
        )


def test_exact_continuation_rejects_legacy_partial_artifact_pins() -> None:
    partial = {
        "affectedRuleIds": ["ENG-1"],
        "artifactVersions": {
            "technicalEvidenceReportId": "ter-1",
            "repositorySnapshotId": "snapshot-1",
        },
    }
    with pytest.raises(RuntimeError, match="immutable artifact pins are incomplete"):
        assert_managed_investigator_artifact_pins(LegalApi(), partial)


def test_exact_resume_serializes_confirmed_structured_context(monkeypatch) -> None:
    captured: dict = {}

    monkeypatch.setattr(
        managed,
        "checkpoint_database_url",
        lambda _value: "postgresql://lcsp:lcsp@db/lcsp",
    )
    monkeypatch.setattr(
        managed,
        "_assert_execution_registry_matches_continuation",
        lambda **_kwargs: None,
    )

    def invoke(**kwargs):
        captured["instruction"] = kwargs["instruction"]
        return (
            {
                "status": "READY",
                "artifact_versions": dict(CONTINUATION["artifactVersions"]),
                "claims": [
                    {
                        "claim_id": "claim-1",
                        "engineering_rule_id": "ENG-1",
                        "claim_type": "UNRESOLVED_ENGINEERING_FACT",
                        "value": None,
                        "evidence_refs": ["evidence:1"],
                        "confidence": 0.5,
                    }
                ],
                "limitations": [],
                "next_step": "GATE",
            },
            "checkpoint-next",
        )

    monkeypatch.setattr(managed, "_invoke_managed_investigator", invoke)

    context = ConfirmedStructuredBusinessContext(
        assessment_id="assessment-1",
        context_revision=3,
        statements=(
            ConfirmedBusinessContextStatement(
                statement_id="stmt-decision-authority",
                topic="decision_authority",
                statement="human approval",
                normalized_value="human approval",
                scope={"needId": "need-1"},
                evidence_refs=("evidence:customer:1",),
                respondent_ref="actor:authenticated:1",
                created_at="2026-09-05T00:00:00Z",
                supersedes_statement_id=None,
            ),
        ),
        limitations=("customer-confirmed current statements only",),
        source_version_ref="snapshot-1:abc",
        pge_version="ter-1:v1",
        guidance_version="guidance-1",
    )
    continuation = {
        **CONTINUATION,
        "workflowRunId": "investigator:exec-1",
        "checkpointId": "checkpoint-original",
        "investigatorExecutionId": "exec-1",
    }

    result = managed.resume_managed_investigator(
        config=type("Config", (), {"langgraph_checkpoint_database_url": "unused"})(),
        api_client=LegalApi(),
        assessment_id="assessment-1",
        context_revision=3,
        continuation=continuation,
        confirmed_context=context,
        correlation_id="corr-1",
    )

    assert result["handoff"]["status"] == "READY"
    assert "ConfirmedStructuredBusinessContext(" not in captured["instruction"]
    assert '"assessmentId": "assessment-1"' in captured["instruction"]
    assert '"contextRevision": 3' in captured["instruction"]
    assert '"authority": "CUSTOMER_CONFIRMED_CONFIRMED_ONLY"' in captured["instruction"]
    assert '"statements": [' in captured["instruction"]
    assert '"limitations": [' in captured["instruction"]
    assert '"sourceVersionRef": "snapshot-1:abc"' in captured["instruction"]
    assert '"pgeVersion": "ter-1:v1"' in captured["instruction"]
    assert '"guidanceVersion": "guidance-1"' in captured["instruction"]
