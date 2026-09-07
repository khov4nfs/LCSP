"""Customer-safe evidence projection and sanitization for Assessment Interview.

Enforces LCSP-285 boundaries:
- Strips raw source excerpts, credentials, secret-like configurations, and tokens.
- Masks internal engineering rule codes, checkpoint IDs, and continuation tokens.
- Formulates bounded, high-level "Why are we asking?" explanations with resolution awareness.
- Filters unresolved frontiers to only customer-owned, material business distinctions.
- Validates evidence references server-side against authorized session evidence ledger.
"""

from __future__ import annotations

from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping
import re

from middleware.redaction import redact_string

INTERNAL_DISALLOWED_PATTERNS = [
    re.compile(r"\b(?:ENG|ER|LR)-\d+\b", re.IGNORECASE),
    re.compile(r"\b(?:EngineeringRule|LegalRule)\b", re.IGNORECASE),
    re.compile(r"\bcheckpoint(?:Id)?\s*[:=]\s*['\"][^'\"]+['\"]", re.IGNORECASE),
    re.compile(r"\bthread(?:Id)?\s*[:=]\s*['\"][^'\"]+['\"]", re.IGNORECASE),
    re.compile(r"\bcontinuation(?:Token)?\s*[:=]\s*['\"][^'\"]+['\"]", re.IGNORECASE),
    re.compile(r"\bcp-[A-Za-z0-9_-]+\b", re.IGNORECASE),
    re.compile(r"\bcheckpoint(?:Id)?\b", re.IGNORECASE),
    re.compile(r"\bcontinuation(?: token)?\b", re.IGNORECASE),
    re.compile(r"\bLangGraph\b", re.IGNORECASE),
    re.compile(r"\bthread(?:Id)?\b", re.IGNORECASE),
    re.compile(r"\bnode:[0-9a-fA-F-]{8,}\b", re.IGNORECASE),
    re.compile(r"\bsymbol:[a-zA-Z0-9_.:/-]+\b", re.IGNORECASE),
]

SECRET_CONFIG_PATTERNS = [
    re.compile(r"(?:api[_-]?key|secret|token|password|client[_-]?secret)\s*[:=]\s*['\"][^'\"]+['\"]", re.IGNORECASE),
    re.compile(r"Authorization:\s*Bearer\s+[A-Za-z0-9._~+/-]+=*", re.IGNORECASE),
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/-]{16,}\b", re.IGNORECASE),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
    re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"(?:postgres|mysql|mongodb|redis|amqp|http|https)://[^/\s:@]+:[^/\s:@]+@[^/\s]+", re.IGNORECASE),
]

FILE_PATH_PATTERN = re.compile(
    r"\b(?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+\.(?:ts|tsx|js|jsx|py|java|go|rs|cpp|c|h|rb|php|cs|scala|kt)(?::\d+(?::\d+)?)?\b",
    re.IGNORECASE,
)

CODE_SNIPPET_PATTERN = re.compile(
    r"```[\s\S]*?```|(?:(?:function|def|class|const|let|var|import|export|public|private)\s+[\w$]+|\b[\w$]+\s*=>)",
    re.MULTILINE,
)


def normalize_coverage_state(coverage: str | None) -> str:
    """Normalize raw PGE coverage vocabulary (SUFFICIENT/LIMITED) to canonical Interview vocabulary."""
    val = str(coverage or "").strip().upper()
    if val in {"SUFFICIENT", "READY"}:
        return "READY"
    if val in {"LIMITED", "PARTIAL"}:
        return "PARTIAL"
    if val in {"UNAVAILABLE"}:
        return "UNAVAILABLE"
    return "UNAVAILABLE"


def normalize_resolution_state(resolution: Any) -> str:
    """Normalize resolution state to OBSERVED | INFERRED | UNRESOLVED. Unknown/missing defaults to UNRESOLVED."""
    val = str(resolution or "").strip().upper()
    if val in {"OBSERVED", "INFERRED", "UNRESOLVED"}:
        return val
    return "UNRESOLVED"


