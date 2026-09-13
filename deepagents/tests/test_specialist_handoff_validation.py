from __future__ import annotations

import pytest

from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_LIMITATION_CODES,
)
from orchestration.result_validation import (
    SpecialistHandoffValidationError,
    validate_specialist_handoff,
)
from contracts.handoffs import InvestigatorResult
from middleware.provider_schema import relax_array_upper_bounds
from tools.common.capabilities.agentic_evidence.entrypoints.program_graph_tool_entrypoints import (
    _project_safe_edge,
)


def _investigator_payload() -> dict:
    return {
        "status": "READY",
        "artifact_versions": {"technicalEvidenceReportId": "ter-1"},
        "claims": [
            {
                "claim_id": "claim-1",
                "engineering_rule_id": "eng-1",
                "claim_type": "UNRESOLVED_ENGINEERING_FACT",
                "value": None,
                "evidence_refs": [],
                "graph_path_refs": ["node:ai", "edge:receives", "node:output"],
                "source_anchor_refs": [],
                "confidence": 0.9,
                "limitations": [
                    ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"]
                ],
                "criterion": "AI output path",
            }
        ],
        "limitations": [],
        "missing_input": None,
        "next_step": "GATE",
    }


def _graph() -> dict:
    return {
        "graph_id": "graph-1",
        "snapshot_id": "snapshot-1",
        "commit_sha": "abc123",
        "node_count": 2,
        "edge_count": 1,
        "nodes": [
            {
                "node_id": "node:ai",
                "node_type": "AI_MODEL_INVOCATION",
                "label": "responses.create",
                "source": {},
                "attributes": {},
                "semantic_types": [],
                "evidence_refs": [],
                "origin": "STATIC_ANALYSIS",
                "resolution_state": "CORROBORATED",
                "support_refs": [],
            },
            {
                "node_id": "node:output",
                "node_type": "AI_OUTPUT",
                "label": "AI output",
                "source": {},
                "attributes": {},
                "semantic_types": [],
                "evidence_refs": [],
                "origin": "STATIC_ANALYSIS",
                "resolution_state": "CORROBORATED",
                "support_refs": [],
            },
        ],
        "edges": [
            {
                "edge_id": "edge:receives",
                "edge_type": "RECEIVES_FROM_AI",
                "source_node_id": "node:ai",
                "target_node_id": "node:output",
                "confidence": 1.0,
                "attributes": {},
                "evidence_refs": [],
                "coverage_state": "SUFFICIENT",
                "origin": "DATA_LINEAGE",
                "resolution_state": "CORROBORATED",
                "support_refs": [],
            }
        ],
        "source_anchors": [],
        "evidence_refs": [],
        "graph_hash": "sha256:graph",
    }


def test_investigator_handoff_runs_existing_evidence_claim_validator() -> None:
    handoff = validate_specialist_handoff(
        "investigator",
        _investigator_payload(),
        graph=_graph(),
        pinned_rule_ids=("eng-1",),
        pinned_versions={"technicalEvidenceReportId": "ter-1"},
    )

    assert handoff.status == "READY"


@pytest.mark.parametrize("empty_claims", [True, False])
def test_recorded_misrouted_investigator_outputs_remain_rejected(empty_claims) -> None:
    # 2026-09-09, workflow 640df563-8b35-4883-b9d8-3b4c0c2e3813:
    # art-15 cl-1 pt-c returned READY with no claims; art-16 cl-5 returned
    # a maintenance claim without provenance. Artifact identities are anonymized.
    payload = _investigator_payload()
    payload["claims"] = [] if empty_claims else [{
        "claim_id": "ENG-1::ENGINEERING_RULE_NOT_READY",
        "engineering_rule_id": "eng-1",
        "claim_type": "UNRESOLVED_ENGINEERING_FACT",
        "value": None,
        "evidence_refs": [],
        "graph_path_refs": [],
        "source_anchor_refs": [],
        "confidence": 0.9,
        "limitations": [
            ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"]
        ],
        "criterion": "ENGINEERING_RULE_NOT_READY_LEGAL_MAINTENANCE",
    }]
    expected = "schema validation" if empty_claims else "evidence-claim validation"
    with pytest.raises(SpecialistHandoffValidationError, match=expected):
        validate_specialist_handoff(
            "investigator", payload, graph=_graph(), pinned_rule_ids=("eng-1",),
            pinned_versions=payload["artifact_versions"],
        )


