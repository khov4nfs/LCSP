"""Bounded, sanitized diagnostic envelope for every rejected Rule Authoring mutation.

Runtime evidence only: tool name, which of the two rejection layers refused the call, the invalid field paths and a
sanitized copy of the arguments. Never credentials, prompts or chain-of-thought. Free text is reduced to a length, a
hash and a short head, so a rejected call stays diagnosable without storing an unbounded or sensitive body.

LAYER A  TOOL_SCHEMA              the tool-argument contract refused the call; the mutation body never ran.
LAYER B  AUTHORING_PRECONDITION   the body ran and refused a semantic precondition before touching the draft.
(Layer C, the real Rule validator, is a different event kind and never appears here.)
"""
from __future__ import annotations

import hashlib
import json
import re
from contextvars import ContextVar
from typing import Any

TOOL_SCHEMA = "TOOL_SCHEMA"
AUTHORING_PRECONDITION = "AUTHORING_PRECONDITION"
# Where a TOOL_SCHEMA rejection was produced. The first is the tool's own pre-body check; the others are framework layers
# that run before any tool body and would otherwise leave no LCSP trace at all.
SOURCE_PREFLIGHT = "TOOL_PREFLIGHT"
SOURCE_BODY = "TOOL_BODY"
SOURCE_UNKNOWN_TOOL = "FRAMEWORK_UNKNOWN_TOOL"
SOURCE_UNPARSEABLE = "FRAMEWORK_UNPARSEABLE_ARGUMENTS"
SOURCE_FRAMEWORK_ERROR = "FRAMEWORK_TOOL_ERROR"

# The id of the model tool call being executed. Set by the tool-call recorder around the tool, read by the tool wrapper, so a
# rejection can name the exact call even when several tool calls run in parallel threads.
CURRENT_TOOL_CALL_ID: ContextVar[str | None] = ContextVar("lcsp_current_tool_call_id", default=None)

MAX_LIST_ITEMS = 12
MAX_TEXT_HEAD = 48
MAX_ITEM_CHARS = 72
MAX_ARGS_CHARS = 1800
MAX_FIELD_PATHS = 8
CLAIM_ID = re.compile(r"^[0-9a-f]{64}$")

# Canonical, deterministic repair instructions. One instruction per cause so an identical mistake always gets identical
# wording (no-progress detection relies on that), and so the instruction is actionable without the model's old context.
REPAIR = {
    "MISSING_ARGUMENT": "Call the tool again with every required argument present; the missing one is listed under invalid fields.",
    "WRONG_TYPE": "Resend the argument with the type the tool contract declares (a list of strings for *_claim_ids, a string for text).",
    "UNKNOWN_ARGUMENT": "Remove the argument the contract does not define and resend the call.",
    "INVALID_ENUM": "Use one of the enum values listed in the tool contract.",
    "EMPTY_REQUIRED_LIST": "Provide at least one ID in the listed argument.",
    "DUPLICATE_ITEMS": "List each ID once; remove the duplicate entries and resend.",
    "DUPLICATE_REQUIREMENT": "That operative claim is already bound by another Requirement (named in the detail). Keep it: author the same requirement_key again to change it, or remove_rule_candidate it first. An operative claim anchors one Requirement.",
    "INVALID_ID": "An id may use only ASCII letters, digits and . _ : - and must start with a letter or digit (no spaces or accented letters); choose a new id and resend.",
    "INVALID_VALUE": "A value violates the declared length or count limit; shorten it and resend.",
    "UNKNOWN_CLAIM": "Copy exact claim IDs from get_rule_authoring_context or get_claim_inventory; the candidates shown are real IDs of the right role.",
    "ROLE_MISMATCH": "Move the claim to the argument that matches its accounting role (expectedField). Role follows claim type and is not negotiable.",
    "NON_RELEVANT_CLAIM": "That claim is intentionally non-operative and outside the accounting denominator; choose a relevant claim.",
    "OPERATIVE_REQUIRED": "Add at least one DUTY, PROHIBITION or PERMISSION claim to operative_claim_ids.",
    "APPLICABILITY_REQUIRED": "Add the SCOPE/CONDITION claim that states the addressee and trigger to applicability_claim_ids, or reopen the inventory if none exists.",
    "UNKNOWN_REQUIREMENT": "Use the exact legalRequirementId of an existing assessable Requirement; the candidates shown are the real ones.",
    "UNKNOWN_CANDIDATE": "Use the exact id of an existing candidate of that kind; the candidates shown are the real ones.",
    "ROW_INVALID": "The selected claim cannot form a valid Requirement row as selected; change the claim named in suppliedClaimId or select a more complete claim.",
    "UNPARSEABLE_ARGUMENTS": "Your last tool call was not valid JSON and was not executed. Send it again as a complete JSON object.",
    "INCOMPATIBLE_AGGREGATION": "One Requirement may bind only operative claims with the same actor, modality, assessability and the same applicability, qualifier and exception claims. Author a separate Requirement for each claim that differs (the safe default is one operative claim per Requirement).",
    "UNKNOWN_TOOL": "That tool does not exist. Use one of the tool names from your tool list.",
    "FRAMEWORK_ERROR": "The tool call was refused before the tool ran; fix the argument named in the error and resend it.",
}


