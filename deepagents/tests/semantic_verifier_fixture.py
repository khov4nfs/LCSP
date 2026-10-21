"""Scripted model wire data for runtime tests, never source-law acceptance."""


def slots(prefix, rows):
    """Keyed-slot form of a one-row-per-item section: runtime slot keys (claim_1, relation_2, ...) in sorted-identity order."""
    return {f"{prefix}_{index}": row for index, row in enumerate(rows, 1)}


def model_response(canonical, source_reading=None, value=None):
    """Native keyed-slot answer for canonical assertion/relation verdict rows (identities are runtime-owned, never answered)."""
    sections = [key for key in ["assertions", "relations"] if key in canonical]
    if not sections:
        return {"gaps": canonical["gaps"]}
    claims_by_id = {c["claimId"]: c for c in value.get("claims", [])} if value else {}
    result = {section: [{"id": row["id"], "checks": dict(row["checks"])} for row in sorted(canonical[section], key=lambda r: r["id"])] for section in sections}
    for row in result.get("assertions", []):
        claim = claims_by_id.get(row["id"])
        if claim is not None and source_reading is None:
            mod = claim.get("operative", {}).get("modality", "NON_OPERATIVE") if claim.get("operative") else "NON_OPERATIVE"
            if row["checks"].get("modality") == "WRONG_MODALITY":
                mod = "PERMISSION" if mod == "DUTY" else "DUTY"
            auth = claim.get("semanticAuthority", "LEGAL_NORMATIVE")
            if row["checks"].get("semanticAuthority") == "WRONG_SEMANTIC_AUTHORITY":
                auth = "CONTEXT" if auth == "LEGAL_NORMATIVE" else "LEGAL_NORMATIVE"
            ass = claim.get("assessability", "REPOSITORY_VERIFIABLE")
            sr = {"modalOperator": mod, "operatorPolarity": "AFFIRMED", "semanticAuthority": auth, "assessability": ass}
        else:
            sr = dict(source_reading) if source_reading else {"modalOperator": "PERMISSION" if row["checks"]["modality"] == "WRONG_MODALITY" else "DUTY",
                                                               "semanticAuthority": "CONTEXT" if row["checks"]["semanticAuthority"] == "WRONG_SEMANTIC_AUTHORITY" else "LEGAL_NORMATIVE",
                                                               "assessability": "REPOSITORY_VERIFIABLE"}
            sr.setdefault("operatorPolarity", "AFFIRMED")
        row["sourceReading"] = sr
        for dimension in ["modality", "semanticAuthority", "assessability"]:
            row["checks"].pop(dimension)

    originals = {row["id"]: row for row in canonical.get("relations", [])}
    for row in result.get("relations", []):
        original = originals[row["id"]]
        target = row["checks"].pop("target")
        row["targetScopeReading"] = original.get("targetScopeReading", "EXACT_SOURCE_TARGET") if target == "SUPPORTED" else {"code": "UNDETERMINED" if target == "INSUFFICIENT_SUPPORT" else "OUTSIDE_SOURCE_TARGET_SCOPE", "finding": "Scripted factual target repair"}
        if "sourceContentReading" in original or original.get("kind") == "INCORPORATES":
            reading = original.get("sourceContentReading", "ADOPTED_PERFORMANCE")
            row["sourceReading"] = {"targetContentUse": reading}
            row["checks"].pop("kind", None)
    for rows in result.values():
        for row in rows:
            row["checks"] = {dimension: code if code == "SUPPORTED" else {"code": code, "finding": "Scripted factual repair target"} for dimension, code in row["checks"].items()}
    out = {section: ({**slots("claim" if section == "assertions" else "relation", [{k: v for k, v in row.items() if k != "id"} for row in rows])} if rows else [])
           for section, rows in result.items()}
    if "omissions" in canonical:
        out["omissions"] = canonical["omissions"]
    return out
