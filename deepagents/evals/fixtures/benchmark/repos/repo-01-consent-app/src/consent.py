"""Synthetic consent & notice handler for benchmark repo-01."""


def collect_user_consent(user_id: str, purpose: str, opt_in: bool) -> dict[str, str]:
    """Record explicit opt-in consent before processing personal data."""
    if not opt_in or not purpose:
        raise ValueError("Explicit opt-in and purpose are required")
    return {"user_id": user_id, "purpose": purpose, "status": "CONSENT_GRANTED"}