def canonical(value: Any) -> str:
    """Business purpose: Serialize rejected-call arguments into a stable representation for fingerprints.

    Business rules:
    - JSON keys are sorted, Unicode is preserved and compact separators make equivalent mappings hash consistently.

    Execution flow:
    1. Encode the supplied value as deterministic JSON, using `str` for otherwise unsupported values.
    2. Return the canonical string.

    Failure cases:
    - JSON serialization errors not covered by the fallback propagate to the caller.

    Side effects:
    - None: pure serialization without logging or persistence.
    """
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)


def args_fingerprint(args: Any) -> str:
    """Business purpose: Give an argument set a bounded stable identity for duplicate-rejection tracking.

    Business rules:
    - Fingerprints are SHA-256 over canonical arguments and are shortened to 32 hexadecimal characters; raw argument content is not returned.

    Execution flow:
    1. Canonicalize the arguments.
    2. Hash the encoded value and return its 32-character prefix.

    Failure cases:
    - Canonical serialization errors propagate; the function does not substitute an unrelated identity.

    Side effects:
    - None: pure hashing; no arguments or credentials are persisted here.
    """
    return hashlib.sha256(canonical(args).encode()).hexdigest()[:32]


# Anything shaped like a credential or a long opaque token is replaced before a free-text excerpt can reach a durable event.
SECRET = re.compile(r"(sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|Bearer\s+\S+|(?:key|token|secret|password)\s*[=:]\s*\S+|[A-Za-z0-9+/_=-]{40,})", re.IGNORECASE)


def redact(value: str) -> str:
    """Business purpose: Remove credential-like values before free text enters a durable rejection envelope.

    Business rules:
    - Secret-shaped strings are replaced while valid 64-character claim IDs are retained for evidence traceability.

    Execution flow:
    1. Scan the supplied text for configured credential and opaque-token patterns.
    2. Replace each sensitive match and return the sanitized text.

    Failure cases:
    - A non-string input violates the function contract and is not coerced.

    Side effects:
    - None: returns sanitized text in memory; it does not log or store the original.
    """
    return SECRET.sub(lambda m: m.group(0) if CLAIM_ID.match(m.group(0)) else "[redacted]", value)


def _text(value: str) -> Any:
    """Business purpose: Represent free-text arguments with bounded, redacted diagnostics while retaining exact claim identities.

    Business rules:
    - Claim IDs remain intact; all other text is represented by character length, a stable hash and a redacted short head.

    Execution flow:
    1. Preserve a valid claim ID directly.
    2. Hash other text and compute its whitespace-normalized, redacted head.
    3. Return the bounded diagnostic object.

    Failure cases:
    - Hash encoding errors propagate; text is not stored verbatim as a fallback.

    Side effects:
    - None: computes a diagnostic projection without persistence.
    """
    if CLAIM_ID.match(value):
        return value
    digest = hashlib.sha256(value.encode()).hexdigest()[:12]
    return {"len": len(value), "sha256": digest, "head": redact(" ".join(value.split()))[:MAX_TEXT_HEAD]}


