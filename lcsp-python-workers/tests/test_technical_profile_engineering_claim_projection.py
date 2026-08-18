from lcsp_workers.intelligence.technical_profile_consumer import (
    MAX_ENGINEERING_CLAIMS,
    TechnicalProfileConsumer,
)


def test_minimized_profile_preserves_bounded_validated_engineering_claims() -> None:
    consumer = object.__new__(TechnicalProfileConsumer)
    claims = [
        {
            "claim_id": f"claim-{index}",
            "engineering_rule_id": "eng-1",
            "claim_type": "HUMAN_REVIEW_PRESENT",
            "value": True,
            "evidence_refs": [f"evidence:{index}"],
            "graph_path_refs": [],
            "source_anchor_refs": [],
            "confidence": 0.95,
            "limitations": [],
        }
        for index in range(MAX_ENGINEERING_CLAIMS + 1)
    ]
    profile_data = {
        "engineering_investigation": {
            "status": "COMPLETE",
            "legal_rule_catalog_version_id": "catalog-1",
            "legal_corpus_version_id": "corpus-1",
            "rules_considered": 1,
            "engineering_rules_executed": 1,
            "engineering_rule_cache_hits": 0,
            "limitations": [],
            "claims": claims,
        }
    }

    minimized = consumer._minimized_profile_data(
        profile_data=profile_data,
        profile_data_ref="/tmp/profile.json",
    )
    investigation = minimized["engineering_investigation"]

    assert investigation["claim_count"] == MAX_ENGINEERING_CLAIMS + 1
    assert investigation["claims_truncated"] is True
    assert len(investigation["claims"]) == MAX_ENGINEERING_CLAIMS
    assert investigation["claims"][0]["claim_id"] == "claim-0"
    assert investigation["claims"][0]["evidence_refs"] == ["evidence:0"]
