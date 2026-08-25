"""Direct LegalRule -> EngineeringRule -> graph investigation -> rule evaluation runtime."""
from __future__ import annotations

from contextlib import nullcontext
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from tools.legal.retrieval.legal_basis.chromadb_citation_retriever import ChromaDbCitationRetriever
from tools.legal.corpus.engineering_rules.compilation.compiler import EngineeringRuleCompiler
from tools.legal.corpus.engineering_rules.orchestration.service import EngineeringRuleService
from model_policy import INVESTIGATOR_MODEL_SPEC, PLANNER_MODEL_SPEC
from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.platform.logging import get_logger
from tools.common.capabilities.evidence.graph.schema.models import ProgramEvidenceGraph

from tools.common.capabilities.assessment.investigation.engineering_rule.code_context import CodeContextSession
from tools.common.capabilities.assessment.investigation.engineering_rule.code_context_investigator import CodeContextLawGuidedInvestigator
from tools.common.capabilities.assessment.investigation.engineering_rule.initial_query_executor import InitialQueryExecutor
from tools.common.capabilities.assessment.investigation.engineering_rule.investigator import LawGuidedInvestigator
from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_EVIDENCE_CLAIM_TYPES,
    ENGINEERING_LIMITATION_CODES,
    EvidenceClaim,
)
from .rule_evaluator import EngineeringRuleEvaluation, EngineeringRuleEvaluator


logger = get_logger(__name__)
MAX_TECHNICAL_EVIDENCE_DISPLAY_ITEMS = 12


