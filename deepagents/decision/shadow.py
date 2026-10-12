"""Shadow integrations for low-risk LCSP Decision Gateway surfaces."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from .contracts import DECISION_TYPES, DecisionGatewayOutcome, DecisionQuestion, DecisionRequest
from .gateway import DecisionGateway
from .telemetry import TelemetrySink


PR_REVIEW_DOMAIN_CHOICES = (
    "AUTH",
    "BILLING",
    "REPOSITORY",
    "AGENT_RUNTIME",
    "LEGAL_REQUIREMENTS",
    "CI_RELEASE",
    "WEB",
    "DATA",
    "OTHER",
)
NOUL_REASON_CODES = (
    "YES",
    "NO",
    "UNCERTAIN",
    "BOUNDED_SIGNAL",
    "INSUFFICIENT_BOUNDED_STATE",
)


@dataclass(frozen=True)
class PrReviewTriagePacket:
    pr_number: int
    head_sha: str
    base_sha: str | None = None
    review_run_id: str | None = None
    changed_filenames: tuple[str, ...] = ()
    change_categories: tuple[str, ...] = ()
    jira_issue_ids: tuple[str, ...] = ()
    acceptance_criteria_ids: tuple[str, ...] = ()
    bounded_summary: str | None = None
    ci_state_codes: tuple[str, ...] = ()
    repository_change_metadata: tuple[str, ...] = ()
    diff_stat_keys: tuple[str, ...] = ()
    addition_count: int | None = None
    deletion_count: int | None = None
    pge_artifact_version: str | None = None






@dataclass(frozen=True)
class ShadowDecisionRecord:
    decision_id: str
    decision_type: str
    authoritative_action: str | None
    shadow_proposed_action: str | None
    agreement: bool | None
    confidence: float | None
    fallback_reason: str | None
    telemetry_events: tuple[dict[str, Any], ...] = ()
    gateway_outcome: DecisionGatewayOutcome | None = None
    skipped: bool = False


class DecisionIdempotencyStore(Protocol):
    """Durable decision-id claim store used to suppress replayed provider calls."""

    def claim(self, decision_id: str, *, request: DecisionRequest) -> bool:
        """Atomically claim one decision ID before provider execution."""

    def complete(self, record: ShadowDecisionRecord) -> None:
        """Persist the final shadow comparison for replay/audit."""


class DecisionIdempotencyClaimUnavailable(RuntimeError):
    """Raised when a durable idempotency claim cannot be established."""


class InMemoryDecisionIdempotencyStore:
    """Test/local idempotency store; production should pass an API-backed store."""

    def __init__(self) -> None:
        self.claimed: set[str] = set()
        self.records: dict[str, ShadowDecisionRecord] = {}

    def claim(self, decision_id: str, *, request: DecisionRequest) -> bool:
        if decision_id in self.claimed:
            return False
        self.claimed.add(decision_id)
        return True

    def complete(self, record: ShadowDecisionRecord) -> None:
        self.records[record.decision_id] = record




class ShadowDecisionObserver:
    """Invoke Jev in shadow mode and persist only comparison telemetry."""

    def __init__(
        self,
        *,
        gateway: DecisionGateway | None = None,
        telemetry_sink: TelemetrySink | None = None,
        idempotency_store: DecisionIdempotencyStore | None = None,
        seen_decision_ids: set[str] | None = None,
    ) -> None:
        self._gateway = gateway or DecisionGateway()
        self._telemetry_sink = telemetry_sink
        if idempotency_store is None:
            memory_store = InMemoryDecisionIdempotencyStore()
            if seen_decision_ids is not None:
                memory_store.claimed.update(seen_decision_ids)
            self._idempotency_store = memory_store
        else:
            self._idempotency_store = idempotency_store

    def observe_pr_review_triage(
        self,
        packet: PrReviewTriagePacket,
        *,
        authoritative_domain: str | None = None,
    ) -> ShadowDecisionRecord:
        request = build_pr_review_triage_request(packet)
        return self._observe(
            request,
            integration="PR_REVIEW_TRIAGE",
            authoritative_action=authoritative_domain,
            comparison_question_id="affected_domain",
        )



    def _observe(
        self,
        request: DecisionRequest,
        *,
        integration: str,
        authoritative_action: str | None,
        comparison_question_id: str,
    ) -> ShadowDecisionRecord:
        try:
            claimed = self._idempotency_store.claim(request.decision_id, request=request)
        except DecisionIdempotencyClaimUnavailable:
            return ShadowDecisionRecord(
                decision_id=request.decision_id,
                decision_type=request.decision_type,
                authoritative_action=authoritative_action,
                shadow_proposed_action=None,
                agreement=None,
                confidence=None,
                fallback_reason="IDEMPOTENCY_CLAIM_UNAVAILABLE",
                skipped=True,
            )
        if not claimed:
            return ShadowDecisionRecord(
                decision_id=request.decision_id,
                decision_type=request.decision_type,
                authoritative_action=authoritative_action,
                shadow_proposed_action=None,
                agreement=None,
                confidence=None,
                fallback_reason="DUPLICATE_DECISION_ID",
                skipped=True,
            )

        outcome = self._gateway.decide(request)
        proposed = _selected_choice(outcome, comparison_question_id)
        agreement = (
            proposed == authoritative_action
            if proposed is not None and authoritative_action is not None
            else None
        )
        confidence = outcome.provider_result.confidence if outcome.provider_result else None
        fallback_reason = (
            outcome.policy_result.reason_code
            if outcome.policy_result.reason_code != "SHADOW_MODE_OBSERVE_ONLY"
            else None
        )
        events = tuple(
            _enrich_event(
                event,
                integration=integration,
                authoritative_action=authoritative_action,
                shadow_proposed_action=proposed,
                agreement=agreement,
                confidence=confidence,
                fallback_reason=fallback_reason,
            )
            for event in outcome.telemetry_events
        )
        if self._telemetry_sink is not None:
            for event in events:
                self._telemetry_sink(event)
        record = ShadowDecisionRecord(
            decision_id=request.decision_id,
            decision_type=request.decision_type,
            authoritative_action=authoritative_action,
            shadow_proposed_action=proposed,
            agreement=agreement,
            confidence=confidence,
            fallback_reason=fallback_reason,
            telemetry_events=events,
            gateway_outcome=outcome,
        )
        self._idempotency_store.complete(record)
        return record


def build_pr_review_triage_request(packet: PrReviewTriagePacket) -> DecisionRequest:
    state_payload: dict[str, Any] = {
        "pr_number": packet.pr_number,
        "head_sha": packet.head_sha,
        "changed_file_count": len(packet.changed_filenames),
        "changed_filenames": _bounded_tuple(packet.changed_filenames, limit=80),
        "changed_file_exts": _file_extensions(packet.changed_filenames),
        "change_categories": _bounded_tuple(packet.change_categories, limit=40),
        "jira_issue_ids": _bounded_tuple(packet.jira_issue_ids, limit=40),
        "acceptance_criteria_ids": _bounded_tuple(packet.acceptance_criteria_ids, limit=80),
        "ci_state_codes": _bounded_tuple(packet.ci_state_codes, limit=40),
        "repository_change_metadata": _bounded_tuple(packet.repository_change_metadata, limit=80),
        "diff_stat_keys": _bounded_tuple(packet.diff_stat_keys, limit=80),
    }
    if packet.base_sha:
        state_payload["base_sha"] = packet.base_sha
    if packet.bounded_summary:
        state_payload["bounded_summary"] = packet.bounded_summary
    if packet.addition_count is not None:
        state_payload["addition_count"] = max(0, int(packet.addition_count))
    if packet.deletion_count is not None:
        state_payload["deletion_count"] = max(0, int(packet.deletion_count))

    artifact_versions = {}
    if packet.pge_artifact_version:
        artifact_versions["pge"] = packet.pge_artifact_version

    return DecisionRequest(
        decision_id=f"review-triage-v1:{packet.pr_number}:{packet.head_sha}",
        decision_type=DECISION_TYPES["pr_review_triage"],
        review_run_id=packet.review_run_id,
        pr_number=packet.pr_number,
        base_sha=packet.base_sha,
        head_sha=packet.head_sha,
        artifact_versions=artifact_versions,
        state_payload=state_payload,
        questions=(
            DecisionQuestion(
                question_id="affected_domain",
                question_type="CHOICE",
                prompt="Choose the bounded affected review domain.",
                choices=PR_REVIEW_DOMAIN_CHOICES,
            ),
            *_noul_questions(
                "security_sensitive_change",
                "Return whether bounded metadata suggests security sensitivity.",
                "exact_head_lifecycle_risk",
                "Return whether exact-head lifecycle handling needs attention.",
                "needs_deep_review",
                "Return whether bounded metadata suggests deep review is needed.",
                "likely_missing_regression_tests",
                "Return whether bounded metadata suggests missing regression tests.",
                "requires_sandbox_attention",
                "Return whether bounded metadata suggests sandbox attention.",
            ),
            _score_question("change_complexity", "Score bounded change complexity."),
            _score_question("operational_risk", "Score bounded operational risk."),
            _score_question("review_depth", "Score bounded review depth."),
        ),
    )






def _noul_questions(*items: str) -> tuple[DecisionQuestion, ...]:
    if len(items) % 2 != 0:
        raise ValueError("NOUL question IDs and prompts must be paired")
    return tuple(
        DecisionQuestion(
            question_id=items[index],
            question_type="NOUL",
            prompt=items[index + 1],
            noul_schema=_boolean_noul_schema(),
        )
        for index in range(0, len(items), 2)
    )


def _score_question(question_id: str, prompt: str) -> DecisionQuestion:
    return DecisionQuestion(
        question_id=question_id,
        question_type="SCORE",
        prompt=prompt,
        score_min=0,
        score_max=1,
        score_rubric={
            "0": "minimal bounded signal",
            "0.5": "moderate bounded signal",
            "1": "strong bounded signal",
        },
    )


def _boolean_noul_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "required": ["value", "reason_code"],
        "additionalProperties": False,
        "properties": {
            "value": {"type": "boolean"},
            "reason_code": {"type": "string", "enum": list(NOUL_REASON_CODES)},
        },
    }


def _bounded_tuple(values: tuple[str, ...], *, limit: int) -> tuple[str, ...]:
    return tuple(str(item).strip()[:240] for item in values[:limit] if str(item).strip())


def _file_extensions(paths: tuple[str, ...]) -> tuple[str, ...]:
    extensions: list[str] = []
    for path in paths:
        name = str(path).rsplit("/", 1)[-1]
        if "." not in name:
            continue
        ext = "." + name.rsplit(".", 1)[-1].lower()[:24]
        if ext not in extensions:
            extensions.append(ext)
    return tuple(extensions[:40])


def _selected_choice(outcome: DecisionGatewayOutcome, question_id: str) -> str | None:
    if outcome.provider_result is None:
        return None
    for result in outcome.provider_result.question_results:
        if result.question_id == question_id:
            return result.selected_choice
    return None


def _enrich_event(
    event: dict[str, Any],
    *,
    integration: str,
    authoritative_action: str | None,
    shadow_proposed_action: str | None,
    agreement: bool | None,
    confidence: float | None,
    fallback_reason: str | None,
) -> dict[str, Any]:
    data = dict(event.get("data") or {})
    data.update(
        {
            "integration": integration,
            "authoritativeAction": authoritative_action,
            "shadowProposedAction": shadow_proposed_action,
            "agreement": agreement,
            "confidence": confidence,
            "fallbackReason": fallback_reason,
        }
    )
    return {**event, "data": {key: value for key, value in data.items() if value is not None}}


def shadow_record_payload(record: ShadowDecisionRecord) -> dict[str, Any]:
    return {
        "decisionId": record.decision_id,
        "decisionType": record.decision_type,
        "authoritativeAction": record.authoritative_action,
        "shadowProposedAction": record.shadow_proposed_action,
        "agreement": record.agreement,
        "confidence": record.confidence,
        "fallbackReason": record.fallback_reason,
        "skipped": record.skipped,
    }






__all__ = [
    "PR_REVIEW_DOMAIN_CHOICES",
    "DecisionIdempotencyClaimUnavailable",
    "DecisionIdempotencyStore",
    "InMemoryDecisionIdempotencyStore",
    "PrReviewTriagePacket",
    "ShadowDecisionObserver",
    "ShadowDecisionRecord",
    "build_pr_review_triage_request",
    "shadow_record_payload",
]
