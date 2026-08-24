"""Governed technical-contract overrides for checked-in precompiled EngineeringRules.

The legal source chunks, LegalRule identities, legal intent, citations, and source hashes
remain owned by the precompiled bundle. This overlay may tighten only the technical
investigation contract used to collect repository evidence. It must never alter legal
applicability, risk tier, or compliance authority.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from tools.common.platform.logging_path import get_repo_root


DEFAULT_PRECOMPILED_CONTRACT_OVERRIDES_PATH = os.path.join(
    get_repo_root(),
    "reports",
    "legal-corpus-ocr",
    "lcsp-precompiled-engineering-rule-contract-overrides-vn-2026-08.json",
)

_ALLOWED_OVERRIDE_FIELDS = frozenset(
    {
        "investigationGoals",
        "startingNodeTypes",
        "targetNodeTypes",
        "edgeStrategies",
        "graphQueries",
        "keywords",
        "commonApis",
        "commonLibraries",
        "patterns",
        "requiredEvidence",
        "supportingEvidence",
        "negativeEvidence",
        "unresolvedConditions",
    }
)
_REQUIRED_OVERRIDE_FIELDS = frozenset({"templateId", "requiredEvidence"})


class PrecompiledContractOverrideError(ValueError):
    """Raised when a governed precompiled contract overlay is malformed."""


def load_precompiled_contract_overrides(
    path: str | None = None,
) -> dict[str, Any]:
    """Load the governed technical-contract overlay from disk."""
    selected = Path(path or DEFAULT_PRECOMPILED_CONTRACT_OVERRIDES_PATH)
    if not selected.is_file():
        raise PrecompiledContractOverrideError(
            "PRECOMPILED_ENGINEERING_RULE_CONTRACT_OVERRIDES_UNAVAILABLE"
        )
    try:
        value = json.loads(selected.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PrecompiledContractOverrideError(
            "PRECOMPILED_ENGINEERING_RULE_CONTRACT_OVERRIDES_INVALID"
        ) from error
    if not isinstance(value, dict):
        raise PrecompiledContractOverrideError(
            "PRECOMPILED_ENGINEERING_RULE_CONTRACT_OVERRIDES_INVALID"
        )
    return value


def apply_precompiled_contract_overrides(
    bundle: dict[str, Any],
    overrides: dict[str, Any],
) -> tuple[list[dict[str, Any]], str]:
    """Return bundle templates with a narrow, deterministic technical overlay applied.

    The overlay is active only when its bundleId exactly matches the bundle. This keeps
    custom/test bundles isolated. For an active overlay, every override template must
    resolve to an existing template and may modify only technical investigation fields.
    """
    templates = [
        dict(item)
        for item in (bundle.get("templates") or [])
        if isinstance(item, dict)
    ]
    bundle_id = str(bundle.get("bundleId") or "")
    override_bundle_id = str(overrides.get("bundleId") or "")
    if not bundle_id or bundle_id != override_bundle_id:
        return templates, "base"

    contract_version = str(overrides.get("contractVersion") or "").strip()
    if not contract_version:
        raise PrecompiledContractOverrideError(
            "PRECOMPILED_ENGINEERING_RULE_CONTRACT_VERSION_REQUIRED"
        )
    rows = overrides.get("templates")
    if not isinstance(rows, list) or not rows:
        raise PrecompiledContractOverrideError(
            "PRECOMPILED_ENGINEERING_RULE_CONTRACT_OVERRIDES_EMPTY"
        )

    by_id = {
        str(item.get("templateId") or ""): index
        for index, item in enumerate(templates)
        if item.get("templateId")
    }
    seen: set[str] = set()
    for raw in rows:
        if not isinstance(raw, dict):
            raise PrecompiledContractOverrideError(
                "PRECOMPILED_ENGINEERING_RULE_CONTRACT_OVERRIDE_INVALID"
            )
        missing_required = _REQUIRED_OVERRIDE_FIELDS - set(raw)
        if missing_required:
            raise PrecompiledContractOverrideError(
                "PRECOMPILED_ENGINEERING_RULE_CONTRACT_OVERRIDE_REQUIRED_FIELDS_MISSING:"
                + ",".join(sorted(missing_required))
            )
        template_id = str(raw.get("templateId") or "").strip()
        if not template_id or template_id in seen:
            raise PrecompiledContractOverrideError(
                "PRECOMPILED_ENGINEERING_RULE_CONTRACT_OVERRIDE_DUPLICATE_TEMPLATE:"
                + template_id
            )
        seen.add(template_id)
        if template_id not in by_id:
            raise PrecompiledContractOverrideError(
                "PRECOMPILED_ENGINEERING_RULE_CONTRACT_OVERRIDE_UNKNOWN_TEMPLATE:"
                + template_id
            )

        illegal_fields = set(raw) - _ALLOWED_OVERRIDE_FIELDS - {"templateId"}
        if illegal_fields:
            raise PrecompiledContractOverrideError(
                "PRECOMPILED_ENGINEERING_RULE_CONTRACT_OVERRIDE_FORBIDDEN_FIELDS:"
                + ",".join(sorted(illegal_fields))
            )

        index = by_id[template_id]
        merged = dict(templates[index])
        for field in _ALLOWED_OVERRIDE_FIELDS:
            if field in raw:
                # Round-trip through JSON so nested graph-query/list structures cannot
                # alias mutable objects from the loaded override document.
                merged[field] = json.loads(
                    json.dumps(raw[field], ensure_ascii=False, sort_keys=True)
                )
        templates[index] = merged

    return templates, contract_version
