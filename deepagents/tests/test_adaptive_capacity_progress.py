"""Regression coverage for CI load progress versus admission-induced elapsed time."""
import pytest

from vertical.adaptive_capacity_progress import LoadProgressWatchdog


def test_progressing_wave_can_exceed_the_old_total_time_cutoff():
    now = [0.0]
    watchdog = LoadProgressWatchdog(8, clock=lambda: now[0])
    # Model time, durable broker deferral and temporary checkpoint pressure can
    # legitimately stretch the wave beyond 150s while new work keeps finishing.
    for at, started, completed in [
        (20, 1, 0), (65, 3, 1), (110, 5, 3),
        (155, 7, 5), (200, 8, 7), (245, 8, 8),
    ]:
        now[0] = at
        watchdog.observe(started_roots=started, completed_roots=completed)


@pytest.mark.parametrize("started,completed", [(0, 0), (1, 0), (8, 7)])
def test_stuck_or_not_yet_admitted_wave_still_fails(started, completed):
    now = [0.0]
    watchdog = LoadProgressWatchdog(8, clock=lambda: now[0])
    watchdog.observe(started_roots=started, completed_roots=completed)
    now[0] = 149.9
    watchdog.observe(started_roots=started, completed_roots=completed)
    now[0] = 150.0
    with pytest.raises(AssertionError, match=r"load scenario 8 did not progress.*inactivityBudgetSeconds=150"):
        watchdog.observe(started_roots=started, completed_roots=completed)


def test_repeated_or_regressed_counts_cannot_renew_the_watchdog():
    now = [0.0]
    watchdog = LoadProgressWatchdog(8, clock=lambda: now[0])
    watchdog.observe(started_roots=3, completed_roots=2)
    now[0] = 100
    watchdog.observe(started_roots=2, completed_roots=1)
    now[0] = 149
    watchdog.observe(started_roots=3, completed_roots=2)
    now[0] = 150
    with pytest.raises(AssertionError):
        watchdog.observe(started_roots=3, completed_roots=2)


@pytest.mark.parametrize("started,completed", [(2, 0), (1, 1)])
def test_start_or_completion_independently_renews_inactivity_budget(started, completed):
    now = [0.0]
    watchdog = LoadProgressWatchdog(8, clock=lambda: now[0])
    watchdog.observe(started_roots=1, completed_roots=0)
    now[0] = 100
    watchdog.observe(started_roots=started, completed_roots=completed)
    now[0] = 249.9
    watchdog.observe(started_roots=started, completed_roots=completed)
    now[0] = 250
    with pytest.raises(AssertionError):
        watchdog.observe(started_roots=started, completed_roots=completed)
