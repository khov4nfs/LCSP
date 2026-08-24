from __future__ import annotations

from tools.classification.classification.classification_boundary import ClassificationBoundary
from tools.legal.legal.chromadb_citation_retriever import RetrievedChunk
from tools.legal.legal.legal_retrieval_boundary import LegalRetrievalBoundary


class DummyConfig:
    nestjs_api_base_url = "http://api.test"
    worker_api_key = "worker-test-key"
    langgraph_checkpoint_database_url = None


class EventChainApiClient:
    def __init__(self) -> None:
        self.legal_callback = None
        self.classification_callback = None

    def get_verified_profile_by_id(self, verified_profile_id: str) -> dict:
        return {
            "id": verified_profile_id,
            "status": "APPROVED",
            "mergedProfile": {
                "businessProcess": "AUTOMATED_DECISION",
                "automationLevel": "FULLY_AUTOMATED",
            },
            "factEvidenceRefs": {
                "businessProcess": ["evidence-business-process"],
                "automationLevel": ["evidence-automation-level"],
            },
            "evidenceRefs": [
                "evidence-business-process",
                "evidence-automation-level",
            ],
        }

    def get_active_legal_rule_catalog(self) -> dict:
        return {
            "versionId": "catalog-v1",
            "rules": [
                {
                    "legalRuleId": "RULE-A",
                    "requiredFacts": [
                        {
                            "field": "businessProcess",
                            "expectedValue": "AUTOMATED_DECISION",
                        },
                        {
                            "field": "automationLevel",
                            "expectedValue": "FULLY_AUTOMATED",
                        },
                    ],
                    "optionalFacts": [],
                    "blockingFacts": [],
                    "unknownFactPolicy": "BLOCK_ON_UNKNOWN",
                    "citationLocatorRefs": [
                        {
                            "id": "chunk-1",
                            "documentId": "LAW-134-2025-QH15",
                            "locator": "art-33",
                        }
                    ],
                }
            ],
        }

    def get_active_legal_corpus(self) -> dict:
        return {"versionId": "corpus-v1", "status": "APPROVED"}

    def get_legal_corpus_chunks(self, corpus_version_id: str) -> dict:
        return {
            "versionId": corpus_version_id,
            "chunks": [
                {
                    "id": "chunk-1",
                    "content": "Evidence-backed legal text",
                    "documentId": "LAW-134-2025-QH15",
                    "locator": "art-33",
                    "legalStatus": "ACTIVE",
                }
            ],
        }

    def post_legal_rule_match_callback(self, payload):
        self.legal_callback = payload
        return {"accepted": True, "legal_rule_match_id": "lrm-1"}

    def get_legal_rule_match_by_id(self, legal_rule_match_id: str) -> dict:
        assert self.legal_callback is not None
        return {
            "id": legal_rule_match_id,
            "legal_rule_match_id": legal_rule_match_id,
            "status": "ACCEPTED",
            "guardrail_status": "PASSED",
            "assessment_id": self.legal_callback.assessment_id,
            "verified_profile_id": self.legal_callback.verified_profile_id,
            "verified_profile_data": {
                "claims": [{"claim_category": "MODEL_INVOCATION"}]
            },
            "matches": self.legal_callback.matches,
            "citation_allowlist": self.legal_callback.citation_allowlist,
        }

    def post_classification_callback(self, payload):
        self.classification_callback = payload
        return {"accepted": True, "classification_result_id": "cls-1"}


class InMemoryRetriever:
    def index_corpus(self, corpus_version_id, chunks):
        self.indexed = (corpus_version_id, chunks)

    def retrieve_exact(self, corpus_version_id, chunk_ids):
        return [
            RetrievedChunk(
                id=chunk_id,
                document_id="LAW-134-2025-QH15",
                locator="art-33",
                legal_status="ACTIVE",
                role="PRIMARY_MATCH",
            )
            for chunk_id in chunk_ids
        ]

    def build_citation_allowlist(self, chunks):
        return {
            "allowlist": [chunk.id for chunk in chunks if chunk.legal_status != "REPEALED"],
            "repealed_chunk_ids": [
                chunk.id for chunk in chunks if chunk.legal_status == "REPEALED"
            ],
        }


def test_approved_profile_flows_from_legal_matching_into_classification_callback():
    api_client = EventChainApiClient()
    legal_boundary = LegalRetrievalBoundary(
        DummyConfig(),
        api_client=api_client,
        retriever=InMemoryRetriever(),
    )

    legal_boundary.handle(
        {
            "verifiedProfileId": "vp-1",
            "assessmentId": "assessment-1",
            "corpusVersionId": "corpus-v1",
        },
        correlationId="corr-legal-1",
    )

    assert api_client.legal_callback is not None
    assert api_client.legal_callback.matches[0]["legal_status"] == "ACTIVE"
    assert api_client.legal_callback.citation_allowlist == ["chunk-1"]

    classification_boundary = ClassificationBoundary(
        DummyConfig(),
        api_client=api_client,
    )
    classification_boundary.handle(
        {
            "legalRuleMatchId": "lrm-1",
            "assessmentId": "assessment-1",
            "guardrailStatus": "PASSED",
        },
        correlationId="corr-classification-1",
    )

    result = api_client.classification_callback
    assert result is not None
    assert result.legal_rule_match_id == "lrm-1"
    assert result.verified_profile_id == "vp-1"
    assert result.assessment_id == "assessment-1"
    assert result.guardrail_status == "PASSED"
    assert result.classification_data["risk_level"] == "HIGH"
    assert result.classification_data["applicability_assessment"] == "applicable"
    assert result.classification_data["citation_basis"] == ["chunk-1"]
