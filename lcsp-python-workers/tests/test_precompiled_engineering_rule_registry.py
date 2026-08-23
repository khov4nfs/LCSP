from __future__ import annotations

import json
from pathlib import Path

import pytest

from lcsp_workers.legal.engineering_rules.compiler import COMPILER_VERSION, PROMPT_VERSION
from lcsp_workers.legal.engineering_rules.models import ENGINEERING_RULE_SCHEMA_VERSION
from lcsp_workers.legal.engineering_rules.precompiled_registry import (
    PrecompiledEngineeringRuleRegistry,
)


def _bundle() -> dict:
    return {
        "engineeringRuleSchemaVersion": ENGINEERING_RULE_SCHEMA_VERSION,
        "compilerVersion": COMPILER_VERSION,
        "promptVersion": PROMPT_VERSION,
        "compilerModel": "precompiled:test",
        "templates": [
            {
                "templateId": "T-HUMAN-OVERSIGHT",
                "matchCitationChunkIds": ["LAW:A1"],
                "groundingContextHashes": {"LAW:A1": "sha256:chunk"},
                "concept": "HUMAN_OVERSIGHT",
                "legalIntent": {},
                "investigationGoals": ["Find a bounded human-review path"],
                "startingNodeTypes": [],
                "targetNodeTypes": [],
                "edgeStrategies": [],
                "graphQueries": [],
                "requiredEvidence": ["Human review control"],
                "supportingEvidence": [],
                "negativeEvidence": [],
                "unresolvedConditions": [],
            }
        ],
    }


def _context(*, digest: str = "sha256:chunk") -> list[dict]:
    return [
        {
            "id": "LAW:A1",
            "locator": "art-1::cl-1",
            "contentSha256": digest,
            "legalStatus": "ACTIVE",
        }
    ]


def _legal_rule() -> dict:
    return {
        "legalRuleId": "LEGAL-1",
        "citationLocatorRefs": [{"chunkId": "LAW:A1"}],
    }


def _registry(tmp_path: Path, bundle: dict) -> PrecompiledEngineeringRuleRegistry:
    bundle_path = tmp_path / "engineering-rules.json"
    bundle_path.write_text(json.dumps(bundle), encoding="utf-8")
    # Custom unit-test bundles do not depend on the generated governed production
    # overlay. An empty, explicit overlay keeps production's missing-file fail-closed
    # behavior intact while allowing this registry test to own all of its inputs.
    overrides_path = tmp_path / "contract-overrides.json"
    overrides_path.write_text("{}", encoding="utf-8")
    return PrecompiledEngineeringRuleRegistry(
        str(bundle_path),
        contract_overrides_path=str(overrides_path),
    )


def test_registry_recovers_exact_grounded_rule_from_bundle(tmp_path: Path) -> None:
    registry = _registry(tmp_path, _bundle())

    rules = registry.materialize(
        legal_rule=_legal_rule(),
        legal_rule_catalog_version_id="catalog-1",
        legal_corpus_version_id="corpus-1",
        legal_context=_context(),
        source_fingerprint="sha256:fingerprint",
    )

    assert len(rules) == 1
    rule = rules[0]
    assert rule.engineering_rule_id == "LEGAL-1::PRECOMPILED::T-HUMAN-OVERSIGHT"
    assert rule.legal_rule_catalog_version_id == "catalog-1"
    assert rule.legal_corpus_version_id == "corpus-1"
    assert rule.source_chunk_ids == ("LAW:A1",)
    assert rule.source_fingerprint == "sha256:fingerprint"
    assert rule.compiler_model == "precompiled:test"


def test_registry_fails_closed_when_active_chunk_hash_differs(tmp_path: Path) -> None:
    registry = _registry(tmp_path, _bundle())

    with pytest.raises(
        ValueError,
        match="PRECOMPILED_ENGINEERING_RULE_SOURCE_HASH_MISMATCH:LEGAL-1:LAW:A1",
    ):
        registry.materialize(
            legal_rule=_legal_rule(),
            legal_rule_catalog_version_id="catalog-1",
            legal_corpus_version_id="corpus-1",
            legal_context=_context(digest="sha256:changed"),
            source_fingerprint="sha256:fingerprint",
        )


def test_registry_fails_closed_when_runtime_contract_differs(tmp_path: Path) -> None:
    bundle = _bundle()
    bundle["promptVersion"] = "different-prompt-contract"
    registry = _registry(tmp_path, bundle)

    with pytest.raises(
        ValueError,
        match="PRECOMPILED_ENGINEERING_RULE_CONTRACT_MISMATCH:LEGAL-1",
    ):
        registry.materialize(
            legal_rule=_legal_rule(),
            legal_rule_catalog_version_id="catalog-1",
            legal_corpus_version_id="corpus-1",
            legal_context=_context(),
            source_fingerprint="sha256:fingerprint",
        )