@dataclass(frozen=True)
class InterviewFrontier:
    """Structured customer or technical frontier representation."""

    owner: str  # "CUSTOMER" | "TECHNICAL" | "SYSTEM"
    materiality: str  # "MATERIAL" | "NON_MATERIAL"
    description: str
    evidence_refs: list[str] = field(default_factory=list)
    id: str | None = None


@dataclass(frozen=True)
class InterviewEvidenceDTO:
    """Internal bounded DTO for Interview specialist reasoning."""

    observation_type: str
    summary: str
    resolution_state: str  # "OBSERVED" | "INFERRED" | "UNRESOLVED"
    coverage_state: str  # "READY" | "PARTIAL" | "UNAVAILABLE"
    coverage_limitations: list[str]
    evidence_refs: list[str]
    unresolved_frontiers: list[InterviewFrontier]
    truncated: bool = False


@dataclass(frozen=True)
class GovernedEvidenceMetadata:
    """Turn-scoped safe metadata for an authorized evidence reference."""

    evidence_ref: str
    resolution_state: str = "UNRESOLVED"  # Default UNRESOLVED, never OBSERVED
    coverage_state: str = "READY"
    coverage_limitations: tuple[str, ...] = ()
    safe_observation: str | None = None


class TurnEvidenceLedger:
    """Turn-scoped authorized evidence ledger with rich governed metadata.

    Records evidence refs and safe metadata returned from governed tools during an interview turn
    and validates model-produced refs against the cumulative authorized set.
    """

    def __init__(
        self,
        initial_authorized_refs: Iterable[str] = (),
        initial_coverage_state: str = "READY",
        initial_coverage_limitations: Iterable[str] = (),
    ) -> None:
        self._authorized_refs: set[str] = set()
        self._metadata_by_ref: dict[str, GovernedEvidenceMetadata] = {}
        # Seeded provenance is authorization-only until a governed tool returns
        # actual certainty metadata for that ref.
        self._authoritative_metadata_refs: set[str] = set()
        cov = normalize_coverage_state(initial_coverage_state)
        lims = tuple(dict.fromkeys(str(l).strip() for l in initial_coverage_limitations if str(l).strip()))
        for r in initial_authorized_refs:
            cleaned = str(r).strip()
            if cleaned:
                self._authorized_refs.add(cleaned)
                self._metadata_by_ref[cleaned] = GovernedEvidenceMetadata(
                    evidence_ref=cleaned,
                    resolution_state="UNRESOLVED",
                    coverage_state=cov,
                    coverage_limitations=lims,
                )

    @property
    def authorized_refs(self) -> set[str]:
        return set(self._authorized_refs)

    def record_retrieved_refs(self, refs: Iterable[str]) -> None:
        for r in refs:
            cleaned = str(r).strip()
            if cleaned:
                self._authorized_refs.add(cleaned)
                if cleaned not in self._metadata_by_ref:
                    self._metadata_by_ref[cleaned] = GovernedEvidenceMetadata(
                        evidence_ref=cleaned,
                        resolution_state="UNRESOLVED",
                    )

    def record_metadata(self, metadata: GovernedEvidenceMetadata) -> None:
        cleaned = str(metadata.evidence_ref).strip()
        if not cleaned:
            return
        self._authorized_refs.add(cleaned)
        existing = self._metadata_by_ref.get(cleaned)
        if existing is None:
            self._metadata_by_ref[cleaned] = metadata
        else:
            obs = metadata.safe_observation or existing.safe_observation
            lims = tuple(dict.fromkeys([*existing.coverage_limitations, *metadata.coverage_limitations]))
            # Conservative coverage aggregation: UNAVAILABLE > PARTIAL > READY. Never upgrade PARTIAL to READY.
            if "UNAVAILABLE" in {existing.coverage_state, metadata.coverage_state}:
                cov = "UNAVAILABLE"
            elif "PARTIAL" in {existing.coverage_state, metadata.coverage_state}:
                cov = "PARTIAL"
            else:
                cov = "READY"

            if cleaned not in self._authoritative_metadata_refs:
                # Replace the seeded UNRESOLVED placeholder with the first real
                # governed observation. Coverage remains conservatively merged.
                res = normalize_resolution_state(metadata.resolution_state)
            else:
                # Multiple governed observations merge conservatively:
                # UNRESOLVED > INFERRED > OBSERVED.
                states = {
                    normalize_resolution_state(existing.resolution_state),
                    normalize_resolution_state(metadata.resolution_state),
                }
                if "UNRESOLVED" in states:
                    res = "UNRESOLVED"
                elif "INFERRED" in states:
                    res = "INFERRED"
                else:
                    res = "OBSERVED"
            self._metadata_by_ref[cleaned] = GovernedEvidenceMetadata(
                evidence_ref=cleaned,
                resolution_state=res,
                coverage_state=cov,
                coverage_limitations=lims,
                safe_observation=obs,
            )
        self._authoritative_metadata_refs.add(cleaned)

    def record_evidence_metadata(self, ref: str, metadata: GovernedEvidenceMetadata) -> None:
        if metadata.evidence_ref != ref:
            metadata = GovernedEvidenceMetadata(
                evidence_ref=ref,
                resolution_state=metadata.resolution_state,
                coverage_state=metadata.coverage_state,
                coverage_limitations=metadata.coverage_limitations,
                safe_observation=metadata.safe_observation,
            )
        self.record_metadata(metadata)

    def get_evidence_metadata(self, ref: str) -> GovernedEvidenceMetadata | None:
        return self.get_metadata(ref)

    def get_metadata(self, ref: str) -> GovernedEvidenceMetadata | None:
        return self._metadata_by_ref.get(str(ref).strip())

    def get_aggregated_certainty(
        self,
        refs: Iterable[str],
    ) -> tuple[str, str, list[str], list[str]]:
        """Aggregate resolution state, coverage state, coverage limitations, and safe observations across refs.

        Returns:
            (resolution_state, coverage_state, coverage_limitations, safe_observations)
        """
        ref_list = [str(r).strip() for r in refs if str(r).strip()]
        if not ref_list:
            return "UNRESOLVED", "READY", [], []

        metas = [self._metadata_by_ref.get(r) for r in ref_list]

        # Coverage: UNAVAILABLE > PARTIAL > READY
        cov_states = [m.coverage_state for m in metas if m]
        if "UNAVAILABLE" in cov_states:
            agg_cov = "UNAVAILABLE"
        elif "PARTIAL" in cov_states:
            agg_cov = "PARTIAL"
        else:
            agg_cov = "READY"

        # Resolution: If missing metadata for any ref -> default UNRESOLVED.
        # If any UNRESOLVED -> UNRESOLVED
        # Else if all OBSERVED -> OBSERVED
        # Else if any INFERRED -> INFERRED
        res_states = [m.resolution_state if m else "UNRESOLVED" for m in metas]
        if any(r == "UNRESOLVED" for r in res_states) or len(metas) < len(ref_list):
            agg_res = "UNRESOLVED"
        elif all(r == "OBSERVED" for r in res_states):
            agg_res = "OBSERVED"
        elif any(r == "INFERRED" for r in res_states):
            agg_res = "INFERRED"
        else:
            agg_res = "UNRESOLVED"

        all_limitations: list[str] = []
        all_obs: list[str] = []
        for m in metas:
            if m:
                for lim in m.coverage_limitations:
                    if lim and lim not in all_limitations:
                        all_limitations.append(lim)
                if m.safe_observation and m.safe_observation not in all_obs:
                    all_obs.append(m.safe_observation)

        return agg_res, agg_cov, all_limitations, all_obs

    def is_authorized(self, ref: str) -> bool:
        return str(ref).strip() in self._authorized_refs

    def validate_refs(self, requested_refs: Iterable[str]) -> tuple[list[str], list[str]]:
        req = [str(r).strip() for r in requested_refs if str(r).strip()]
        authorized = [r for r in req if r in self._authorized_refs]
        rejected = [r for r in req if r not in self._authorized_refs]
        return authorized, rejected


