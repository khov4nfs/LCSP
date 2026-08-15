"""Track monthly LLM token and cost budgets with Redis/in-memory fallback."""

import logging
import datetime
from threading import Lock
from typing import Optional
import redis

logger = logging.getLogger(__name__)


class BudgetExceeded(Exception):
    """Raised when a prospective LLM call would exceed configured limits."""

    pass


class BudgetTracker:
    """Enforce monthly token and USD limits for worker LLM usage.

    Redis is used when available so multiple worker processes share one budget.
    If Redis cannot be reached, the tracker degrades to a process-local store
    rather than disabling budget checks entirely.
    """

    def __init__(
        self,
        monthly_budget_usd: float,
        monthly_token_cap: int,
        redis_url: Optional[str] = None,
    ):
        """Initialize budget limits and the optional shared Redis backend.

        Args:
            monthly_budget_usd: Maximum estimated LLM spend per month.
            monthly_token_cap: Maximum combined input/output tokens per month.
            redis_url: Optional Redis connection URL for shared accounting.
        """
        self.monthly_budget_usd = monthly_budget_usd
        self.monthly_token_cap = monthly_token_cap

        self._redis_client = None
        if redis_url:
            try:
                self._redis_client = redis.from_url(redis_url)
                self._redis_client.ping()
                logger.info("Connected to Redis for budget tracking.")
            except Exception as exc:
                logger.warning(
                    "Failed to connect to Redis for budget tracking. Falling back to in-memory store.",
                    exc_info=exc,
                )
                self._redis_client = None

        self._in_memory_store = {
            "month": datetime.datetime.now(datetime.UTC).month,
            "cost": 0.0,
            "tokens": 0,
        }
        self._lock = Lock()

    def _get_current_month_key(self) -> str:
        """Return the Redis key prefix for the current UTC billing month."""
        now = datetime.datetime.now(datetime.UTC)
        return f"llm_budget:{now.year}-{now.month:02d}"

    def check_budget(
        self,
        input_tokens: int,
        output_tokens: int,
        estimated_cost: float,
    ) -> None:
        """Check a prospective call without recording usage.

        Args:
            input_tokens: Estimated prompt-token count for the call.
            output_tokens: Estimated completion-token count for the call.
            estimated_cost: Estimated provider cost in USD.

        Raises:
            BudgetExceeded: If adding the prospective call would exceed either
                configured monthly limit.
        """
        total_tokens_call = input_tokens + output_tokens
        current_month = datetime.datetime.now(datetime.UTC).month
        month_key = self._get_current_month_key()

        if self._redis_client:
            try:
                current_cost = float(
                    self._redis_client.get(f"{month_key}:cost") or 0.0
                )
                current_tokens = int(
                    self._redis_client.get(f"{month_key}:tokens") or 0
                )
                self._assert_within_budget(
                    current_cost,
                    current_tokens,
                    total_tokens_call,
                    estimated_cost,
                )
                return
            except BudgetExceeded:
                raise
            except Exception as exc:
                logger.warning(
                    "Redis operation failed during budget pre-check. Falling back to in-memory.",
                    exc_info=exc,
                )

        with self._lock:
            self._reset_in_memory_if_needed(current_month)
            self._assert_within_budget(
                float(self._in_memory_store["cost"]),
                int(self._in_memory_store["tokens"]),
                total_tokens_call,
                estimated_cost,
            )

    def check_budget_and_accumulate(
        self, input_tokens: int, output_tokens: int, estimated_cost: float
    ) -> None:
        """Validate a call against the monthly budget and record its usage.

        Args:
            input_tokens: Actual/estimated input tokens attributed to the call.
            output_tokens: Actual/estimated output tokens attributed to the call.
            estimated_cost: Cost in USD to add to the monthly total.

        Raises:
            BudgetExceeded: If the call would exceed a configured monthly limit.
        """
        total_tokens_call = input_tokens + output_tokens
        current_month = datetime.datetime.now(datetime.UTC).month
        month_key = self._get_current_month_key()

        if self._redis_client:
            try:
                cost_key = f"{month_key}:cost"
                tokens_key = f"{month_key}:tokens"

                current_cost = float(self._redis_client.get(cost_key) or 0.0)
                current_tokens = int(self._redis_client.get(tokens_key) or 0)
                self._assert_within_budget(
                    current_cost,
                    current_tokens,
                    total_tokens_call,
                    estimated_cost,
                )

                pipe = self._redis_client.pipeline()
                pipe.incrbyfloat(cost_key, estimated_cost)
                pipe.incrby(tokens_key, total_tokens_call)
                pipe.expire(cost_key, 60 * 24 * 60 * 60)
                pipe.expire(tokens_key, 60 * 24 * 60 * 60)
                pipe.execute()
                return
            except BudgetExceeded:
                raise
            except Exception as exc:
                logger.warning(
                    "Redis operation failed during budget tracking. Falling back to in-memory.",
                    exc_info=exc,
                )

        with self._lock:
            self._reset_in_memory_if_needed(current_month)
            self._assert_within_budget(
                float(self._in_memory_store["cost"]),
                int(self._in_memory_store["tokens"]),
                total_tokens_call,
                estimated_cost,
            )
            self._in_memory_store["cost"] += estimated_cost
            self._in_memory_store["tokens"] += total_tokens_call

    def _reset_in_memory_if_needed(self, current_month: int) -> None:
        """Reset process-local counters when the UTC month changes."""
        if self._in_memory_store["month"] != current_month:
            self._in_memory_store = {
                "month": current_month,
                "cost": 0.0,
                "tokens": 0,
            }

    def _assert_within_budget(
        self,
        current_cost: float,
        current_tokens: int,
        call_tokens: int,
        call_cost: float,
    ) -> None:
        """Raise when adding one call would cross token or cost limits."""
        if current_cost + call_cost > self.monthly_budget_usd:
            raise BudgetExceeded("Monthly USD budget exceeded.")
        if current_tokens + call_tokens > self.monthly_token_cap:
            raise BudgetExceeded("Monthly token cap exceeded.")
