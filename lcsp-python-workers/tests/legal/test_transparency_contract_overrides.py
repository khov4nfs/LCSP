from __future__ import annotations

import json
from pathlib import Path

import pytest

from lcsp_workers.investigation.evidence_claim_validator import (
    EvidenceClaimValidationError,
    EvidenceClaimValidator,
)
from lcsp_workers.investigation.models import EvidenceClaim
from lcsp_workers.legal.engineering_rules.precompiled_contract_overrides import (
    PrecompiledContractOverrideError,
    apply_precompiled_contract_overrides,
    load_precompiled_contract_overrides,
)
from lcsp_workers.scanner.program_graph.models import ProgramEvidenceGraph


_EXPECTED_REQUIRED = {
    "VN134_ART11_1_DIRECT_INTERACTION_DISCLOSURE": (
        "DIRECT_AI_INTERACTION_SURFACE",
        "AI_INTERACTION_DISCLOSURE_CONTROL",
    ),
    "VN134_ART11_2_MACHINE_READABLE_MEDIA_MARK": (
        "AI_MEDIA_OUTPUT_SURFACE",
        "MACHINE_READABLE_MARK_CONTROL",
    ),
    "VN134_ART11_3_PUBLIC_CONTENT_NOTICE": (
        "PUBLIC_AI_CONTENT_SURFACE",
        "PUBLIC_AI_CONTENT_NOTICE_CONTROL",
    ),
    "VN134_ART11_4_DEEPFAKE_LABEL": (
        "DEEPFAKE_OR_SIMULATED_MEDIA_SURFACE",
        "VISIBLE_DEEPFAKE_LABEL_CONTROL",
    ),
    "VN134_ART11_5_MAINTAIN_TRANSPARENCY": (
        "AI_OUTPUT_SURFACE",
        "TRANSPARENCY_CONTROL_PRESENT",
        "TRANSPARENCY_CONTROL_CONTINUITY",
    ),
    "VN134_ART15_1A_MEDIUM_TRANSPARENCY": (
        "AI_OUTPUT_SURFACE",
        "ARTICLE_11_TRANSPARENCY_CONTROL",
        "TRANSPARENCY_CONTROL_CONTINUITY",
    ),
}


def _node(node_id: str, *, label: str, path: str, evidence_ref: str) -> dict:
    return {
        "node_id": node_id,
        "node_type": "FUNCTION",
        "label": label,
        "source": {
            "file_path": path,
            "symbol_ref": label,
            "start_line": 1,
            "end_line": 4,
        },
        "attributes": {},
        "semantic_types": [],
        "evidence_refs": [evidence_ref],
    }


def _graph(*nodes: dict) -> ProgramEvidenceGraph:
    return ProgramEvidenceGraph(
        graph_id="graph-transparency",
        snapshot_id="snapshot-1",
        commit_sha="abc123",
        node_count=len(nodes),
        edge_count=0,
        nodes=list(nodes),
        edges=[],
        source_anchors=[],
        evidence_refs=sorted(
            {ref for node in nodes for ref in node.get("evidence_refs") or []}
        ),
        graph_hash="sha256:transparency",
    )


def _claim(*, criterion: str, evidence_ref: str) -> EvidenceClaim:
    return EvidenceClaim(
        claim_id=f"claim:{criterion.lower()}",
        engineering_rule_id="eng-transparency",
        claim_type="RULE_REQUIREMENT_MET",
        value=True,
        evidence_refs=(evidence_ref,),
        confidence=0.9,
        criterion=criterion,
    )


def _base_transparency_bundle() -> dict:
    """Minimal governed-bundle shape needed to verify the technical overlay."""
    return {
        "bundleId": "VN-AI-ENGINEERING-RULES-2026-08-PRECOMPILED",
        "templates": [
            {
                "templateId": template_id,
                "requiredEvidence": ["AI_OUTPUT_SURFACE"],
            }
            for template_id in _EXPECTED_REQUIRED
        ],
    }