_active_turn_ledger: ContextVar[TurnEvidenceLedger | None] = ContextVar(
    "lcsp_interview_turn_evidence_ledger",
    default=None,
)


def get_active_turn_evidence_ledger() -> TurnEvidenceLedger | None:
    """Return the active turn-scoped evidence ledger for the current invocation."""
    return _active_turn_ledger.get()


def set_active_turn_evidence_ledger(ledger: TurnEvidenceLedger | None) -> Token:
    """Register the active turn-scoped evidence ledger for the current invocation."""
    return _active_turn_ledger.set(ledger)


def reset_active_turn_evidence_ledger(token: Token) -> None:
    """Reset the active turn-scoped evidence ledger using its invocation token."""
    _active_turn_ledger.reset(token)


def sanitize_customer_facing_text(text: str) -> str:
    """Sanitize customer-facing prose to prevent secret, source, or internal token leakage."""
    if not text:
        return ""

    # Remove structured credentials before the generic redactor can partially
    # rewrite a scheme/token and leave credential fragments behind.
    sanitized = text
    for secret_pattern in SECRET_CONFIG_PATTERNS:
        sanitized = secret_pattern.sub("[redacted secret]", sanitized)
    sanitized = re.sub(
        r"://[^/\s:@]+:[^/\s:@]+@[^/\s]+",
        "://[redacted credentials]",
        sanitized,
        flags=re.IGNORECASE,
    )
    sanitized = redact_string(sanitized)
    sanitized = CODE_SNIPPET_PATTERN.sub("[code omitted]", sanitized)
    sanitized = FILE_PATH_PATTERN.sub("[file reference]", sanitized)

    for pattern in INTERNAL_DISALLOWED_PATTERNS:
        sanitized = pattern.sub("", sanitized)

    # Collapse repeated whitespace produced by removals
    sanitized = re.sub(r"[ \t]+", " ", sanitized)
    return sanitized.strip()