def _item(value: Any) -> Any:
    """Business purpose: Bound one argument value before it is included in rejection diagnostics.

    Business rules:
    - Safe scalars remain scalar; strings are redacted and capped except exact claim IDs, while complex values are represented by type only.

    Execution flow:
    1. Classify the supplied value.
    2. Sanitize or summarize it according to its scalar type and length.
    3. Return the bounded item projection.

    Failure cases:
    - Unsupported values are reduced to their type instead of serialized as potentially sensitive content.

    Side effects:
    - None: formats one in-memory diagnostic value.
    """
    if isinstance(value, str):
        value = redact(value)
        return value if CLAIM_ID.match(value) or len(value) <= MAX_ITEM_CHARS else value[:MAX_ITEM_CHARS] + "…"
    if isinstance(value, (bool, int, float)) or value is None:
        return value
    return {"type": type(value).__name__}


def sanitize_args(args: Any) -> Any:
    """Keys, types and IDs survive; free text becomes length/hash/head; lists are capped. Bounded in total size.

    Business purpose: Retain enough argument shape to repair a rejected tool call without persisting an unbounded or sensitive payload.

    Business rules:
    - At most 24 sorted keys and 12 list items are retained; free text is redacted/summarized and the complete projection stays under MAX_ARGS_CHARS or falls back to key names.

    Execution flow:
    1. Reject non-object inputs to a type marker.
    2. Sanitize sorted keys and each value by type, preserving IDs needed for correction.
    3. Return the projection if it fits the bound, otherwise return only bounded argument keys.

    Failure cases:
    - Unexpected value shapes are represented by type; no raw arbitrary object is emitted.

    Side effects:
    - None: creates a bounded diagnostic projection without writing an event.
    """
    if not isinstance(args, dict):
        return {"type": type(args).__name__}
    out: dict[str, Any] = {}
    for key in sorted(args)[:24]:
        value = args[key]
        safe_key = redact(str(key))[:64]
        if isinstance(value, str):
            out[safe_key] = _item(value) if len(value) <= MAX_ITEM_CHARS and (CLAIM_ID.match(value) or key.endswith(("_id", "_key", "kind"))) else _text(value)
        elif isinstance(value, list):
            out[safe_key] = {"count": len(value), "items": [_item(v) for v in value[:MAX_LIST_ITEMS]]}
        else:
            out[safe_key] = _item(value)
    return out if len(json.dumps(out)) <= MAX_ARGS_CHARS else {"argumentCount": len(args), "argumentKeys": [redact(str(k))[:64] for k in sorted(args)[:MAX_LIST_ITEMS]]}


def field_paths_of(errors: list[Any]) -> list[str]:
    """Argument paths named by jsonschema errors; a missing required property is the property itself.

    Business purpose: Identify the exact argument fields rejected by JSON Schema for actionable tool repair.

    Business rules:
    - Required and additional-property failures name the absent/unknown property; all output paths are deduplicated, sorted and capped at MAX_FIELD_PATHS.

    Execution flow:
    1. Convert each validator error's absolute path into a field path.
    2. Expand missing required and undeclared property names where schema metadata permits.
    3. Return the bounded unique paths.

    Failure cases:
    - Errors without a field path use `<root>`; malformed error objects may propagate their attribute/type failure.

    Side effects:
    - None: derives diagnostic paths without changing schema or arguments.
    """
    found: list[str] = []
    for error in errors:
        path = [str(p) for p in error.absolute_path]
        if error.validator == "required" and isinstance(error.instance, dict):
            found.extend(".".join([*path, str(name)]) for name in error.validator_value if name not in error.instance)
        elif error.validator == "additionalProperties" and isinstance(error.instance, dict):
            allowed = set((error.schema or {}).get("properties", {}))
            found.extend(".".join([*path, str(name)]) for name in sorted(error.instance) if name not in allowed)
        else:
            found.append(".".join(path) or "<root>")
    return sorted(dict.fromkeys(found))[:MAX_FIELD_PATHS]


