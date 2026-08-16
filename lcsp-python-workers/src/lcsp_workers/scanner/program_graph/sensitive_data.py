"""Semantic classification for personal/sensitive data and secrets without retaining values."""
from __future__ import annotations
import re
from urllib.parse import urlparse

IDENTIFIER_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("PII.GOVERNMENT_ID", ("cccd", "cmnd", "government_id", "national_id", "identity_number")),
    ("PII.EMAIL", ("email", "e_mail")), ("PII.PHONE", ("phone", "mobile", "telephone")),
    ("PII.ADDRESS", ("address", "street_address", "home_address")),
    ("PII.DATE_OF_BIRTH", ("date_of_birth", "birth_date", "dob")),
    ("PII.PASSPORT", ("passport",)), ("PII.TAX_ID", ("tax_id", "tax_code")),
    ("SENSITIVE.PAYMENT_CARD", ("card_number", "credit_card", "payment_card", "cvv")),
    ("SENSITIVE.FINANCIAL_ACCOUNT", ("bank_account", "account_number", "iban", "salary", "income")),
    ("SENSITIVE.HEALTH", ("health", "medical", "diagnosis", "patient", "disease")),
    ("SENSITIVE.BIOMETRIC", ("biometric", "fingerprint", "faceprint", "voiceprint")),
    ("SENSITIVE.PRECISE_LOCATION", ("gps", "latitude", "longitude", "precise_location")),
    ("PII.CONTACT_INFO", ("contact", "contact_info")),
)
SECRET_HINTS = ("api_key", "apikey", "access_token", "refresh_token", "password", "private_key", "client_secret", "session_secret", "credential")
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PHONE_RE = re.compile(r"^\+?[0-9][0-9 .()-]{7,20}$")
CARD_RE = re.compile(r"^(?:[0-9][ -]?){13,19}$")
SECRET_RE = re.compile(r"(?:sk-[A-Za-z0-9_-]{12,}|gh[porsu]_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})")

def semantic_types_for_identifier(name: str) -> tuple[str, ...]:
    value = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    found = [category for category, hints in IDENTIFIER_RULES if any(hint in value for hint in hints)]
    if any(hint in value for hint in SECRET_HINTS): found.append("SECRET")
    return tuple(sorted(set(found)))

def safe_literal_metadata(value: str) -> dict[str, object] | None:
    if SECRET_RE.search(value): return {"literalType": "SECRET", "redacted": True}
    if EMAIL_RE.match(value): return {"literalType": "PII.EMAIL", "redacted": True}
    if CARD_RE.match(value.replace(" ", "").replace("-", "")): return {"literalType": "SENSITIVE.PAYMENT_CARD", "redacted": True}
    if PHONE_RE.match(value): return {"literalType": "PII.PHONE", "redacted": True}
    return None

def safe_external_host(value: str) -> str | None:
    try:
        parsed = urlparse(value if "://" in value else f"https://{value}")
    except ValueError:
        return None
    host = (parsed.hostname or "").lower().strip(".")
    return host if host and "." in host else None
