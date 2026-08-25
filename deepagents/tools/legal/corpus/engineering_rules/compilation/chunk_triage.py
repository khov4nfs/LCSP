"""LLM-assisted triage for legal chunks before EngineeringRule compilation."""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from langchain.agents import create_agent

from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
from model_policy import TRIAGE_MODEL_SPEC
from tools.legal.retrieval.legal_basis.normative_chunk_filter import (
    CHUNK_NORMATIVE_CLASSES,
    is_engineering_rule_source_chunk,
)


CHUNK_TRIAGE_VERDICTS = {
    "engineering_rule_candidate": "ENGINEERING_RULE_CANDIDATE",
    "context_only": "CONTEXT_ONLY",
    "reject": "REJECT",
}
TRIAGE_PROMPT_VERSION = "legal-chunk-triage/v1"


@dataclass(frozen=True)
class LegalChunkTriageDecision:
    chunk_id: str
    verdict: str
    reason: str
    engineering_obligation: str
    verification_targets: tuple[str, ...]


class LegalChunkEngineeringRuleTriage:
    """Classify approved legal chunks into compile-safe EngineeringRule sources."""

    def __init__(self, model: str = TRIAGE_MODEL_SPEC) -> None:
        self._model = model

    def analyze(
        self,
        *,
        legal_rule: dict[str, Any],
        legal_context: list[dict[str, Any]],
        workflow_run_id: str,
        correlation_id: str | None = None,
    ) -> list[LegalChunkTriageDecision]:
        if not legal_context:
            return []
        chunk_ids = tuple(
            dict.fromkeys(
                str(chunk["id"])
                for chunk in legal_context
                if chunk.get("id")
            )
        )
        agent = create_agent(
            model=self._model,
            system_prompt=(
                "Classify approved legal chunks only. Do not make legal conclusions "
                "or invent repository evidence."
            ),
            response_format=_triage_response_schema(chunk_ids),
            middleware=MODEL_GOVERNANCE_MIDDLEWARE,
            name="lcsp-legal-chunk-triage",
        )
        result = agent.invoke(
            {"messages": [{"role": "user", "content": self._prompt(legal_rule, legal_context)}]},
            config={
                "metadata": {
                    "workflow_run_id": workflow_run_id,
                    "node_name": "triage_legal_chunks_for_engineering_rules",
                    "correlationId": correlation_id,
                },
                "configurable": {"thread_id": workflow_run_id},
            },
        )
        return self._parse_decisions(result.get("structured_response"), legal_context)

    @staticmethod
    def _parse_decisions(
        payload: dict[str, Any] | list[Any] | None,
        legal_context: list[dict[str, Any]],
    ) -> list[LegalChunkTriageDecision]:
        if not isinstance(payload, dict):
            raise ValueError("legal chunk triage structured response must be object")
        raw_rows = payload.get("chunkAnalyses")
        if not isinstance(raw_rows, list):
            raise ValueError("legal chunk triage must return chunkAnalyses")
        known = {str(chunk.get("id")): chunk for chunk in legal_context if chunk.get("id")}
        decisions: dict[str, LegalChunkTriageDecision] = {}
        for raw in raw_rows:
            if not isinstance(raw, dict):
                continue
            chunk_id = str(raw.get("chunkId") or "")
            if chunk_id not in known:
                raise ValueError("legal chunk triage returned unknown chunkId")
            verdict = str(raw.get("verdict") or "")
            if verdict not in CHUNK_TRIAGE_VERDICTS.values():
                raise ValueError("legal chunk triage returned invalid verdict")
            verification_targets = tuple(
                str(value)
                for value in raw.get("verificationTargets") or []
                if isinstance(value, str) and value.strip()
            )
            engineering_obligation = str(raw.get("engineeringObligation") or "").strip()
            reason = str(raw.get("reason") or "").strip()
            if verdict == CHUNK_TRIAGE_VERDICTS["engineering_rule_candidate"]:
                if not engineering_obligation or not verification_targets:
                    raise ValueError(
                        "engineering-rule candidate chunk must include obligation and verification targets"
                    )
            decisions[chunk_id] = LegalChunkTriageDecision(
                chunk_id=chunk_id,
                verdict=verdict,
                reason=reason,
                engineering_obligation=engineering_obligation,
                verification_targets=verification_targets,
            )

        missing = sorted(set(known) - set(decisions))
        if missing:
            raise ValueError(f"legal chunk triage omitted chunks: {missing[:5]}")
        return [decisions[str(chunk.get("id"))] for chunk in legal_context]

    @staticmethod
    def select_engineering_rule_context(
        legal_context: list[dict[str, Any]],
        decisions: list[LegalChunkTriageDecision],
    ) -> list[dict[str, Any]]:
        by_id = {decision.chunk_id: decision for decision in decisions}
        selected: list[dict[str, Any]] = []
        for chunk in legal_context:
            chunk_id = str(chunk.get("id") or "")
            decision = by_id.get(chunk_id)
            if decision is None:
                continue
            if decision.verdict != CHUNK_TRIAGE_VERDICTS["engineering_rule_candidate"]:
                continue
            # The LLM is a second gate, not an authority to promote definitions,
            # principles, policies, or weak keyword hits into engineering rules.
            if not is_engineering_rule_source_chunk(chunk):
                continue
            selected.append(
                {
                    **chunk,
                    "engineeringRuleTriage": {
                        "promptVersion": TRIAGE_PROMPT_VERSION,
                        "verdict": decision.verdict,
                        "reason": decision.reason,
                        "engineeringObligation": decision.engineering_obligation,
                        "verificationTargets": list(decision.verification_targets),
                    },
                }
            )
        return selected

    @staticmethod
    def _prompt(legal_rule: dict[str, Any], legal_context: list[dict[str, Any]]) -> str:
        contract = {
            "task": (
                "Analyze each approved legal chunk and decide whether it is a direct "
                "source for EngineeringRule compilation."
            ),
            "guardrails": [
                "Return one analysis for every chunkId.",
                "ENGINEERING_RULE_CANDIDATE only when the chunk imposes an operational or technical obligation that can be verified from repository evidence.",
                "A repository-verifiable obligation must imply observable code/config/process evidence such as control flow, audit logging, monitoring, risk management, human review, disclosure, reporting, retention, access control, safety checks, incident handling, or data governance.",
                "CONTEXT_ONLY for scope, definitions, principles, state policy, background, applicability context, and general legal interpretation.",
                "REJECT for headers, preamble, signatures, chapter titles, or text that is not legal substance.",
                "Do not convert context-only chunks into engineering rules even if they mention AI, privacy, transparency, risk, or human control in general terms.",
                "Treat deterministicNormativeClass as a lower-bound gate: if it is CONTEXT_ONLY or EXCLUDE_FROM_DATABASE, do not promote the chunk to ENGINEERING_RULE_CANDIDATE.",
                "Prefer clause/point chunks over broad article chunks. Article-level chunks should be candidates only when the whole article itself is a concrete technical obligation.",
                "Definitions can supply vocabulary for later rules, but must not become EngineeringRules by themselves.",
            ],
            "legalRule": legal_rule,
            "chunks": [
                {
                    "chunkId": str(chunk.get("id") or ""),
                    "locator": str(chunk.get("locator") or ""),
                    "locatorGranularity": _locator_granularity(
                        str(chunk.get("locator") or "")
                    ),
                    "hierarchy": chunk.get("hierarchy") or {},
                    "content": str(chunk.get("content") or ""),
                    "deterministicNormativeClass": (
                        CHUNK_NORMATIVE_CLASSES["engineering_rule_candidate"]
                        if is_engineering_rule_source_chunk(chunk)
                        else legal_context_normative_class(chunk)
                    ),
                    "compileEligibility": {
                        "deterministicGate": (
                            "PASS"
                            if is_engineering_rule_source_chunk(chunk)
                            else "BLOCK"
                        ),
                        "meaning": (
                            "Only PASS chunks can be selected for EngineeringRule "
                            "compilation after LLM triage. BLOCK chunks remain legal "
                            "context only."
                        ),
                    },
                }
                for chunk in legal_context
            ],
            "output": {
                "chunkAnalyses": [
                    {
                        "chunkId": "exact chunk id",
                        "verdict": list(CHUNK_TRIAGE_VERDICTS.values()),
                        "reason": "short reason",
                        "engineeringObligation": "empty unless candidate",
                        "verificationTargets": ["empty unless candidate"],
                    }
                ]
            },
        }
        return "Use the configured structured response format only.\n" + json.dumps(
            contract,
            ensure_ascii=False,
            sort_keys=True,
        )