def test_investigator_handoff_rejects_unknown_graph_refs() -> None:
    payload = _investigator_payload()
    payload["claims"][0]["graph_path_refs"] = ["node:missing"]

    with pytest.raises(SpecialistHandoffValidationError, match="evidence-claim"):
        validate_specialist_handoff(
            "investigator",
            payload,
            graph=_graph(),
            pinned_rule_ids=("eng-1",),
            pinned_versions={"technicalEvidenceReportId": "ter-1"},
        )


def test_investigator_handoff_rejects_unpinned_rule_ids() -> None:
    payload = _investigator_payload()
    payload["claims"][0]["engineering_rule_id"] = "eng-2"

    with pytest.raises(SpecialistHandoffValidationError, match="unpinned"):
        validate_specialist_handoff(
            "investigator",
            payload,
            graph=_graph(),
            pinned_rule_ids=("eng-1",),
            pinned_versions={"technicalEvidenceReportId": "ter-1"},
        )


def test_investigator_handoff_rejects_stale_artifact_versions() -> None:
    payload = _investigator_payload()
    payload["artifact_versions"] = {"technicalEvidenceReportId": "ter-stale"}

    with pytest.raises(SpecialistHandoffValidationError, match="artifact_versions"):
        validate_specialist_handoff(
            "investigator",
            payload,
            graph=_graph(),
            pinned_rule_ids=("eng-1",),
            pinned_versions={"technicalEvidenceReportId": "ter-1"},
        )


def test_specialist_handoff_rejects_forbidden_final_verdicts() -> None:
    payload = _investigator_payload()
    payload["limitations"] = ["COMPLIANT"]

    with pytest.raises(SpecialistHandoffValidationError, match="forbidden"):
        validate_specialist_handoff("investigator", payload)


def test_specialist_handoff_rejects_unknown_investigator_limitation_code() -> None:
    payload = _investigator_payload()
    payload["claims"][0]["limitations"] = ["UNKNOWN"]

    with pytest.raises(SpecialistHandoffValidationError, match="schema validation"):
        validate_specialist_handoff(
            "investigator",
            payload,
            graph=_graph(),
            pinned_rule_ids=("eng-1",),
            pinned_versions={"technicalEvidenceReportId": "ter-1"},
        )


def test_investigator_claim_schema_rejects_met_without_refs() -> None:
    payload = _investigator_payload()
    payload["claims"][0].update(
        {
            "claim_type": "RULE_REQUIREMENT_MET",
            "value": True,
            "evidence_refs": [],
            "graph_path_refs": [],
            "source_anchor_refs": [],
            "limitations": [],
        }
    )

    with pytest.raises(SpecialistHandoffValidationError, match="schema validation"):
        validate_specialist_handoff("investigator", payload)


def test_fail_closed_recovery_converts_decided_claim_without_refs_to_unresolved() -> None:
    payload = _investigator_payload()
    payload["claims"][0].update(
        {
            "claim_type": "RULE_REQUIREMENT_MET",
            "value": True,
            "evidence_refs": [],
            "graph_path_refs": [],
            "source_anchor_refs": [],
            "limitations": [],
        }
    )

    handoff = validate_specialist_handoff(
        "investigator",
        payload,
        graph=_graph(),
        pinned_rule_ids=("eng-1",),
        pinned_versions={"technicalEvidenceReportId": "ter-1"},
        allow_fail_closed_recovery=True,
    )

    claim = handoff.model_dump(mode="json")["claims"][0]
    assert claim["claim_type"] == "UNRESOLVED_ENGINEERING_FACT"
    assert claim["value"] is None
    assert claim["confidence"] == 0.0
    assert claim["limitations"] == [
        ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"]
    ]
    assert claim["evidence_refs"] == []
    assert claim["graph_path_refs"] == []
    assert claim["source_anchor_refs"] == []


def test_fail_closed_recovery_fills_unresolved_limitation_without_refs() -> None:
    payload = _investigator_payload()
    payload["claims"][0].update(
        {
            "claim_type": "UNRESOLVED_ENGINEERING_FACT",
            "value": True,
            "evidence_refs": [],
            "graph_path_refs": [],
            "source_anchor_refs": [],
            "limitations": [],
        }
    )

    handoff = validate_specialist_handoff(
        "investigator",
        payload,
        graph=_graph(),
        pinned_rule_ids=("eng-1",),
        pinned_versions={"technicalEvidenceReportId": "ter-1"},
        allow_fail_closed_recovery=True,
    )

    claim = handoff.model_dump(mode="json")["claims"][0]
    assert claim["claim_type"] == "UNRESOLVED_ENGINEERING_FACT"
    assert claim["value"] is None
    assert claim["confidence"] == 0.0
    assert claim["limitations"] == [
        ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"]
    ]


