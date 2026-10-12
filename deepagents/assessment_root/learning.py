"""Governed generic learning in the native Store; never assessment evidence.

The promotion caller must supply a trusted privacy/injection review signature for the exact
proposal. Neither Root nor its researcher has a promotion tool or access to the signing key.
Structural guards supplement that review; they do not judge legal meaning or semantic privacy.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import uuid
from typing import Annotated, Literal

from langchain_core.tools import tool
from langgraph.config import get_store
from pydantic import BaseModel, ConfigDict, Field, ValidationError

LEARNING_NAMESPACE = ("lcsp-assessment-learning", "v1")
GENERIC_KIND = "SANITIZED_GENERIC"
HEURISTIC_AUTHORITY = "NON_AUTHORITATIVE_HEURISTIC"
_REVIEW_DOMAIN = b"lcsp-assessment-learning-v1:"
_IDENTITY_NAMESPACE = uuid.UUID("3a195164-98b2-49c2-a8a2-41bd3436d663")
_UNSAFE_CONTENT = re.compile(
    r"https?://|[/\\]|[\w.+-]+@[\w.-]+|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|"
    r"\b(?:\d[\s().-]*){7,}\b|\b(?:api[_ -]?key|bearer|password)\b|"
    r"\b(?:ignore|override)\s+(?:all|previous|prior|system)\b|\bsystem\s+prompt\b",
    re.IGNORECASE,
)


class GenericLearningProposal(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    schemaVersion: Literal[1]
    kind: Literal["SANITIZED_GENERIC"]
    summary: str = Field(min_length=10, max_length=600, pattern=r"\S")
    topics: list[Annotated[str, Field(pattern=r"^[a-z][a-z-]{1,39}$")]] = Field(min_length=1, max_length=5)


def promote_reviewed_heuristic(store, proposal: dict, review_signature: str, review_key: str) -> str:
    """Service-only promotion of an exact reviewed proposal, idempotent by its content digest.

    The trusted reviewer signs canonical JSON prefixed with ``_REVIEW_DOMAIN`` using the worker
    service key. A caller-provided 'review passed' boolean never authorizes publication.
    """
    parsed = GenericLearningProposal.model_validate(proposal)
    if parsed.topics != sorted(set(parsed.topics)):
        raise ValueError("generic learning topics must be sorted and unique")
    value = parsed.model_dump()
    canonical = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    expected = hmac.new(review_key.encode(), _REVIEW_DOMAIN + canonical, hashlib.sha256).hexdigest()
    if (not review_key or not re.fullmatch(r"[0-9a-f]{64}", review_signature)
            or not hmac.compare_digest(expected, review_signature)):
        raise ValueError("exact proposal lacks trusted privacy and injection review")
    if _UNSAFE_CONTENT.search(parsed.summary):
        raise ValueError("generic learning contains an identifier, source path, credential or instruction override")
    digest = hashlib.sha256(canonical).hexdigest()
    heuristic_id = str(uuid.uuid5(_IDENTITY_NAMESPACE, digest))
    existing = store.get(LEARNING_NAMESPACE, heuristic_id)
    if existing is not None:
        if existing.value.get("contentSha256") != digest:
            raise ValueError("immutable generic learning digest mismatch")
        return heuristic_id
    store.put(LEARNING_NAMESPACE, heuristic_id, {
        **value, "heuristicId": heuristic_id, "contentSha256": digest,
        "authority": HEURISTIC_AUTHORITY, "state": "ACTIVE", "guardOutcome": "PASS",
    })
    return heuristic_id


class _StoredHeuristic(GenericLearningProposal):
    heuristicId: uuid.UUID
    contentSha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    authority: Literal["NON_AUTHORITATIVE_HEURISTIC"]
    state: Literal["ACTIVE"]
    guardOutcome: Literal["PASS"]


def retrieve_heuristics(store, query: str) -> list[dict]:
    """Read only the versioned generic namespace; malformed or quarantined entries fail closed."""
    terms = set(re.findall(r"[a-z]+", query.casefold()))
    if not terms:
        return []
    results = []
    for item in store.search(LEARNING_NAMESPACE, limit=100):
        try:
            # Store JSON represents UUIDs as strings; only this persistence field is converted.
            parsed = _StoredHeuristic.model_validate({**item.value, "heuristicId": uuid.UUID(item.value["heuristicId"])})
        except (ValidationError, ValueError, KeyError, TypeError):
            continue
        proposal = {name: getattr(parsed, name) for name in GenericLearningProposal.model_fields}
        canonical = json.dumps(proposal, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        digest = hashlib.sha256(canonical).hexdigest()
        if (digest != parsed.contentSha256 or str(uuid.uuid5(_IDENTITY_NAMESPACE, digest)) != item.key
                or str(parsed.heuristicId) != item.key or _UNSAFE_CONTENT.search(parsed.summary)):
            continue
        text = f'{parsed.summary} {" ".join(parsed.topics)}'.casefold()
        if terms & set(re.findall(r"[a-z]+", text)):
            results.append({"heuristicId": str(parsed.heuristicId), "authority": HEURISTIC_AUTHORITY, "summary": parsed.summary, "schemaVersion": parsed.schemaVersion})
        if len(results) == 5:
            break
    return results


@tool
def retrieve_shared_heuristics(query: Annotated[str, Field(min_length=2, max_length=80)]) -> dict:
    """Find bounded generic investigation tips. NON_AUTHORITATIVE_HEURISTIC only: never evidence,
    law, accepted facts, decision provenance or authenticated negative search coverage.
    """
    store = get_store()
    if store is None:
        raise RuntimeError("native learning Store is unavailable")
    return {"authority": HEURISTIC_AUTHORITY, "heuristics": retrieve_heuristics(store, query)}