def is_customer_owned_frontier(
    frontier_kind: str | None,
    description: str = "",
    materiality: str | None = None,
) -> bool:
    """Evaluate whether an unresolved frontier is a Customer-owned business distinction.

    According to LCSP-285:
    - Only owner == CUSTOMER and materiality == MATERIAL may produce a Customer clarification.
    - TECHNICAL, ARCHITECTURE, ORCHESTRATION, COVERAGE, SYSTEM are NOT customer-owned.
    - Missing or non-MATERIAL materiality fails closed.
    """
    if str(materiality or "").strip().upper() != "MATERIAL":
        return False

    kind = (frontier_kind or "").strip().upper()
    if kind not in {"CUSTOMER", "BUSINESS"}:
        return False

    return True


def evaluate_question_eligibility(
    frontier: InterviewFrontier | dict[str, Any],
    ledger: TurnEvidenceLedger | None = None,
) -> tuple[bool, str]:
    """Deterministic question guard enforcing:
    - frontier.owner == CUSTOMER
    - frontier.materiality == MATERIAL (missing or unknown fails closed)
    - all evidence refs authorized in turn ledger
    """
    if isinstance(frontier, dict):
        owner = str(frontier.get("owner") or "").upper()
        raw_mat = frontier.get("materiality")
        materiality = str(raw_mat).upper() if raw_mat is not None else ""
        refs = list(frontier.get("evidenceRefs") or frontier.get("evidence_refs") or [])
    else:
        owner = str(frontier.owner).upper()
        materiality = str(frontier.materiality).upper() if frontier.materiality is not None else ""
        refs = frontier.evidence_refs

    if owner not in {"CUSTOMER", "BUSINESS"}:
        return False, f"Frontier owner '{owner}' is not CUSTOMER-owned"

    if materiality != "MATERIAL":
        return False, f"Frontier materiality '{materiality}' is not MATERIAL (unknown fails closed)"

    if ledger is not None and refs:
        _, rejected = ledger.validate_refs(refs)
        if rejected:
            raise ValueError(f"Question references unauthorized or fabricated refs: {rejected}")

    return True, "ELIGIBLE"