def test_fail_closed_recovery_keeps_decided_claim_with_refs_under_evidence_gate() -> None:
    payload = _handoff_with_claim(
        _ai_output_path_claim(evidence_refs=["EV-MISSING"], graph_path_refs=[])
    )

    with pytest.raises(SpecialistHandoffValidationError, match="evidence-claim"):
        validate_specialist_handoff(
            "investigator",
            payload,
            graph=_ai_output_path_graph(),
            pinned_rule_ids=("eng-1",),
            pinned_versions={"technicalEvidenceReportId": "ter-1"},
        )


def test_investigator_validation_strips_customer_context_refs_from_non_scope_claims() -> None:
    payload = _investigator_payload()
    payload["claims"][0]["customer_context_refs"] = ["statement:model-noise"]

    handoff = validate_specialist_handoff(
        "investigator",
        payload,
        graph=_graph(),
        pinned_rule_ids=("eng-1",),
        pinned_versions={"technicalEvidenceReportId": "ter-1"},
    )

    claim = handoff.model_dump(mode="json")["claims"][0]
    assert claim["claim_type"] == "UNRESOLVED_ENGINEERING_FACT"
    assert "customer_context_refs" not in claim


def test_stripping_customer_context_refs_does_not_accept_decided_claim_without_refs() -> None:
    payload = _investigator_payload()
    payload["claims"][0].update(
        {
            "claim_type": "RULE_REQUIREMENT_MET",
            "value": True,
            "evidence_refs": [],
            "graph_path_refs": [],
            "source_anchor_refs": [],
            "limitations": [],
            "customer_context_refs": ["statement:model-noise"],
        }
    )

    with pytest.raises(SpecialistHandoffValidationError, match="at least one evidence"):
        validate_specialist_handoff("investigator", payload)


def test_investigator_claim_schema_rejects_met_with_false_value() -> None:
    payload = _investigator_payload()
    payload["claims"][0].update(
        {
            "claim_type": "RULE_REQUIREMENT_MET",
            "value": False,
            "limitations": [],
        }
    )

    with pytest.raises(SpecialistHandoffValidationError, match="schema validation"):
        validate_specialist_handoff("investigator", payload)


def test_investigator_claim_schema_rejects_unresolved_without_limitation() -> None:
    payload = _investigator_payload()
    payload["claims"][0]["limitations"] = []

    with pytest.raises(SpecialistHandoffValidationError, match="schema validation"):
        validate_specialist_handoff("investigator", payload)


def test_planner_handoff_allows_unknown_coverage_state() -> None:
    handoff = validate_specialist_handoff(
        "planner",
        {
            "status": "INVESTIGATE",
            "engineering_rule_ids": ["ENG-1"],
            "artifact_versions": {"technicalEvidenceReportId": "ter-1"},
            "coverage_state": "UNKNOWN",
            "selected_scope": [
                {
                    "ref": "node:ai",
                    "criterion": "AI invocation exists",
                }
            ],
            "unresolved_facts": [],
            "next_step": "INVESTIGATE",
        },
    )

    assert handoff.coverage_state == "UNKNOWN"


def test_resolver_handoff_allows_unknown_conflict_source() -> None:
    handoff = validate_specialist_handoff(
        "resolver",
        {
            "status": "CONFLICT",
            "fact_key": "business_context.ai_usage_scope",
            "resolved_value": None,
            "conflicting_values": [
                {
                    "source": "UNKNOWN",
                    "value": "unresolved business context",
                    "source_refs": [],
                }
            ],
            "source_refs": [],
            "can_resume_existing_plan": False,
        },
    )

    assert handoff.conflicting_values[0].source == "UNKNOWN"


def test_resolver_handoff_rejects_nested_final_verdict_in_free_value() -> None:
    with pytest.raises(SpecialistHandoffValidationError, match="forbidden"):
        validate_specialist_handoff(
            "resolver",
            {
                "status": "RESOLVED",
                "fact_key": "business_context.ai_usage_scope",
                "resolved_value": {"status": "COMPLIANT"},
                "conflicting_values": [],
                "source_refs": [],
                "can_resume_existing_plan": True,
            },
        )


