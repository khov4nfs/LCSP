"""Bound a load fixture's inactivity without treating admission backpressure as deadlock."""
from __future__ import annotations

import time
from collections.abc import Callable


class LoadProgressWatchdog:
    """Only monotonic execution/completion counts constitute forward progress.

    The caller retains a separate whole-process deadline. Capacity changes, queue
    movement and repeated observations cannot keep a stuck scenario alive.
    """

    def __init__(
        self,
        scenario: int,
        *,
        timeout_seconds: float = 150,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.scenario = scenario
        self.timeout_seconds = timeout_seconds
        self.clock = clock
        self.last_progress_at = clock()
        self.started_roots = 0
        self.completed_roots = 0

    def observe(self, *, started_roots: int, completed_roots: int) -> None:
        """Reset inactivity only when another Root starts or completes; otherwise fail boundedly."""
        now = self.clock()
        if started_roots > self.started_roots or completed_roots > self.completed_roots:
            self.last_progress_at = now
        self.started_roots = max(self.started_roots, started_roots)
        self.completed_roots = max(self.completed_roots, completed_roots)
        stalled_seconds = now - self.last_progress_at
        assert stalled_seconds < self.timeout_seconds, (
            f"load scenario {self.scenario} did not progress for {stalled_seconds:.1f}s "
            f"(started={self.started_roots}, completed={self.completed_roots}, "
            f"inactivityBudgetSeconds={self.timeout_seconds})"
        )
