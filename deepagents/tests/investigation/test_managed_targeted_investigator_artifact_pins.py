import pytest

from tools.common.capabilities.assessment.investigation.engineering_rule.managed_targeted_investigator import (
    _LegalPinningApiProxy,
    assert_managed_investigator_artifact_pins,
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