def test_rule_scope_not_applicable_requires_confirmed_statement_ref() -> None:
    payload = _investigator_payload()
    payload["claims"] = [
        {
            "claim_id": "claim-scope-1",
            "engineering_rule_id": "eng-1",
            "claim_type": "RULE_SCOPE_NOT_APPLICABLE",
            "value": None,
            "evidence_refs": [],
            "graph_path_refs": [],
            "source_anchor_refs": [],
            "customer_context_refs": ["stmt-good", "stmt-bad"],
            "confidence": 0.0,
            "limitations": [],
            "criterion": "TARGETED_SCOPE_EXCLUDED",
        }
    ]

    with pytest.raises(SpecialistHandoffValidationError, match="confirmed statements"):
        validate_specialist_handoff(
            "investigator",
            payload,
            graph=_graph(),
            pinned_rule_ids=("eng-1",),
            pinned_versions={"technicalEvidenceReportId": "ter-1"},
            confirmed_statement_refs=("stmt-good",),
        )


def test_rule_scope_not_applicable_allows_confirmed_statement_refs_without_graph_refs() -> None:
    payload = _investigator_payload()
    payload["claims"] = [
        {
            "claim_id": "claim-scope-1",
            "engineering_rule_id": "eng-1",
            "claim_type": "RULE_SCOPE_NOT_APPLICABLE",
            "value": None,
            "evidence_refs": [],
            "graph_path_refs": [],
            "source_anchor_refs": [],
            "customer_context_refs": ["stmt-good"],
            "confidence": 0.0,
            "limitations": [],
            "criterion": "TARGETED_SCOPE_EXCLUDED",
        }
    ]

    handoff = validate_specialist_handoff(
        "investigator",
        payload,
        graph=_graph(),
        pinned_rule_ids=("eng-1",),
        pinned_versions={"technicalEvidenceReportId": "ter-1"},
        confirmed_statement_refs=("stmt-good",),
    )

    assert handoff.claims[0].customer_context_refs == ["stmt-good"]


# ============================================================================
# Root-cause regression: real run correlationId=73b30588-e615-4514-a8d0-db1e3a40b9de
#
# Every failing claim in that run needed a topology-gated criterion (an AI-output/
# downstream-action/human-control/sensitive-data-lineage path) and had evidence_ref_count=20
# while carrying no valid graph-edge ref. The Investigator's traversal tools never returned
# `edge_id` on edge objects (`_project_safe_edge` omitted it), so the model had no way to
# supply a real edge ref in `graph_path_refs` — every such claim was structurally unable to
# close. `_project_safe_edge` now exposes `edge_id`; these tests pin that gate's real
# behavior at both ends: rejected without an edge ref, accepted with one.
# ============================================================================


def _ai_output_path_graph() -> dict:
    """AI_MODEL_INVOCATION -[RECEIVES_FROM_AI]-> AI_OUTPUT with production-rooted source paths.

    `_graph()` above leaves `source` empty, which is fine for the UNRESOLVED claims it backs but
    means neither node carries a production `source_role` — so a closed (MET/NOT_MET) claim can
    never pass `EvidenceClaimValidator`'s materiality check regardless of topology. This fixture
    exists to isolate the topology/edge-ref behavior under test from that separate materiality gate.
    """
    graph = _graph()
    for node in graph["nodes"]:
        node["source"] = {"file_path": "src/services/ai_gateway.ts"}
    return graph


def _ai_output_path_claim(**overrides) -> dict:
    claim = {
        "claim_id": "claim-ai-output",
        "engineering_rule_id": "eng-1",
        "claim_type": "RULE_REQUIREMENT_MET",
        "value": True,
        "evidence_refs": [],
        "graph_path_refs": [],
        "source_anchor_refs": [],
        "confidence": 0.9,
        "limitations": [],
        "criterion": "AI output path",
    }
    claim.update(overrides)
    return claim


def _handoff_with_claim(claim: dict) -> dict:
    payload = _investigator_payload()
    payload["claims"] = [claim]
    return payload


def test_ai_output_path_claim_rejected_without_edge_ref() -> None:
    """Node ids alone can never prove a topology-gated claim (the pre-fix model behavior)."""
    payload = _handoff_with_claim(
        _ai_output_path_claim(graph_path_refs=["node:ai", "node:output"])
    )

    with pytest.raises(SpecialistHandoffValidationError, match="evidence-claim") as exc_info:
        validate_specialist_handoff(
            "investigator",
            payload,
            graph=_ai_output_path_graph(),
            pinned_rule_ids=("eng-1",),
            pinned_versions={"technicalEvidenceReportId": "ter-1"},
        )

    message = str(exc_info.value)
    assert "claim-ai-output" in message
    assert "requires graph edge provenance" in message


