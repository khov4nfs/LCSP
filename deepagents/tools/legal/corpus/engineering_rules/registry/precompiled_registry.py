"""Lossless deterministic recovery of checked-in precompiled EngineeringRules.

The Chroma EngineeringRule collection is a cache, not an authority source. For the
DEV bootstrap catalog, a fresh/cleared cache must be recoverable from the governed
precompiled bundle as long as the active legal corpus still matches the bundle's
exact grounding hashes and runtime contract.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from tools.common.capabilities.platform.logging_path import get_repo_root

from ..compilation.compiler import COMPILER_VERSION, PROMPT_VERSION
from ..contract.models import (
    ENGINEERING_RULE_SCHEMA_VERSION,
    EngineeringRule,
    build_legal_reasoning_contract,
)
from .precompiled_contract_overrides import (
    DEFAULT_PRECOMPILED_CONTRACT_OVERRIDES_PATH,
    apply_precompiled_contract_overrides,
    load_precompiled_contract_overrides,
)
from ..contract.validator import validate_engineering_rule

DEFAULT_PRECOMPILED_BUNDLE_PATH = os.path.join(
    get_repo_root(),
    "reports",
    "legal-corpus-ocr",
    "lcsp-precompiled-engineering-rules-vn-2026-08.json",
)


class PrecompiledEngineeringRuleRegistry:
    """Materialize precompiled rules against exact current legal provenance."""

    def __init__(
        self,
        bundle_path: str | None = None,
        contract_overrides_path: str | None = None,
    ) -> None:
        configured = os.getenv("ENGINEERING_RULE_PRECOMPILED_BUNDLE_PATH", "").strip()
        self.bundle_path = bundle_path or configured or DEFAULT_PRECOMPILED_BUNDLE_PATH
        configured_overrides = os.getenv(
            "ENGINEERING_RULE_PRECOMPILED_CONTRACT_OVERRIDES_PATH",
            "",
        ).strip()
        self.contract_overrides_path = (
            contract_overrides_path
            or configured_overrides
            or DEFAULT_PRECOMPILED_CONTRACT_OVERRIDES_PATH
        )
        self._bundle: dict[str, Any] | None = None
        self._contract_overrides: dict[str, Any] | None = None

    @property
    def contract_version(self) -> str:
        """Return the active technical-contract version used for cache invalidation."""
        bundle = self._load_bundle("contract-version")
        _, version = self.templates_for_bundle(bundle)
        return version

    def templates_for_bundle(
        self,
        bundle: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], str]:
        """Apply the governed technical overlay without changing legal grounding fields."""
        if self._contract_overrides is None:
            self._contract_overrides = load_precompiled_contract_overrides(
                self.contract_overrides_path
            )
        return apply_precompiled_contract_overrides(
            bundle,
            self._contract_overrides,
        )

    def materialize(
        self,
        *,
        legal_rule: dict[str, Any],
        legal_rule_catalog_version_id: str,
        legal_corpus_version_id: str,
        legal_context: list[dict[str, Any]],
        source_fingerprint: str,
    ) -> list[EngineeringRule]:
        """Rebuild one DEV bootstrap rule without invoking an LLM.

        Recovery is fail-closed. The bundle's schema/compiler/prompt versions must
        equal the running worker contract, every active legal-context chunk must be
        grounded by the selected templates, and every chunk hash must match exactly.
        A governed technical overlay may tighten investigation criteria/retrieval hints,
        but it cannot alter LegalRule identity, legal intent, citations, or source hashes.
        """
        legal_rule_id = str(
            legal_rule.get("legalRuleId")
            or legal_rule.get("legal_rule_id")
            or legal_rule.get("id")
            or "unknown"
        )
        bundle = self._load_bundle(legal_rule_id)
        self._validate_runtime_contract(bundle, legal_rule_id)

        context_by_id = {
            str(item.get("id")): item
            for item in legal_context
            if isinstance(item, dict) and item.get("id")
        }
        context_ids = set(context_by_id)
        templates, _ = self.templates_for_bundle(bundle)
        matched = []
        for template in templates:
            required_ids = {
                str(value)
                for value in (template.get("matchCitationChunkIds") or [])
                if str(value)
            }
            if required_ids and required_ids.issubset(context_ids):
                matched.append(template)

        if not matched:
            raise ValueError(
                f"PRECOMPILED_ENGINEERING_RULE_MISSING:{legal_rule_id}"
            )

        expected_hashes: dict[str, str] = {}
        for template in matched:
            for chunk_id, digest in (
                template.get("groundingContextHashes") or {}
            ).items():
                expected_hashes[str(chunk_id)] = str(digest)

        uncovered = sorted(context_ids - set(expected_hashes))
        if uncovered:
            raise ValueError(
                "PRECOMPILED_ENGINEERING_RULE_CONTEXT_UNCOVERED:"
                f"{legal_rule_id}:{','.join(uncovered)}"
            )

        mismatched = sorted(
            chunk_id
            for chunk_id, item in context_by_id.items()
            if str(item.get("contentSha256") or "")
            != str(expected_hashes.get(chunk_id) or "")
        )
        if mismatched:
            raise ValueError(
                "PRECOMPILED_ENGINEERING_RULE_SOURCE_HASH_MISMATCH:"
                f"{legal_rule_id}:{','.join(mismatched)}"
            )

        source_chunk_ids = tuple(sorted(context_ids))
        source_locators = tuple(
            str(item.get("locator"))
            for item in legal_context
            if item.get("locator")
        )
        result: list[EngineeringRule] = []
        for template in matched:
            template_id = str(template.get("templateId") or "").strip()
            if not template_id:
                raise ValueError(
                    f"PRECOMPILED_ENGINEERING_RULE_INVALID_TEMPLATE:{legal_rule_id}"
                )
            payload = {
                "engineeringRuleId": (
                    f"{legal_rule_id}::PRECOMPILED::{template_id}"
                ),
                "legalRuleId": legal_rule_id,
                "legalRuleCatalogVersionId": legal_rule_catalog_version_id,
                "legalCorpusVersionId": legal_corpus_version_id,
                "concept": template.get("concept"),
                "legalIntent": template.get("legalIntent") or {},
                "investigationGoals": template.get("investigationGoals") or [],
                "startingNodeTypes": template.get("startingNodeTypes") or [],
                "targetNodeTypes": template.get("targetNodeTypes") or [],
                "edgeStrategies": template.get("edgeStrategies") or [],
                "graphQueries": template.get("graphQueries") or [],
                "keywords": template.get("keywords") or [],
                "commonApis": template.get("commonApis") or [],
                "commonLibraries": template.get("commonLibraries") or [],
                "patterns": template.get("patterns") or [],
                "requiredEvidence": template.get("requiredEvidence") or [],
                "supportingEvidence": template.get("supportingEvidence") or [],
                "negativeEvidence": template.get("negativeEvidence") or [],
                "unresolvedConditions": template.get("unresolvedConditions") or [],
                "sourceChunkIds": list(source_chunk_ids),
                "sourceLocators": list(source_locators),
                "legalReasoningContract": build_legal_reasoning_contract(
                    legal_rule=legal_rule,
                    legal_rule_catalog_version_id=legal_rule_catalog_version_id,
                    legal_corpus_version_id=legal_corpus_version_id,
                    legal_context=legal_context,
                    required_evidence=tuple(
                        str(value)
                        for value in template.get("requiredEvidence") or []
                        if str(value)
                    ),
                    supporting_evidence=tuple(
                        str(value)
                        for value in template.get("supportingEvidence") or []
                        if str(value)
                    ),
                    negative_evidence=tuple(
                        str(value)
                        for value in template.get("negativeEvidence") or []
                        if str(value)
                    ),
                ),
                "sourceFingerprint": source_fingerprint,
                "compilerModel": str(bundle.get("compilerModel") or "precompiled"),
                "compilerVersion": COMPILER_VERSION,
                "promptVersion": PROMPT_VERSION,
                "schemaVersion": ENGINEERING_RULE_SCHEMA_VERSION,
            }
            result.append(
                validate_engineering_rule(EngineeringRule.from_dict(payload))
            )

        if not result:
            raise ValueError(
                f"PRECOMPILED_ENGINEERING_RULE_MISSING:{legal_rule_id}"
            )
        return sorted(result, key=lambda item: item.engineering_rule_id)

    def _load_bundle(self, legal_rule_id: str) -> dict[str, Any]:
        if self._bundle is not None:
            return self._bundle
        path = Path(self.bundle_path)
        if not path.is_file():
            raise ValueError(
                "PRECOMPILED_ENGINEERING_RULE_BUNDLE_UNAVAILABLE:"
                f"{legal_rule_id}"
            )
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ValueError(
                "PRECOMPILED_ENGINEERING_RULE_BUNDLE_INVALID:"
                f"{legal_rule_id}"
            ) from error
        if not isinstance(value, dict):
            raise ValueError(
                "PRECOMPILED_ENGINEERING_RULE_BUNDLE_INVALID:"
                f"{legal_rule_id}"
            )
        self._bundle = value
        return value

    @staticmethod
    def _validate_runtime_contract(
        bundle: dict[str, Any],
        legal_rule_id: str,
    ) -> None:
        expected = (
            bundle.get("engineeringRuleSchemaVersion"),
            bundle.get("compilerVersion"),
            bundle.get("promptVersion"),
        )
        current = (
            ENGINEERING_RULE_SCHEMA_VERSION,
            COMPILER_VERSION,
            PROMPT_VERSION,
        )
        if expected != current:
            raise ValueError(
                "PRECOMPILED_ENGINEERING_RULE_CONTRACT_MISMATCH:"
                f"{legal_rule_id}"
            )
