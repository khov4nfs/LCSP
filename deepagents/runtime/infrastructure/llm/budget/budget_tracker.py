"""Legacy compatibility shim for the removed LLM monthly budget mechanism.

LCSP no longer enforces monthly token or USD buckets for LLM calls.  The
``BudgetTracker`` API is retained temporarily so existing gateway construction
and older imports do not break while the runtime migrates, but it performs no
Redis access and never blocks a provider request.
"""

from __future__ import annotations


class BudgetExceeded(Exception):
    """Legacy exception retained for import compatibility.

    Production runtime code no longer raises this exception from budget
    accounting because monthly LLM budget enforcement has been removed.
    """


class BudgetTracker:
    """No-op compatibility adapter after removal of LLM budget enforcement.

    ``monthly_budget_usd``, ``monthly_token_cap`` and ``redis_url`` are accepted
    only so existing callers can migrate without a flag day.  They are not used
    to gate requests, persist counters, or communicate with Redis.
    """

    def __init__(
        self,
        monthly_budget_usd: float,
        monthly_token_cap: int,
        redis_url: str | None = None,
    ) -> None:
        self.monthly_budget_usd = monthly_budget_usd
        self.monthly_token_cap = monthly_token_cap
        self.redis_url = redis_url
        # Retained only for compatibility with any diagnostic/test code that
        # reads this attribute. It is never consulted for request gating.
        self._in_memory_store = {
            "cost": 0.0,
            "tokens": 0,
        }

    def check_budget(
        self,
        input_tokens: int,
        output_tokens: int,
        estimated_cost: float,
    ) -> None:
        """Allow every LLM call regardless of accumulated token/cost values."""
        del input_tokens, output_tokens, estimated_cost

    def check_budget_and_accumulate(
        self,
        input_tokens: int,
        output_tokens: int,
        estimated_cost: float,
    ) -> None:
        """Do not persist or enforce monthly usage buckets.

        Provider usage remains available on ``LLMResponse`` for observability,
        but LCSP itself no longer maintains Redis/in-memory budget counters.
        """
        del input_tokens, output_tokens, estimated_cost