def test_ai_output_path_claim_closes_when_graph_path_refs_include_the_proving_edge() -> None:
    """Once `graph_path_refs` includes the real `edge_id`, the same claim closes cleanly."""
    payload = _handoff_with_claim(
        _ai_output_path_claim(graph_path_refs=["node:ai", "edge:receives", "node:output"])
    )

    handoff = validate_specialist_handoff(
        "investigator",
        payload,
        graph=_ai_output_path_graph(),
        pinned_rule_ids=("eng-1",),
        pinned_versions={"technicalEvidenceReportId": "ter-1"},
    )

    assert handoff.status == "READY"


def test_recorded_ai_output_path_investigation_failure_matches_real_run_shape() -> None:
    # 2026-09-11, correlationId=73b30588-e615-4514-a8d0-db1e3a40b9de, workflow
    # interview:23be9a31-dfec-49f7-8c0f-749ab8e19a99, model gemini-3.5-flash-lite: three
    # art-11 claims each failed with evidence_ref_count=20 and no valid graph-edge ref.
    twenty_node_refs = ["node:ai", "node:output"] * 10
    payload = _handoff_with_claim(
        _ai_output_path_claim(evidence_refs=twenty_node_refs, graph_path_refs=[])
    )

    with pytest.raises(SpecialistHandoffValidationError, match="evidence-claim"):
        validate_specialist_handoff(
            "investigator",
            payload,
            graph=_ai_output_path_graph(),
            pinned_rule_ids=("eng-1",),
            pinned_versions={"technicalEvidenceReportId": "ter-1"},
        )


def test_schema_validation_error_surfaces_the_underlying_field_and_reason() -> None:
    """The generic 'failed schema validation' message alone gives the model nothing to fix."""
    payload = _handoff_with_claim(
        _ai_output_path_claim(
            claim_type="RULE_REQUIREMENT_NOT_MET",
            value=False,
            evidence_refs=[],
            graph_path_refs=[],
            source_anchor_refs=[],
        )
    )

    with pytest.raises(SpecialistHandoffValidationError, match="schema validation") as exc_info:
        validate_specialist_handoff("investigator", payload)

    assert "at least one evidence, graph-path, or source-anchor ref" in str(exc_info.value)


def test_evidence_claim_validation_error_surfaces_the_unresolved_ref() -> None:
    payload = _investigator_payload()
    payload["claims"][0]["graph_path_refs"] = ["node:missing"]

    with pytest.raises(SpecialistHandoffValidationError, match="evidence-claim") as exc_info:
        validate_specialist_handoff(
            "investigator",
            payload,
            graph=_graph(),
            pinned_rule_ids=("eng-1",),
            pinned_versions={"technicalEvidenceReportId": "ter-1"},
        )

    message = str(exc_info.value)
    assert "claim-1" in message
    assert "node:missing" in message


def test_project_safe_edge_exposes_edge_id_for_topology_proof() -> None:
    """The Investigator's tool projection must give the model what the topology gate requires."""
    projected = _project_safe_edge(
        {
            "edge_id": "edge:receives",
            "source_node_id": "node:ai",
            "target_node_id": "node:output",
            "edge_type": "RECEIVES_FROM_AI",
            "resolution_state": "CORROBORATED",
            "evidence_refs": [],
        }
    )

    assert projected["edge_id"] == "edge:receives"


# ============================================================================
# Gemini structured-output relaxation audit (middleware/provider_schema.py).
#
# `relax_array_upper_bounds` must only ever remove `maxItems`. If it ever started
# widening `required` or `enum` too, the provider could legally emit payloads that
# satisfy Gemini but were never valid `InvestigatorResult`/`InvestigatorClaim` shapes,
# reintroducing exactly the failure class this suite guards against.
# ============================================================================


def _all_required_lists(schema: dict) -> dict[str, list[str]]:
    required: dict[str, list[str]] = {}
    if "required" in schema:
        required[schema.get("title", "<root>")] = list(schema["required"])
    for name, definition in (schema.get("$defs") or {}).items():
        if "required" in definition:
            required[name] = list(definition["required"])
    return required


