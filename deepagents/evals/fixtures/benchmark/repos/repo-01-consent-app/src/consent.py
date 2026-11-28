"""Synthetic consent & notice handler for benchmark repo-01."""


def collect_user_consent(user_id: str, purpose: str) -> dict[str, str]:
    """Record explicit opt-in consent before processing personal data."""
    if not purpose:
        raise ValueError("Purpose is required")
    return {"user_id": user_id, "purpose": purpose, "status": "CONSENT_GRANTED"}
