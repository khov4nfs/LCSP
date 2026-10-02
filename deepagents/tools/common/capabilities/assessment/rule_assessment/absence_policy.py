"""FINAL_ABSENCE policy: absence never finalizes a rule."""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any


def legal_rule_id_of(rule_id: str) -> str:
    """The legal clause a runtime, catalog or precompiled rule id belongs to."""
    return re.split(r"::(?:ENG|PRECOMPILED)(?:::|$)", str(rule_id), maxsplit=1)[0]


def absence_may_finalize(proof: Mapping[str, Any] | None = None) -> bool:
    """Whether a rule may end as FINAL_ABSENCE (RULE_REQUIREMENT_NOT_MET). Never, for now.

    A keyword/synonym scan that found nothing proves that a vocabulary matched no
    file, not that the product lacks the capability, so it cannot end a rule.

    TODO: restore only when the proof is criterion-specific and shows all of:
      - the rule's own graph query was exhausted;
      - Codebase Memory / index coverage of the relevant graph;
      - relevant source coverage (no unread or excluded critical paths);
      - generated / dynamic / excluded frontier checks;
      - the rule's ``unresolvedConditions`` resolved;
      - applicable customer or off-system context, where the rule needs it.
    Until then this returns False whatever the proof says. It deliberately takes the
    proof so callers already route through the one place that will change; do not
    add a flag or environment toggle in front of it.
    """
    del proof
    return False


__all__ = ["absence_may_finalize", "legal_rule_id_of"]
