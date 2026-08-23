"""Consume legal-rule-match events and persist guarded classification results."""

from __future__ import annotations

from typing import Any

from lcsp_workers.llm import LLMClientProtocol
from lcsp_workers.platform.api_client import WorkerApiClient
from lcsp_workers.platform.callback_schemas import ClassificationCallbackPayload
from lcsp_workers.platform.logging import get_logger
from lcsp_workers.platform.queue_consumer import ConsumerBase

from .classification_graph import (
    ClassificationGraph,
    ClassificationLangGraphState,
)
from .classification_proposer import ModelAssistedClassificationProposer
from .rationale_narrator import RationaleNarrator

logger = get_logger(__name__)


class ClassificationConsumer(ConsumerBase):
    """Bridge legal-rule-match events into the classification LangGraph flow."""

    queue_name = "classification.legal-rule-match-ready"
    routing_key = "event.legal-rule-match.ready.v1"
    requires_pbac = False  # System event

    def __init__(
        self,
        config,
        llm_client: LLMClientProtocol | None = None,
        api_client: WorkerApiClient | None = None,
    ) -> None:
        """Create the classification consumer and optional LLM assistants.

        Args:
            config: Worker runtime configuration.
            llm_client: Optional LLM client used only for proposal/narration nodes.
            api_client: Optional API client override, primarily for tests.
        """
        super().__init__(config)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self.graph = ClassificationGraph(
            proposer=ModelAssistedClassificationProposer(llm_client)
            if llm_client
            else None,
            narrator=RationaleNarrator(llm_client) if llm_client else None,
            persister=self._persist_graph_result,
            checkpoint_url=getattr(
                config, "langgraph_checkpoint_database_url", None
            ),
            logger=logger,
        )

    def handle(self, message: dict, correlationId: str) -> None:
        """Process one legal-rule-match-ready event.

        Blocked upstream matches are never classified. When the event references
        a persisted legal-rule-match artifact, the canonical artifact is loaded
        from the API before graph execution instead of trusting event payload
        details as the source of truth.

        Args:
            message: RabbitMQ event payload.
            correlationId: End-to-end trace identifier for this delivery.
        """
        logger.info("PROCESSING_CLASSIFICATION", correlationId=correlationId)

        event_guardrail = self._message_value(
            message, "guardrail_status", "guardrailStatus"
        )
        if str(event_guardrail or "").lower() == "blocked":
            logger.warning(
                "CLASSIFICATION_NOT_STARTED",
                reason="LEGAL_RULE_MATCH_BLOCKED",
                legal_rule_match_id=self._message_value(
                    message, "legal_rule_match_id", "legalRuleMatchId"
                ),
                correlationId=correlationId,
            )
            return

        legal_rule_match_id = self._message_value(
            message, "legal_rule_match_id", "legalRuleMatchId"
        )
        if not legal_rule_match_id:
            self.graph.run(
                message=self._normalize_graph_message(message),
                correlationId=correlationId,
            )
            return

        artifact = self._api_client.get_legal_rule_match_by_id(
            str(legal_rule_match_id)
        )
        if str(artifact.get("guardrail_status") or "").lower() == "blocked":
            logger.warning(
                "CLASSIFICATION_NOT_STARTED",
                reason="LEGAL_RULE_MATCH_BLOCKED",
                legal_rule_match_id=legal_rule_match_id,
                correlationId=correlationId,
            )
            return

        graph_message = self._graph_message_from_artifact(message, artifact)
        self.graph.run(
            message=graph_message,
            correlationId=correlationId,
        )

    def _persist_graph_result(
        self,
        graph_payload: dict[str, Any],
        state: ClassificationLangGraphState,
    ) -> None:
        """Translate a graph result into the persisted callback contract.

        Args:
            graph_payload: Final graph output after guardrails.
            state: LangGraph state containing the canonical classification context.
        """
        context = state["message"]
        if context.get("legal_rule_match_id"):
            self._submit_callback(
                self._build_callback_payload(context, graph_payload)
            )
            return

        # Backward-compatible rich-message mode retained for unit/offline tests.
        self._submit_callback(graph_payload)

    def _submit_callback(
        self, payload: ClassificationCallbackPayload | dict[str, Any]
    ) -> None:
        """Submit a contract-shaped classification result to the API.

        Args:
            payload: Validated callback model produced from a persisted artifact.

        Raises:
            ValueError: If legacy rich-message output is used without a persisted
                legal-rule-match artifact.
        """
        if isinstance(payload, ClassificationCallbackPayload):
            self._api_client.post_classification_callback(payload)
            logger.info(
                "CLASSIFICATION_RESULT_SUBMITTED_SUCCESS",
                legal_rule_match_id=payload.legal_rule_match_id,
                assessment_id=payload.assessment_id,
                guardrail_status=payload.guardrail_status,
            )
            return

        raise ValueError(
            "classification callback requires a persisted legal-rule-match artifact"
        )

    def _graph_message_from_artifact(
        self,
        event: dict[str, Any],
        artifact: dict[str, Any],
    ) -> dict[str, Any]:
        """Build graph input from the canonical persisted legal-rule-match artifact.

        Args:
            event: Original event carrying workflow/version metadata.
            artifact: Legal-rule-match artifact fetched from the API.

        Returns:
            Normalized graph input with identifiers, claims, rules, and citations.

        Raises:
            ValueError: If required persisted identifiers are missing.
        """
        profile_data = artifact.get("verified_profile_data")
        usage_claims = self._usage_claims(profile_data)
        classification_version = str(
            self._message_value(
                event, "classification_version", "classificationVersion"
            )
            or "1.0.0"
        )
        assessment_id = str(artifact.get("assessment_id") or "")
        legal_rule_match_id = str(
            artifact.get("legal_rule_match_id") or artifact.get("id") or ""
        )
        verified_profile_id = str(artifact.get("verified_profile_id") or "")
        if not assessment_id:
            raise ValueError("classification artifact missing assessment_id")
        if not legal_rule_match_id or not verified_profile_id:
            raise ValueError("classification artifact identifiers are incomplete")

        return {
            "assessment_id": assessment_id,
            "legal_rule_match_id": legal_rule_match_id,
            "verified_profile_id": verified_profile_id,
            "classification_version": classification_version,
            "usage_claims": usage_claims,
            "applicable_rules": self._dict_list(artifact.get("matches")),
            "citation_allowlist": self._string_list(
                artifact.get("citation_allowlist")
            ),
            "workflow_run_id": self._message_value(
                event, "workflow_run_id", "workflowRunId"
            ),
            "_delivery_attempt": event.get("_delivery_attempt", 0),
        }

    def _build_callback_payload(
        self,
        context: dict[str, Any],
        graph_payload: dict[str, Any],
    ) -> ClassificationCallbackPayload:
        """Build the API callback model from canonical context and graph output.

        Args:
            context: Persisted artifact identifiers and workflow metadata.
            graph_payload: Guarded classification output.

        Returns:
            Contract-valid classification callback payload.

        Raises:
            ValueError: If required artifact identifiers are incomplete.
        """
        legal_rule_match_id = str(context.get("legal_rule_match_id") or "")
        verified_profile_id = str(context.get("verified_profile_id") or "")
        assessment_id = str(context.get("assessment_id") or "")
        if not legal_rule_match_id or not verified_profile_id or not assessment_id:
            raise ValueError("classification callback context is incomplete")

        classification_data = {
            "risk_level": graph_payload["risk_level"],
            "applicability_assessment": graph_payload[
                "applicability_assessment"
            ],
            "citation_basis": graph_payload.get("citation_refs", []),
            "citation_coverage": graph_payload.get("citation_coverage"),
            "rationale": graph_payload.get("rationale"),
            "guardrail_reason": graph_payload.get("guardrail_reason"),
        }
        return ClassificationCallbackPayload(
            legal_rule_match_id=legal_rule_match_id,
            verified_profile_id=verified_profile_id,
            assessment_id=assessment_id,
            schema_version=str(
                graph_payload.get("classification_version") or "1.0.0"
            ),
            classification_data=classification_data,
            guardrail_status=self._contract_guardrail_status(
                graph_payload["guardrail_status"]
            ),
        )

    @classmethod
    def _normalize_graph_message(cls, message: dict[str, Any]) -> dict[str, Any]:
        """Normalize legacy camel/snake-case rich events into graph input."""
        return {
            **message,
            "assessment_id": cls._message_value(
                message, "assessment_id", "assessmentId"
            ),
            "classification_version": cls._message_value(
                message, "classification_version", "classificationVersion"
            )
            or "1.0.0",
            "usage_claims": message.get("usage_claims")
            or message.get("usageClaims")
            or [],
            "applicable_rules": message.get("applicable_rules")
            or message.get("applicableRules")
            or message.get("matches")
            or [],
            "citation_allowlist": message.get("citation_allowlist")
            or message.get("citationAllowlist")
            or [],
        }

    @staticmethod
    def _message_value(message: dict[str, Any], *keys: str):
        """Return the first non-empty value among compatible message keys."""
        for key in keys:
            value = message.get(key)
            if value is not None and value != "":
                return value
        return None

    @staticmethod
    def _usage_claims(profile_data: Any) -> list[dict[str, Any]]:
        """Extract dictionary usage claims from supported profile payload shapes."""
        if not isinstance(profile_data, dict):
            return []
        for key in ("usage_claims", "usageClaims", "claims"):
            value = profile_data.get(key)
            if isinstance(value, list):
                return [entry for entry in value if isinstance(entry, dict)]
        return []

    @staticmethod
    def _dict_list(value: Any) -> list[dict[str, Any]]:
        """Filter an arbitrary value down to a list of dictionaries."""
        if not isinstance(value, list):
            return []
        return [entry for entry in value if isinstance(entry, dict)]

    @staticmethod
    def _string_list(value: Any) -> list[str]:
        """Normalize a list-like contract field into non-empty strings."""
        if not isinstance(value, list):
            return []
        return [str(entry) for entry in value if entry]

    @staticmethod
    def _contract_guardrail_status(value: Any) -> str:
        """Map internal guardrail spelling to the API contract, failing closed."""
        normalized = str(value or "").strip().upper()
        if normalized in {"PASSED", "DEGRADED", "BLOCKED"}:
            return normalized
        if normalized == "PASS":
            return "PASSED"
        return "BLOCKED"
