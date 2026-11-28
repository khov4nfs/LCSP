"""Synthetic cross-border transfer module for benchmark repo-07."""


def transfer_to_region(payload: dict[str, str], region: str) -> dict[str, str]:
    """Transfer payload with explicit transfer-impact flag."""
    return {"region": region, "tia_verified": "true", "size": str(len(payload))}