def _all_enums(schema: dict, *, path: str = "") -> dict[str, list]:
    enums: dict[str, list] = {}

    def walk(node, node_path: str) -> None:
        if isinstance(node, dict):
            if "enum" in node:
                enums[node_path] = list(node["enum"])
            for key, value in node.items():
                walk(value, f"{node_path}.{key}")
        elif isinstance(node, list):
            for index, value in enumerate(node):
                walk(value, f"{node_path}[{index}]")

    walk(schema, path)
    return enums


_INVESTIGATOR_CLAIM_VARIANT_DEFS = (
    "InvestigatorRequirementMetClaim",
    "InvestigatorRequirementNotMetClaim",
    "InvestigatorUnresolvedClaim",
    "InvestigatorScopeNotApplicableClaim",
)


def test_gemini_relaxation_is_lossless_for_required_fields_and_enums() -> None:
    schema = InvestigatorResult.model_json_schema()
    relaxed = relax_array_upper_bounds(schema)

    assert _all_required_lists(relaxed) == _all_required_lists(schema)
    assert _all_enums(relaxed) == _all_enums(schema)
    # `claims.items` must still be exactly the 4 per-claim_type variants (anyOf) after
    # relaxation, or Gemini could legally emit a shape outside the closed set.
    claims_items = relaxed["properties"]["claims"]["items"]
    refs = {entry["$ref"].rsplit("/", 1)[-1] for entry in claims_items["anyOf"]}
    assert refs == set(_INVESTIGATOR_CLAIM_VARIANT_DEFS)
    # Each variant's own claim_type is a single-value `const` (not a multi-value enum) —
    # together the 4 variants' consts must still be exactly ENGINEERING_EVIDENCE_CLAIM_TYPES.
    consts = {
        relaxed["$defs"][name]["properties"]["claim_type"]["const"]
        for name in _INVESTIGATOR_CLAIM_VARIANT_DEFS
    }
    assert consts == {
        "RULE_REQUIREMENT_MET",
        "RULE_REQUIREMENT_NOT_MET",
        "UNRESOLVED_ENGINEERING_FACT",
        "RULE_SCOPE_NOT_APPLICABLE",
    }


# ============================================================================
# Root-cause regression #2: real run, engineering_rule_id=
# AUTO-VN-LEGAL-2026-08-134-2025-QH15::art-10::cl-1::ENG::1, evidence_ref_count=99.
#
# "investigator handoff failed schema validation: claims.0: Value error,
#  UNRESOLVED_ENGINEERING_FACT claims require at least one limitation code"
#
# The compliance gate itself was always correct here (see
# test_investigator_claim_schema_rejects_unresolved_without_limitation above, which already
# predates this incident). The actual gap was structural-output-first, same class as the
# edge_id bug: `limitations` was a bare `list[str]` with no enum in the JSON schema handed to
# the model, so nothing told the model which codes exist, let alone that UNRESOLVED requires
# one. These tests pin the schema fix and the claim_type branches that still lacked direct
# validator-shape coverage.
# ============================================================================


def test_investigator_claim_limitations_field_exposes_a_closed_enum() -> None:
    """Every claim_type variant's schema must expose the valid limitation codes."""
    schema = InvestigatorResult.model_json_schema()
    expected = {
        "ENGINEERING_EVIDENCE_INSUFFICIENT",
        "DYNAMIC_PATH_UNRESOLVED",
        "EXTERNAL_BOUNDARY_UNRESOLVED",
        "GRAPH_COVERAGE_LIMITED",
        "SEARCH_COVERAGE_INCOMPLETE",
        "ENGINEERING_INVESTIGATION_FAILED",
    }
    for name in _INVESTIGATOR_CLAIM_VARIANT_DEFS:
        limitations_schema = schema["$defs"][name]["properties"]["limitations"]
        assert set(limitations_schema["items"]["enum"]) == expected, name


def test_unresolved_claim_variant_requires_a_non_empty_limitations_list_structurally() -> None:
    """The exact real-run gap: `limitations` must have min_length=1, not just be a plain list."""
    schema = InvestigatorResult.model_json_schema()
    limitations_schema = schema["$defs"]["InvestigatorUnresolvedClaim"]["properties"][
        "limitations"
    ]
    assert limitations_schema.get("minItems") == 1
    assert "limitations" in schema["$defs"]["InvestigatorUnresolvedClaim"]["required"]


