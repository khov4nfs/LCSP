"""Focused regression for the synthetic release fixture's canonical-data proof."""

import importlib.util
from pathlib import Path


SCRIPT = Path(__file__).with_name("retired-authority-migration-check.py")
SPEC = importlib.util.spec_from_file_location("retired_authority_migration_check", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class FixtureConnection:
    """Return one usage row among otherwise empty canonical fixture tables."""

    def __init__(self, usage):
        self.usage = usage
        self.calls = 0

    def execute(self, _query, _params=None):
        self.calls += 1
        return [{"row": self.usage.copy()}] if self.calls == 5 else []


def test_added_nullable_usage_columns_do_not_change_canonical_fixture_digest():
    """A schema-only migration must not be reported as a canonical data mutation."""
    original = {"id": "release-usage", "model": "synthetic"}
    post_deploy = original | {
        name: None
        for name in (
            "attemptStatus", "failureClass", "referenceCostSnapshot",
            "inputTokensIncludingCache", "cacheWrite5mTokens", "cacheWrite1hTokens",
            "visibleOutputTokens", "admissionId", "appliedMaxOutputTokens",
            "attemptOrdinal", "chargedMicrocredits", "durationMs", "finishReason",
            "logicalOperationId", "modelStep", "operationType", "pricingResolution",
            "protocol", "providerCompletionState",
        )
    }
    state = {"live": "live", "other": "other"}
    before = MODULE.preserved_database(FixtureConnection(original), state)
    after = MODULE.preserved_database(FixtureConnection(post_deploy), state, renamed=True)
    assert before == after
    # A populated post-deploy billing value remains a real canonical-data change.
    changed = post_deploy | {"chargedMicrocredits": 1}
    assert MODULE.preserved_database(FixtureConnection(changed), state, renamed=True) != before
