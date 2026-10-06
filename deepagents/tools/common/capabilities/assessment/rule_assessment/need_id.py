"""Targeted business-context need ids that satisfy the API's stable-id contract."""

from __future__ import annotations

import hashlib
import re

# Mirrors apps/api assessment-interview-runtime.service.ts STABLE_NEED_ID.
_API_NEED_ID = re.compile(r"^need:[A-Za-z0-9_.:-]{1,300}$")
_UNSAFE = re.compile(r"[^A-Za-z0-9_.:-]+")
_PREFIX_BUDGET = 250  # "need:" + prefix + ":" + 12-char digest stays well under 300


def canonical_need_id(need_id: str) -> str:
    """Return ``need_id`` if the API accepts it, else a deterministic API-valid equivalent.

    Criterion ids are authored free text (they contain spaces), so ids built from
    them were rejected by the API and no targeted question was ever registered.
    The digest is over the raw id, so the result is stable across runs (idempotent
    registration) and distinct raw ids never collide on a shared readable prefix.
    """
    if _API_NEED_ID.fullmatch(need_id):
        return need_id
    body = need_id[len("need:"):] if need_id.startswith("need:") else need_id
    readable = _UNSAFE.sub("-", body).strip("-")[:_PREFIX_BUDGET].rstrip("-")
    digest = hashlib.sha256(need_id.encode("utf-8")).hexdigest()[:12]
    return f"need:{readable}:{digest}" if readable else f"need:{digest}"
