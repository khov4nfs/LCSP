from __future__ import annotations


import pytest

from tools.common.capabilities.platform.graph_runtime import (
    checkpoint_database_url,
)


def test_checkpoint_database_url_accepts_postgres_and_rejects_other_schemes() -> None:
    assert (
        checkpoint_database_url(" postgresql://user:pass@db/lcsp ")
        == "postgresql://user:pass@db/lcsp"
    )
    assert (
        checkpoint_database_url("postgresql://user:pass@db/lcsp?schema=public")
        == "postgresql://user:pass@db/lcsp"
    )
    assert (
        checkpoint_database_url(
            "postgresql://user:pass@db/lcsp?sslmode=prefer&schema=public"
        )
        == "postgresql://user:pass@db/lcsp?sslmode=prefer"
    )
    assert checkpoint_database_url(None) is None
    assert checkpoint_database_url("") is None

    with pytest.raises(ValueError):
        checkpoint_database_url("sqlite:///tmp/checkpoints.db")