def _write_transparency_overrides(tmp_path: Path) -> Path:
    """Own the governed contract fixture instead of requiring generated repo artifacts."""
    path = tmp_path / "contract-overrides.json"
    path.write_text(
        json.dumps(
            {
                "bundleId": "VN-AI-ENGINEERING-RULES-2026-08-PRECOMPILED",
                "contractVersion": "transparency-controls/2026-08-20.1",
                "templates": [
                    {
                        "templateId": template_id,
                        "requiredEvidence": list(required),
                    }
                    for template_id, required in _EXPECTED_REQUIRED.items()
                ],
            }
        ),
        encoding="utf-8",
    )
    return path


def test_governed_overlay_tightens_all_target_transparency_templates(
    tmp_path: Path,
) -> None:
    overrides = load_precompiled_contract_overrides(
        str(_write_transparency_overrides(tmp_path))
    )

    templates, contract_version = apply_precompiled_contract_overrides(
        _base_transparency_bundle(), overrides
    )
    by_id = {str(row["templateId"]): row for row in templates}

    assert contract_version == "transparency-controls/2026-08-20.1"
    for template_id, required in _EXPECTED_REQUIRED.items():
        assert tuple(by_id[template_id]["requiredEvidence"]) == required
        assert tuple(by_id[template_id]["requiredEvidence"]) != ("AI_OUTPUT_SURFACE",)


def test_overlay_cannot_modify_legal_grounding_or_intent() -> None:
    bundle = {
        "bundleId": "bundle-1",
        "templates": [
            {
                "templateId": "T1",
                "legalIntent": {"requirement": "LEGAL_REQUIREMENT"},
                "matchCitationChunkIds": ["LAW:A1"],
                "groundingContextHashes": {"LAW:A1": "sha256:chunk"},
                "requiredEvidence": ["OLD"],
            }
        ],
    }
    overrides = {
        "bundleId": "bundle-1",
        "contractVersion": "v2",
        "templates": [
            {
                "templateId": "T1",
                "requiredEvidence": ["NEW"],
                "legalIntent": {"requirement": "CHANGED"},
            }
        ],
    }

    with pytest.raises(
        PrecompiledContractOverrideError,
        match="FORBIDDEN_FIELDS:legalIntent",
    ):
        apply_precompiled_contract_overrides(bundle, overrides)


def test_generic_llm_token_evidence_cannot_close_machine_readable_mark_control() -> None:
    generic = _node(
        "node:usage",
        label="LLMResponse output_tokens usage_metadata",
        path="src/llm_usage.py",
        evidence_ref="evidence:usage",
    )
    graph = _graph(generic)

    with pytest.raises(EvidenceClaimValidationError):
        EvidenceClaimValidator().validate(
            _claim(
                criterion="MACHINE_READABLE_MARK_CONTROL",
                evidence_ref="evidence:usage",
            ),
            graph,
        )


def test_c2pa_or_provenance_implementation_can_support_machine_readable_mark_control() -> None:
    provenance = _node(
        "node:c2pa",
        label="embed_c2pa_manifest_with_provenance_metadata",
        path="src/media/provenance.py",
        evidence_ref="evidence:c2pa",
    )
    graph = _graph(provenance)

    validated = EvidenceClaimValidator().validate(
        _claim(
            criterion="MACHINE_READABLE_MARK_CONTROL",
            evidence_ref="evidence:c2pa",
        ),
        graph,
    )

    assert validated.evidence_refs == ("evidence:c2pa",)


def test_generic_output_tokens_do_not_prove_ai_media_output_surface() -> None:
    generic = _node(
        "node:usage",
        label="output_tokens response token accounting",
        path="src/llm_usage.py",
        evidence_ref="evidence:usage",
    )
    graph = _graph(generic)

    with pytest.raises(EvidenceClaimValidationError):
        EvidenceClaimValidator().validate(
            _claim(
                criterion="AI_MEDIA_OUTPUT_SURFACE",
                evidence_ref="evidence:usage",
            ),
            graph,
        )