def extract_governed_evidence_refs(*sources: Any) -> set[str]:
    """Recursively extract all governed evidence references from payload structures."""
    out: set[str] = set()

    def _walk(item: Any) -> None:
        if isinstance(item, dict):
            for k, v in item.items():
                if k in (
                    "evidence_refs",
                    "evidenceRefs",
                    "governedEvidenceRefs",
                    "governed_evidence_refs",
                ):
                    if isinstance(v, (list, tuple, set)):
                        for r in v:
                            if r and isinstance(r, str):
                                out.add(r.strip())
                elif k in ("evidence_ref", "evidenceRef"):
                    if isinstance(v, str) and v.strip():
                        out.add(v.strip())
                else:
                    _walk(v)
        elif isinstance(item, (list, tuple, set)):
            for elem in item:
                _walk(elem)

    for src in sources:
        if src is not None:
            _walk(src)
    return out


def validate_evidence_refs(
    requested_refs: list[str] | tuple[str, ...] | set[str],
    authorized_refs: list[str] | tuple[str, ...] | set[str],
) -> list[str]:
    """Validate that every requested evidence reference is authorized for the current session.

    Fails closed on fabricated, cross-assessment, or mutated references.
    """
    req_set = {str(ref).strip() for ref in requested_refs if str(ref).strip()}
    auth_set = {str(ref).strip() for ref in authorized_refs if str(ref).strip()}

    unauthorized = req_set - auth_set
    if unauthorized:
        raise ValueError(
            f"Evidence references rejected: unauthorized or fabricated refs {sorted(unauthorized)}"
        )
    return sorted(req_set)


def project_customer_safe_evidence(
    graph_data: Mapping[str, Any] | None,
) -> dict[str, Any]:
    """Transform raw Program Evidence Graph results into a bounded, customer-safe representation.

    Uses a strict allowlist: only high-level summary, observation type, resolution state,
    coverage state, high-level limitations, and sanitized labels are included.
    Raw source, line numbers, secrets, internal IDs, and attributes are omitted.
    """
    if not graph_data or not isinstance(graph_data, Mapping):
        return {
            "evidenceRefs": [],
            "nodes": [],
            "coverageState": "UNAVAILABLE",
            "resolutionState": "UNRESOLVED",
            "unresolvedFrontiers": [],
            "coverageLimitations": [],
            "customerSafe": True,
        }

    raw_nodes = graph_data.get("nodes") or []
    safe_nodes: list[dict[str, Any]] = []

    for node in raw_nodes:
        if not isinstance(node, dict):
            continue
        node_type = str(node.get("type") or node.get("node_type") or "NODE")
        label = str(node.get("label") or node.get("name") or node_type)
        sanitized_label = sanitize_customer_facing_text(label)

        safe_nodes.append({
            "type": node_type,
            "label": sanitized_label,
            "evidenceRefs": list(node.get("evidence_refs") or node.get("evidenceRefs") or []),
            "resolutionState": normalize_resolution_state(node.get("resolution_state") or node.get("resolutionState")),
        })

    evidence_refs = list(graph_data.get("evidenceRefs") or graph_data.get("evidence_refs") or [])
    unresolved = [
        sanitize_customer_facing_text(str(item))
        for item in (graph_data.get("unresolvedFrontiers") or graph_data.get("unresolved_frontiers") or [])
        if is_customer_owned_frontier(None, str(item))
    ]

    coverage_state = normalize_coverage_state(
        graph_data.get("coverageState") or graph_data.get("coverage_state")
    )
    if not graph_data.get("coverageState") and not graph_data.get("coverage_state"):
        coverage_state = "READY" if safe_nodes else "UNAVAILABLE"

    resolution_state = normalize_resolution_state(
        graph_data.get("resolutionState") or graph_data.get("resolution_state")
    )

    coverage_notes = list(graph_data.get("coverageNotes") or graph_data.get("coverage_notes") or [])
    coverage_limitations = [sanitize_customer_facing_text(str(n)) for n in coverage_notes]

    return {
        "evidenceRefs": evidence_refs,
        "nodes": safe_nodes,
        "coverageState": coverage_state,
        "resolutionState": resolution_state,
        "coverageLimitations": coverage_limitations,
        "unresolvedFrontiers": unresolved,
        "truncated": bool(graph_data.get("truncated", False)),
        "customerSafe": True,
    }