@dataclass(frozen=True)
class EngineeringInvestigationResult:
    """Canonical direct assessment output produced from the Program Evidence Graph."""

    status: str
    legal_rule_catalog_version_id: str
    legal_corpus_version_id: str
    rules_considered: int
    engineering_rules_executed: int
    engineering_rule_cache_hits: int
    claims: tuple[EvidenceClaim, ...] = ()
    evaluations: tuple[EngineeringRuleEvaluation, ...] = ()
    limitations: tuple[str, ...] = ()
    technical_evidence_by_rule: dict[str, tuple[dict[str, Any], ...]] = field(
        default_factory=dict
    )
    observability: dict[str, Any] = field(default_factory=dict)

    def to_assessment_data(self) -> dict[str, Any]:
        evaluations: list[dict[str, Any]] = []
        for evaluation in self.evaluations:
            payload = evaluation.to_dict()
            payload["technical_evidence"] = list(
                self.technical_evidence_by_rule.get(
                    evaluation.engineering_rule_id,
                    (),
                )
            )
            evaluations.append(payload)
        return {
            "mode": "ENGINEERING_RULE_EVALUATION",
            "status": self.status,
            "legal_rule_catalog_version_id": self.legal_rule_catalog_version_id,
            "legal_corpus_version_id": self.legal_corpus_version_id,
            "rules_considered": self.rules_considered,
            "engineering_rules_executed": self.engineering_rules_executed,
            "engineering_rule_cache_hits": self.engineering_rule_cache_hits,
            "summary": {
                "compliant": sum(
                    1 for item in self.evaluations if item.status == "COMPLIANT"
                ),
                "non_compliant": sum(
                    1 for item in self.evaluations if item.status == "NON_COMPLIANT"
                ),
                "unknown": sum(
                    1 for item in self.evaluations if item.status == "UNKNOWN"
                ),
                "total": len(self.evaluations),
            },
            "evaluations": evaluations,
            "claims": [claim.to_dict() for claim in self.claims],
            "limitations": list(self.limitations),
            "observability": {
                **dict(self.observability),
                "provenance": self._provenance_summary(evaluations),
            },
        }

    # Compatibility for any tests/readers still calling the old method name. The
    # payload is no longer persisted as TechnicalProfile data.
    def to_profile_data(self) -> dict[str, Any]:
        return self.to_assessment_data()

    def _provenance_summary(
        self,
        evaluation_payloads: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return {
            "claim_count": len(self.claims),
            "claims_with_evidence": sum(
                1
                for claim in self.claims
                if claim.evidence_refs
                or claim.graph_path_refs
                or claim.source_anchor_refs
            ),
            "evaluations_with_evidence": sum(
                1
                for item in evaluation_payloads
                if item.get("evidence_refs")
                or item.get("graph_path_refs")
                or item.get("source_anchor_refs")
            ),
            "evaluations_with_displayable_technical_evidence": sum(
                1 for item in evaluation_payloads if item.get("technical_evidence")
            ),
        }


class EngineeringInvestigationPipeline:
    """Own the direct repository compliance investigation lifecycle in Python.

    Legal chunks and approved LegalRule identities are used only to compile/cache
    EngineeringRules. EngineeringRules guide Program Evidence Graph investigation;
    deterministic evaluation then emits COMPLIANT/NON_COMPLIANT/UNKNOWN outcomes.
    No TechnicalProfile, AIUsageFlow, VerifiedProfile, or LegalRuleMatch is required.

    Repository source, when available, is read only from the immutable snapshot's
    temporary workspace by ``CodeContextSession``. It is never added to persisted
    TechnicalEvidenceReport/ProgramEvidenceGraph payloads. Safe source-location
    metadata needed by the assessment UI is projected from the in-memory graph into
    the ClassificationResult so API readers never depend on worker-local graph files.
    """

    def __init__(
        self,
        *,
        api_client: WorkerApiClient,
        model: str = INVESTIGATOR_MODEL_SPEC,
        compiler_model: str = PLANNER_MODEL_SPEC,
        retriever: ChromaDbCitationRetriever | None = None,
        rule_service: EngineeringRuleService | None = None,
        query_executor: InitialQueryExecutor | None = None,
        investigator: LawGuidedInvestigator | None = None,
        evaluator: EngineeringRuleEvaluator | None = None,
    ) -> None:
        self._api_client = api_client
        self._retriever = retriever or ChromaDbCitationRetriever()
        self._rule_service = rule_service or EngineeringRuleService(
            compiler=EngineeringRuleCompiler(compiler_model),
            retriever=self._retriever,
        )
        self._query_executor = query_executor or InitialQueryExecutor()
        self._investigator = investigator or CodeContextLawGuidedInvestigator(model)
        self._evaluator = evaluator or EngineeringRuleEvaluator()

    def run(
        self,
        *,
        evidence_report: dict[str, Any],
        workflow_run_id: str,
        correlation_id: str | None = None,
        wizard_context: dict[str, Any] | None = None,
        workspace_path: str | Path | None = None,
    ) -> EngineeringInvestigationResult:
        graph = self._graph(evidence_report)
        code_context = CodeContextSession(graph, workspace_path=workspace_path)
        catalog = self._api_client.get_active_legal_rule_catalog()
        corpus = self._api_client.get_active_legal_corpus()
        catalog_version_id = self._required_id(
            catalog,
            "versionId",
            "version_id",
            "id",
            label="legal rule catalog version",
        )
        corpus_version_id = self._required_id(
            corpus,
            "versionId",
            "version_id",
            "corpusVersionId",
            "corpus_version_id",
            "id",
            label="legal corpus version",
        )
        corpus_index = self._api_client.get_legal_corpus_chunks(corpus_version_id)
        chunks = corpus_index.get("chunks") or []
        if not isinstance(chunks, list):
            raise ValueError("active legal corpus chunks are invalid")
        self._retriever.index_corpus(
            corpus_version_id,
            [item for item in chunks if isinstance(item, dict)],
        )

        rules = [
            rule
            for rule in (catalog.get("rules") or [])
            if isinstance(rule, dict) and self._is_approved_rule(rule)
        ]
        claims: list[EvidenceClaim] = []
        evaluations: list[EngineeringRuleEvaluation] = []
        technical_evidence_by_rule: dict[str, tuple[dict[str, Any], ...]] = {}
        limitations: list[str] = []
        executed = 0
        cache_hits = 0

        if not rules:
            return EngineeringInvestigationResult(
                status="BLOCKED",
                legal_rule_catalog_version_id=catalog_version_id,
                legal_corpus_version_id=corpus_version_id,
                rules_considered=0,
                engineering_rules_executed=0,
                engineering_rule_cache_hits=0,
                limitations=(
                    ENGINEERING_LIMITATION_CODES[
                        "no_engineering_rule_source_rules"
                    ],
                ),
            )

        with nullcontext():
            for rule in rules:
                legal_rule_id = str(
                    rule.get("legalRuleId")
                    or rule.get("legal_rule_id")
                    or rule.get("id")
                    or "unknown"
                )
                try:
                    engineering_rules, cache_hit = self._rule_service.get_or_compile(
                        legal_rule=rule,
                        legal_rule_catalog_version_id=catalog_version_id,
                        legal_corpus_version_id=corpus_version_id,
                        workflow_run_id=workflow_run_id,
                        correlation_id=correlation_id,
                    )
                    if cache_hit:
                        cache_hits += 1
                except Exception as error:
                    logger.warning(
                        "ENGINEERING_RULE_COMPILATION_FAILED",
                        legal_rule_id=legal_rule_id,
                        error_type=type(error).__name__,
                        error_message=str(error)[:500],
                        workflow_run_id=workflow_run_id,
                        correlationId=correlation_id,
                    )
                    limitations.append(
                        ENGINEERING_LIMITATION_CODES[
                            "engineering_rule_compilation_failed"
                        ]
                    )
                    continue

                for engineering_rule in engineering_rules:
                    packet = self._query_executor.execute(
                        engineering_rule,
                        graph,
                        wizard_context=wizard_context,
                    )
                    try:
                        if isinstance(
                            self._investigator, CodeContextLawGuidedInvestigator
                        ):
                            rule_claims = self._investigator.investigate(
                                packet=packet,
                                graph=graph,
                                workflow_run_id=workflow_run_id,
                                correlation_id=correlation_id,
                                code_context=code_context,
                            )
                        else:
                            rule_claims = self._investigator.investigate(
                                packet=packet,
                                graph=graph,
                                workflow_run_id=workflow_run_id,
                                correlation_id=correlation_id,
                            )
                    except Exception as error:
                        logger.warning(
                            "ENGINEERING_INVESTIGATION_FAILED",
                            engineering_rule_id=engineering_rule.engineering_rule_id,
                            error_type=type(error).__name__,
                            workflow_run_id=workflow_run_id,
                            correlationId=correlation_id,
                        )
                        rule_claims = [
                            EvidenceClaim(
                                claim_id=(
                                    f"claim:failed:{engineering_rule.engineering_rule_id}"
                                ),
                                engineering_rule_id=engineering_rule.engineering_rule_id,
                                claim_type=ENGINEERING_EVIDENCE_CLAIM_TYPES[
                                    "unresolved"
                                ],
                                value=None,
                                evidence_refs=tuple(packet.evidence_refs),
                                confidence=0.0,
                                limitations=(
                                    ENGINEERING_LIMITATION_CODES[
                                        "engineering_investigation_failed"
                                    ],
                                ),
                            )
                        ]
                        limitations.append(
                            ENGINEERING_LIMITATION_CODES[
                                "engineering_investigation_failed"
                            ]
                        )

                    claims.extend(rule_claims)
                    evaluation = self._evaluator.evaluate(engineering_rule, rule_claims)
                    evaluations.append(evaluation)
                    technical_evidence_by_rule[evaluation.engineering_rule_id] = tuple(
                        self._technical_evidence_displays(graph, evaluation.evidence_refs)
                    )
                    executed += 1

        # Pipeline status describes execution integrity, not the compliance outcome
        # distribution. UNKNOWN is a valid deterministic EngineeringRule result and
        # must not degrade the guardrail by itself. PARTIAL is reserved for runtime
        # defects/skipped rules captured in top-level limitations.
        status = "COMPLETE"
        if not evaluations:
            status = "BLOCKED"
        elif limitations:
            status = "PARTIAL"

        return EngineeringInvestigationResult(
            status=status,
            legal_rule_catalog_version_id=catalog_version_id,
            legal_corpus_version_id=corpus_version_id,
            rules_considered=len(rules),
            engineering_rules_executed=executed,
            engineering_rule_cache_hits=cache_hits,
            claims=tuple(claims),
            evaluations=tuple(evaluations),
            limitations=tuple(dict.fromkeys(limitations)),
            technical_evidence_by_rule=technical_evidence_by_rule,
        )

    @staticmethod
    def _technical_evidence_displays(
        graph: ProgramEvidenceGraph,
        evidence_refs: tuple[str, ...],
    ) -> list[dict[str, Any]]:
        """Project immutable graph identities into safe source-location metadata.

        TechnicalEvidenceReport persistence intentionally strips the full graph and
        retains only a worker-local graph reference. The API process cannot dereference
        that path. Classification therefore carries this bounded metadata projection;
        it contains no source body, prompt, secret or model output.
        """
        nodes = [row for row in graph.nodes if isinstance(row, dict)]
        edges = [row for row in graph.edges if isinstance(row, dict)]
        anchors = [row for row in graph.source_anchors if isinstance(row, dict)]
        node_by_id = {
            str(row.get("node_id")): row
            for row in nodes
            if row.get("node_id")
        }
        edge_by_id = {
            str(row.get("edge_id")): row
            for row in edges
            if row.get("edge_id")
        }
        anchor_by_id = {
            str(row.get("anchor_id")): row
            for row in anchors
            if row.get("anchor_id")
        }
        nodes_by_evidence_ref: dict[str, list[dict[str, Any]]] = {}
        for node in nodes:
            for ref in node.get("evidence_refs") or []:
                nodes_by_evidence_ref.setdefault(str(ref), []).append(node)

        displays: list[dict[str, Any]] = []
        seen: set[tuple[Any, ...]] = set()

        def add(item: dict[str, Any] | None) -> None:
            if item is None:
                return
            key = (
                item.get("kind"),
                item.get("label"),
                item.get("file_path"),
                item.get("symbol_ref"),
                item.get("start_line"),
                item.get("end_line"),
            )
            if key in seen:
                return
            seen.add(key)
            displays.append(item)

        def from_node(node: dict[str, Any]) -> dict[str, Any]:
            source = node.get("source") if isinstance(node.get("source"), dict) else {}
            return {
                "kind": str(node.get("node_type") or "TECHNICAL_EVIDENCE"),
                "label": str(
                    node.get("label")
                    or source.get("symbol_ref")
                    or "Repository evidence"
                ),
                "file_path": source.get("file_path"),
                "symbol_ref": source.get("symbol_ref"),
                "start_line": source.get("start_line"),
                "end_line": source.get("end_line"),
            }

        def from_anchor(anchor: dict[str, Any]) -> dict[str, Any]:
            linked = node_by_id.get(str(anchor.get("graph_node_id") or ""))
            base = from_node(linked) if linked else None
            return {
                "kind": (base or {}).get("kind") or "SOURCE_LOCATION",
                "label": (
                    (base or {}).get("label")
                    or anchor.get("symbol_ref")
                    or anchor.get("file_path")
                    or "Repository source location"
                ),
                "file_path": anchor.get("file_path") or (base or {}).get("file_path"),
                "symbol_ref": anchor.get("symbol_ref") or (base or {}).get("symbol_ref"),
                "start_line": anchor.get("start_line")
                if anchor.get("start_line") is not None
                else (base or {}).get("start_line"),
                "end_line": anchor.get("end_line")
                if anchor.get("end_line") is not None
                else (base or {}).get("end_line"),
            }

        def from_edge(edge: dict[str, Any]) -> dict[str, Any] | None:
            source = node_by_id.get(str(edge.get("source_node_id") or ""))
            target = node_by_id.get(str(edge.get("target_node_id") or ""))
            location = source or target
            if location is None:
                return None
            item = from_node(location)
            item["kind"] = str(edge.get("edge_type") or item["kind"])
            if source and target:
                item["label"] = (
                    f"{from_node(source)['label']} → {from_node(target)['label']}"
                )
            return item

        for ref in evidence_refs:
            if len(displays) >= MAX_TECHNICAL_EVIDENCE_DISPLAY_ITEMS:
                break
            if ref in node_by_id:
                add(from_node(node_by_id[ref]))
                continue
            if ref in anchor_by_id:
                add(from_anchor(anchor_by_id[ref]))
                continue
            if ref in edge_by_id:
                add(from_edge(edge_by_id[ref]))
                continue
            for node in nodes_by_evidence_ref.get(ref, []):
                add(from_node(node))
                if len(displays) >= MAX_TECHNICAL_EVIDENCE_DISPLAY_ITEMS:
                    break

        return displays[:MAX_TECHNICAL_EVIDENCE_DISPLAY_ITEMS]

    @staticmethod
    def _graph(evidence_report: dict[str, Any]) -> ProgramEvidenceGraph:
        payload = evidence_report.get("evidence_payload") or evidence_report.get(
            "evidencePayload"
        )
        if not isinstance(payload, dict):
            raise ValueError("technical evidence report has no evidence payload")
        graph_payload = payload.get("evidence_graph") or payload.get("evidenceGraph")
        if not isinstance(graph_payload, dict):
            raise ValueError("technical evidence report has no Program Evidence Graph")
        graph = ProgramEvidenceGraph.from_dict(graph_payload)
        if not graph.graph_id or not graph.graph_hash:
            raise ValueError("Program Evidence Graph provenance is incomplete")
        return graph

    @staticmethod
    def _required_id(
        payload: dict[str, Any],
        *keys: str,
        label: str,
    ) -> str:
        for key in keys:
            value = payload.get(key)
            if value:
                return str(value)
        raise ValueError(f"missing {label}")

    @staticmethod
    def _is_approved_rule(rule: dict[str, Any]) -> bool:
        status = str(
            rule.get("status")
            or rule.get("lifecycleState")
            or rule.get("lifecycle_state")
            or ""
        ).upper()
        return status in {"", "ACTIVE", "APPROVED", "PUBLISHED"}