def test_scope_not_applicable_variant_structurally_forbids_graph_and_source_refs() -> None:
    """max_length=0, not a runtime check: the model cannot populate these fields at all."""
    schema = InvestigatorResult.model_json_schema()
    scope_properties = schema["$defs"]["InvestigatorScopeNotApplicableClaim"]["properties"]
    for field in ("evidence_refs", "graph_path_refs", "source_anchor_refs"):
        assert scope_properties[field].get("maxItems") == 0, field
    assert scope_properties["customer_context_refs"].get("minItems") == 1


def test_relaxation_preserves_maxitems_zero_but_strips_larger_bounds() -> None:
    """relax_array_upper_bounds must keep maxItems:0 (a shape contract) while still
    stripping the large expansion-cost bounds it exists for."""
    schema = InvestigatorResult.model_json_schema()
    relaxed = relax_array_upper_bounds(schema)
    scope_properties = relaxed["$defs"]["InvestigatorScopeNotApplicableClaim"]["properties"]

    assert scope_properties["evidence_refs"].get("maxItems") == 0
    assert scope_properties["customer_context_refs"].get("maxItems") is None
    assert relaxed["properties"]["claims"].get("maxItems") is None


def test_unresolved_claim_with_invalid_limitation_code_fails_at_the_schema_layer() -> None:
    """An out-of-enum code is now rejected by the type itself, not only the custom validator."""
    payload = _investigator_payload()
    payload["claims"][0]["limitations"] = ["NOT_A_REAL_CODE"]

    with pytest.raises(SpecialistHandoffValidationError, match="schema validation"):
        validate_specialist_handoff("investigator", payload)


def test_requirement_not_met_claim_rejected_without_any_ref() -> None:
    """RULE_REQUIREMENT_NOT_MET has the same ref requirement as MET, not just NOT_MET's value."""
    payload = _handoff_with_claim(
        _ai_output_path_claim(
            claim_type="RULE_REQUIREMENT_NOT_MET",
            value=False,
            evidence_refs=[],
            graph_path_refs=[],
            source_anchor_refs=[],
        )
    )

    with pytest.raises(SpecialistHandoffValidationError, match="schema validation") as exc_info:
        validate_specialist_handoff("investigator", payload)

    assert "at least one evidence, graph-path, or source-anchor ref" in str(exc_info.value)


def test_scope_not_applicable_claim_rejected_when_carrying_graph_refs() -> None:
    """RULE_SCOPE_NOT_APPLICABLE must not carry graph/source refs, even alongside customer_context_refs.

    Structurally enforced now (max_length=0 on the field), not a post-hoc check — and the
    _filter_union_variant_noise cleanup means the message names the exact field/reason
    instead of the smart-union's per-variant noise from the other 3 claim shapes.
    """
    payload = _investigator_payload()
    payload["claims"] = [
        {
            "claim_id": "claim-scope-1",
            "engineering_rule_id": "eng-1",
            "claim_type": "RULE_SCOPE_NOT_APPLICABLE",
            "value": None,
            "evidence_refs": [],
            "graph_path_refs": ["node:ai"],
            "source_anchor_refs": [],
            "customer_context_refs": ["stmt-good"],
            "confidence": 0.0,
            "limitations": [],
            "criterion": "TARGETED_SCOPE_EXCLUDED",
        }
    ]

    with pytest.raises(SpecialistHandoffValidationError, match="schema validation") as exc_info:
        validate_specialist_handoff("investigator", payload)

    message = str(exc_info.value)
    assert "claims.0.graph_path_refs" in message
    assert "at most 0 items" in message
    # No noise from the other 3 non-matching variants.
    assert "InvestigatorRequirementMetClaim" not in message
    assert message.count(";") == 0


def test_system_authored_failure_claim_keeps_its_reserved_limitation_code() -> None:
    """_failed_investigator_handoff's synthetic claim must still parse after the enum tightening.

    Mirrors managed_targeted_investigator._failed_investigator_handoff exactly: a
    "claim:failed:"-prefixed claim_id carrying ENGINEERING_INVESTIGATION_FAILED, the one code
    reserved for system-authored claims and excluded from what a model may select.
    """
    handoff = InvestigatorResult.model_validate(
        {
            "status": "READY",
            "artifact_versions": {"technicalEvidenceReportId": "ter-1"},
            "claims": [
                {
                    "claim_id": "claim:failed:eng-1",
                    "engineering_rule_id": "eng-1",
                    "claim_type": "UNRESOLVED_ENGINEERING_FACT",
                    "value": None,
                    "evidence_refs": [],
                    "graph_path_refs": [],
                    "source_anchor_refs": [],
                    "confidence": 0.0,
                    "limitations": ["ENGINEERING_INVESTIGATION_FAILED"],
                    "criterion": "handoff rejected twice",
                }
            ],
            "limitations": ["ENGINEERING_INVESTIGATION_FAILED"],
            "missing_input": None,
            "business_context_need": None,
            "next_step": "GATE",
        }
    )

    assert handoff.claims[0].limitations == ["ENGINEERING_INVESTIGATION_FAILED"]