def legal_context_normative_class(chunk: dict[str, Any]) -> str:
    hierarchy = chunk.get("hierarchy") if isinstance(chunk.get("hierarchy"), dict) else {}
    value = str(hierarchy.get("normativeClass") or "")
    if value in CHUNK_NORMATIVE_CLASSES.values():
        return value
    return CHUNK_NORMATIVE_CLASSES["context_only"]


def _triage_response_schema(chunk_ids: tuple[str, ...]) -> dict[str, Any]:
    return {
        "title": "LegalChunkTriageResponse",
        "description": "Engineering-rule eligibility triage for approved legal chunks.",
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "chunkAnalyses": {
                "type": "array",
                "minItems": len(chunk_ids),
                "maxItems": len(chunk_ids),
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "chunkId": {
                            "type": "string",
                            "enum": list(chunk_ids),
                            "description": "Exact legal context chunk id.",
                        },
                        "verdict": {
                            "type": "string",
                            "enum": list(CHUNK_TRIAGE_VERDICTS.values()),
                        },
                        "reason": {
                            "type": "string",
                            "description": "Short grounded reason for the verdict.",
                        },
                        "engineeringObligation": {
                            "type": "string",
                            "description": "Empty unless the verdict is ENGINEERING_RULE_CANDIDATE.",
                        },
                        "verificationTargets": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Repository or runtime evidence targets for candidate chunks.",
                        },
                    },
                    "required": [
                        "chunkId",
                        "verdict",
                        "reason",
                        "engineeringObligation",
                        "verificationTargets",
                    ],
                },
            }
        },
        "required": ["chunkAnalyses"],
    }


def _locator_granularity(locator: str) -> str:
    if "::pt-" in locator:
        return "POINT"
    if "::cl-" in locator:
        return "CLAUSE"
    if locator.startswith("art-"):
        return "ARTICLE"
    return "UNKNOWN"
