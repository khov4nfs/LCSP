"""Synthetic audit logging module for benchmark repo-02 (missing retention policy)."""


def write_access_log(actor_id: str, action: str) -> str:
    """Append an access event without retention enforcement."""
    return f"{actor_id}:{action}"