def build_why_are_we_asking_explanation(
    topic: str,
    evidence_observation: str | None = None,
    resolution_state: str = "UNRESOLVED",  # Default UNRESOLVED, never OBSERVED
    coverage_state: str = "READY",
    coverage_limitations: Iterable[str] = (),
    ledger: TurnEvidenceLedger | None = None,
    evidence_refs: Iterable[str] = (),
) -> str:
    """Build a customer-safe, authorized "Why are we asking?" explanation with resolution awareness.

    Certainty rules:
    - OBSERVED: "We found evidence that..."
    - INFERRED: "We found evidence suggesting that..."
    - UNRESOLVED: "The available technical evidence does not establish whether..."
    - UNAVAILABLE coverage: "Technical evidence is unavailable to determine whether..."
    - PARTIAL coverage preserves limitation semantics without asserting absence.
    - Missing resolution certainty defaults to UNRESOLVED, never OBSERVED.
    """
    clean_topic = sanitize_customer_facing_text(topic)
    if not clean_topic:
        return "We are asking to clarify the operational and business context to ensure accurate assessment coverage."

    limitations = [sanitize_customer_facing_text(str(l)) for l in coverage_limitations if str(l).strip()]
    obs = sanitize_customer_facing_text(evidence_observation or "")

    if ledger is not None and evidence_refs:
        agg_res, agg_cov, agg_lims, agg_obs = ledger.get_aggregated_certainty(evidence_refs)
        res_state = agg_res
        cov_state = agg_cov
        if agg_lims:
            limitations = [sanitize_customer_facing_text(l) for l in agg_lims]
        if agg_obs and not obs:
            obs = sanitize_customer_facing_text(" / ".join(agg_obs))
    else:
        res_state = str(resolution_state or "UNRESOLVED").upper()
        cov_state = normalize_coverage_state(coverage_state)

    if cov_state == "UNAVAILABLE":
        return (
            f"Technical evidence is unavailable to determine whether {clean_topic}, "
            f"so this behavior cannot be established from the current scan. "
            f"We are asking to confirm the real-world operational context."
        )

    if res_state == "UNRESOLVED":
        base = f"The available technical evidence does not establish whether {clean_topic}."
        if cov_state == "PARTIAL" and limitations:
            lim_text = ", ".join(limitations)
            return (
                f"{base} The relevant {lim_text} could not be fully resolved, "
                f"and this distinction affects the assessment."
            )
        if obs:
            return f"{base} Technical observation indicates {obs}, but operational behavior remains unconfirmed."
        return f"{base} We are asking to confirm the real-world operational context."

    if res_state == "INFERRED":
        base = "We found evidence suggesting that"
        if obs:
            explanation = f"{base} {obs} regarding {clean_topic}."
        else:
            explanation = f"{base} this area involves {clean_topic}."
        if cov_state == "PARTIAL" and limitations:
            lim_text = ", ".join(limitations)
            explanation += f" Technical coverage is partial ({lim_text}), so we need your confirmation."
        else:
            explanation += " We are asking to confirm if this reflects your production configuration."
        return explanation

    # OBSERVED
    base = "We found evidence that"
    if obs:
        explanation = f"{base} {obs} regarding {clean_topic}."
    else:
        explanation = f"{base} {clean_topic} is present in the system."
    if cov_state == "PARTIAL" and limitations:
        lim_text = ", ".join(limitations)
        explanation += f" Technical coverage is partial ({lim_text}), so we are asking to confirm the operational context."
    else:
        explanation += " We are asking to confirm the real-world operational context."
    return explanation