def test_model_authored_claim_cannot_use_the_system_reserved_limitation_code() -> None:
    """The Literal type is a superset (system + model codes); the runtime validator still narrows
    it per claim_id origin, so a model-authored claim_id must not get away with the reserved code."""
    payload = _investigator_payload()
    payload["claims"][0]["claim_type"] = "UNRESOLVED_ENGINEERING_FACT"
    payload["claims"][0]["limitations"] = ["ENGINEERING_INVESTIGATION_FAILED"]

    with pytest.raises(SpecialistHandoffValidationError, match="unsupported codes"):
        validate_specialist_handoff("investigator", payload)


# ============================================================================
# Root-cause regression #3: cc3125d0's enum fix was necessary but insufficient — an empty
# `limitations: []` still satisfied the JSON schema (no min_length), so the model still emitted
# it and still died in the post-hoc validator at 18:18:07,
# engineering_rule_id=AUTO-VN-LEGAL-2026-08-134-2025-QH15::art-10::cl-1::ENG::1.
#
# Root architectural cause: InvestigatorClaim was one flat, uniformly-permissive model with a
# claim_type discriminator dispatched to _INVESTIGATOR_CLAIM_VALIDATORS in Python the model never
# sees. Every per-claim_type obligation (min_length on limitations, required criterion, the
# scope_not_applicable "no graph/source refs" rule) lived only in that Python dispatch. These
# tests pin the union-of-variants replacement that makes those obligations part of the schema
# itself, and the specific wire-format choice (anyOf, not oneOf+discriminator) that was verified
# against the installed langchain_google_genai library before committing to it.
# ============================================================================


def test_investigator_claim_union_uses_anyof_not_oneof_discriminator() -> None:
    """The load-bearing wire-format choice: verified empirically, not assumed.

    langchain_google_genai's schema converter (_function_utils.py) has explicit, tested handling
    for `anyOf` but zero handling anywhere for `oneOf`/`discriminator` — neither key is in its
    `_ALLOWED_SCHEMA_FIELDS`, so either would be silently dropped with a warning log for the
    tool/function-declaration path. A `Field(discriminator=...)` union renders `oneOf` +
    `discriminator`; a plain `Union` (what contracts/handoffs.py actually uses) renders `anyOf`.
    If this ever flips back to a discriminated union, it reaches Gemini's tool-declaration path
    as an empty/broken schema — this test exists to catch that regression before a live run does.
    """
    schema = InvestigatorResult.model_json_schema()
    claims_items = schema["properties"]["claims"]["items"]
    assert "anyOf" in claims_items
    assert "oneOf" not in claims_items
    assert "discriminator" not in claims_items


def test_recorded_unresolved_empty_limitations_failure_is_now_structurally_unrepresentable() -> None:
    # 2026-09-11 18:18:07, engineering_rule_id=
    # AUTO-VN-LEGAL-2026-08-134-2025-QH15::art-10::cl-1::ENG::1: the enum-only fix (cc3125d0)
    # left `limitations: []` schema-valid for UNRESOLVED_ENGINEERING_FACT, so the model kept
    # emitting it. Confirms the exact recorded shape is now rejected before any deterministic
    # gate runs, with a clean single-cause message (not smart-union noise).
    payload = _investigator_payload()
    payload["claims"] = [
        {
            "claim_id": "claim-art10-cl1",
            "engineering_rule_id": "eng-1",
            "claim_type": "UNRESOLVED_ENGINEERING_FACT",
            "value": None,
            "confidence": 0.0,
            "limitations": [],
        }
    ]

    with pytest.raises(SpecialistHandoffValidationError, match="schema validation") as exc_info:
        validate_specialist_handoff("investigator", payload)

    message = str(exc_info.value)
    assert "claims.0.limitations" in message
    assert "at least 1 item" in message
    assert "InvestigatorRequirementMetClaim" not in message
    assert message.count(";") == 0
