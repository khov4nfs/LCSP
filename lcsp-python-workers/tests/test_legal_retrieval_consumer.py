import pytest

from lcsp_workers.legal.chromadb_citation_retriever import RetrievedChunk
from lcsp_workers.legal.legal_retrieval_consumer import LegalRetrievalConsumer
from lcsp_workers.platform.api_client import WorkerCallbackError


class DummyConfig:
    nestjs_api_base_url = "http://example.test"
    worker_api_key = "secret"


class DummyApiClient:
    def __init__(self, verified_profile_status="APPROVED"):
        self.calls = []
        self.verified_profile_status = verified_profile_status

    def get_verified_profile_by_id(self, verified_profile_id):
        self.calls.append(("verified_profile", verified_profile_id))
        return {
            "id": verified_profile_id,
            "status": self.verified_profile_status,
            "mergedProfile": {
                "businessProcess": "AUTOMATED_DECISION",
                "automationLevel": "FULLY_AUTOMATED",
            },
            "factEvidenceRefs": {
                "businessProcess": ["e1"],
                "automationLevel": ["e2"],
            },
            "evidenceRefs": ["e1", "e2"],
        }

    def get_active_legal_rule_catalog(self):
        self.calls.append(("catalog", None))
        return {
            "versionId": "catalog-v1",
            "rules": [
                {
                    "legalRuleId": "RULE-A",
                    "requiredFacts": [
                        {"field": "businessProcess", "expectedValue": "AUTOMATED_DECISION"},
                        {"field": "automationLevel", "expectedValue": "FULLY_AUTOMATED"},
                    ],
                    "optionalFacts": [],
                    "blockingFacts": [],
                    "unknownFactPolicy": "BLOCK_ON_UNKNOWN",
                    "citationLocatorRefs": [{"id": "chunk-1", "documentId": "doc-1", "locator": "art-1"}],
                }
            ],
        }

    def get_legal_corpus_chunks(self, corpus_version_id):
        self.calls.append(("corpus_chunks", corpus_version_id))
        return {"versionId": corpus_version_id, "chunks": [{"id": "chunk-1", "content": "Legal content"}]}

    def post_legal_rule_match_callback(self, payload):
        self.calls.append(("callback", payload))
        return payload


class DummyRetriever:
    def index_corpus(self, corpus_version_id, chunks):
        self.indexed = (corpus_version_id, chunks)

    def retrieve_exact(self, corpus_version_id, chunk_ids):
        return [RetrievedChunk(id=value, document_id="doc-1", locator="art-1", legal_status="ACTIVE", role="PRIMARY_MATCH") for value in chunk_ids]

    def build_citation_allowlist(self, chunks):
        return {"allowlist": [chunk.id for chunk in chunks], "repealed_chunk_ids": []}


def test_consumer_fetches_data_and_submits_callback():
    api_client = DummyApiClient()
    consumer = LegalRetrievalConsumer(DummyConfig(), api_client=api_client, retriever=DummyRetriever())

    consumer.handle(
        {
            "verifiedProfileId": "vp-1",
            "assessmentId": "assessment-1",
            "corpusVersionId": "corpus-v1",
        },
        correlation_id="corr-1",
    )

    assert any(call[0] == "verified_profile" for call in api_client.calls)
    assert any(call[0] == "catalog" for call in api_client.calls)
    assert any(call[0] == "callback" for call in api_client.calls)

    callback_payload = next(call[1] for call in api_client.calls if call[0] == "callback")
    assert callback_payload.verified_profile_id == "vp-1"
    assert callback_payload.assessment_id == "assessment-1"
    assert callback_payload.corpus_version_id == "corpus-v1"
    assert callback_payload.legal_rule_catalog_version_id == "catalog-v1"
    assert callback_payload.matches[0]["match_id"].startswith("RULE-A")
    assert callback_payload.matches[0]["legal_status"] == "ACTIVE"
    assert callback_payload.citation_allowlist == ["chunk-1"]
    assert callback_payload.overall_coverage_status == "COMPLETE_CITATION"


def test_consumer_rejects_unapproved_verified_profile_before_legal_lookup():
    api_client = DummyApiClient(verified_profile_status="PENDING_APPROVAL")
    consumer = LegalRetrievalConsumer(
        DummyConfig(), api_client=api_client, retriever=DummyRetriever()
    )

    with pytest.raises(WorkerCallbackError, match="Verified profile is not approved"):
        consumer.handle(
            {
                "verifiedProfileId": "vp-1",
                "assessmentId": "assessment-1",
                "corpusVersionId": "corpus-v1",
            },
            correlation_id="corr-1",
        )

    assert api_client.calls == [("verified_profile", "vp-1")]