def classify_schema_error(error: Any) -> str:
    """Business purpose: Map a JSON Schema validator failure to the stable authoring repair category.

    Business rules:
    - Known schema keywords use their fixed rejection codes; every other validator kind maps to WRONG_TYPE.

    Execution flow:
    1. Read the validator keyword.
    2. Return its mapped repair code or the default code.

    Failure cases:
        - An unrecognized validator keyword remains repairable as WRONG_TYPE rather than disappearing from the ledger.

    Side effects:
    - None: pure code mapping.
    """
    return {"required": "MISSING_ARGUMENT", "type": "WRONG_TYPE", "additionalProperties": "UNKNOWN_ARGUMENT", "enum": "INVALID_ENUM", "minItems": "EMPTY_REQUIRED_LIST",
            "uniqueItems": "DUPLICATE_ITEMS", "minLength": "INVALID_VALUE", "maxLength": "INVALID_VALUE", "maxItems": "INVALID_VALUE", "pattern": "INVALID_ID"}.get(error.validator, "WRONG_TYPE")


def draft_fingerprint(draft: dict) -> str:
    """Identity of the authored Requirement/AssessmentRule candidates; frozen claims are not part of it.

    Business purpose: Identify the current Requirement and AssessmentRule candidate set for rejection provenance.

    Business rules:
    - Only `legalRequirements` and `assessmentRules` participate; frozen claims and other draft sections are deliberately excluded.

    Execution flow:
    1. Build the two-section candidate projection.
    2. Canonically serialize and SHA-256 hash it.
    3. Return the shortened hexadecimal fingerprint.

    Failure cases:
    - Missing required section keys or serialization failures propagate; this helper hashes section values without validating their types.

    Side effects:
    - None: pure candidate identity calculation.
    """
    return hashlib.sha256(canonical({"legalRequirements": draft["legalRequirements"], "assessmentRules": draft["assessmentRules"]}).encode()).hexdigest()[:32]


def build_envelope(*, tool: str, layer: str, source: str, code: str, args: Any, ref: str | None, detail: str | None, field_paths: list[str],
                   required_action: str | None, repair_key: str, inventory: dict, draft_before: str, draft_after: str,
                   draft_revision: int, sequence: int, model_turn: int | None, phase: str, tool_call_id: str | None = None,
                   extra: dict | None = None) -> dict:
    """Business purpose: Assemble one audit-ready, repairable record for a rejected Rule Authoring call.

    Business rules:
    - Rejection layer/source, stable code, pinned inventory revision/fingerprint, draft revision/fingerprints and call ordering stay explicit.
    - Arguments, free text, paths and extra string values pass through bounded sanitization; the envelope records whether the draft stayed unchanged.

    Execution flow:
    1. Redact identifiers and details and sanitize arguments and field paths.
    2. Capture inventory, draft, model-turn and phase provenance with the deterministic repair instruction.
    3. Add only supplied non-null extra fields and return the envelope.

    Failure cases:
    - Missing required envelope inputs or fingerprinting errors propagate; no success record is substituted.

    Side effects:
    - None directly: returns an envelope for the caller's ledger to persist.
    """
    envelope = {
        "sequence": sequence, "modelTurn": model_turn, "phase": phase, "toolName": redact(tool), "toolCallId": tool_call_id,
        "rejectionLayer": layer, "rejectionSource": source, "rejectionCode": code, "fieldPaths": [redact(p) for p in field_paths[:MAX_FIELD_PATHS]],
        "ref": redact(ref) if ref else ref, "detail": redact(detail or "")[:240] or None, "requiredAction": required_action, "repair": REPAIR.get(repair_key), "repairKey": repair_key,
        "argsFingerprint": args_fingerprint(args), "sanitizedArgs": sanitize_args(args),
        "inventoryRevision": inventory.get("revision"), "inventoryFingerprint": inventory.get("fingerprint"),
        "draftRevisionBefore": draft_revision, "draftRevisionAfter": draft_revision,
        "draftFingerprintBefore": draft_before, "draftFingerprintAfter": draft_after, "draftUnchanged": draft_before == draft_after,
        "resolved": False,
    }
    if extra:
        envelope.update({k: redact(v) if isinstance(v, str) else v for k, v in extra.items() if v is not None})
    return envelope
