"""The single Python reader of the ACTIVE legal portfolio.

Assessments only read and pin the portfolio the API reports as ACTIVE. There is no
compile, recovery, cache or bundle path: a missing portfolio is a preparation state,
never inline compilation.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from tools.common.capabilities.platform.api_client import WorkerCallbackError

ACTIVE_PORTFOLIO_NOT_FOUND = "ACTIVE_LEGAL_PORTFOLIO_NOT_FOUND"


@dataclass(frozen=True)
class ActivePortfolio:
    """The pinned, immutable ACTIVE portfolio as served by the API."""

    portfolio_version_id: str
    version: str
    legal_corpus_version_id: str
    portfolio_digest: str
    legal_rules: tuple[dict[str, Any], ...]
    engineering_rules: tuple[dict[str, Any], ...]
    context_relations: tuple[dict[str, Any], ...]


def read_active_portfolio(api: Any) -> ActivePortfolio | None:
    """Return the ACTIVE portfolio, or ``None`` when none exists (not an error)."""
    try:
        data = api.get_active_legal_portfolio()
    except WorkerCallbackError as error:
        if getattr(error, "error_code", None) == ACTIVE_PORTFOLIO_NOT_FOUND:
            return None
        raise
    return ActivePortfolio(
        portfolio_version_id=str(data["portfolioVersionId"]),
        version=str(data["version"]),
        legal_corpus_version_id=str(data["legalCorpusVersionId"]),
        portfolio_digest=str(data["portfolioDigest"]),
        legal_rules=tuple(data.get("legalRules") or ()),
        engineering_rules=tuple(data.get("engineeringRules") or ()),
        context_relations=tuple(data.get("contextRelations") or ()),
    )
