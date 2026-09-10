#!/usr/bin/env python3
"""Export triage-produced EngineeringRules into the governed precompiled bundle.

The Legal Rule Triage subagent owns the Candidate -> EngineeringRule reasoning. Every
successful persistence already writes an `engineering-rules` recovery artifact. This
script replays those artifacts into the bundle that PrecompiledEngineeringRuleRegistry
reads, so a cleared Chroma cache recovers deterministically without calling an LLM.

Grounding hashes are re-resolved from the active corpus and the resulting fingerprint is
compared against the artifact, so an export can never silently bind rules to legal text
that has changed since triage ran.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "deepagents"))

from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.platform.config import load_config
from tools.legal.corpus.engineering_rules.orchestration.service import (
    EngineeringRuleService,
)
from tools.legal.corpus.engineering_rules.registry.precompiled_export import (
    build_bundle,
    build_no_rule_entry,
    build_template,
)
from tools.legal.retrieval.legal_basis.chromadb_citation_retriever import (
    ChromaDbCitationRetriever,
)
from tools.legal.sources.recovery.artifact_store import recovery_artifact_root


ARTIFACT_CATEGORY = "engineering-rules"
TRIAGE_ARTIFACT_CATEGORY = "legal-rule-triage"


def load_artifacts(root: Path, category: str) -> list[dict[str, Any]]:
    """Read the content-addressed artifact payloads for one category.

    Artifacts are stored inside a `{schemaVersion, category, writtenAt, payload}`
    envelope, and `latest.json` is a duplicate of the most recent write, so exporting it
    too would emit the same rule twice.
    """
    directory = root / category
    if not directory.is_dir():
        return []
    artifacts = []
    for path in sorted(directory.glob("*.json")):
        if path.name == "latest.json":
            continue
        envelope = json.loads(path.read_text(encoding="utf-8"))
        payload = envelope.get("payload")
        if not isinstance(payload, dict):
            raise SystemExit(f"recovery artifact has no payload object: {path}")
        artifacts.append(payload)
    return artifacts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, help="Bundle output path")
    parser.add_argument("--bundle-id", required=True)
    parser.add_argument(
        "--legal-rule-id",
        action="append",
        default=[],
        help="Restrict the export to these LegalRule IDs (repeatable)",
    )
    parser.add_argument(
        "--compiler-model",
        default="legal-rule-triage-subagent",
        help="Recorded provenance for the reasoning that produced these rules",
    )
    args = parser.parse_args()

    config = load_config()
    api = WorkerApiClient(config.nestjs_api_base_url, config.worker_api_key)
    corpus = api.get_active_legal_corpus()
    corpus_version_id = str(
        corpus.get("versionId") or corpus.get("corpusVersionId") or corpus.get("id") or ""
    )
    if not corpus_version_id:
        raise SystemExit("active legal corpus has no version id")

    chunks = (api.get_legal_corpus_chunks(corpus_version_id) or {}).get("chunks") or []
    retriever = ChromaDbCitationRetriever()
    retriever.index_corpus(
        corpus_version_id,
        [chunk for chunk in chunks if isinstance(chunk, dict)],
    )
    service = EngineeringRuleService(retriever=retriever)

    catalog_rules = {
        str(rule.get("legalRuleId")): rule
        for rule in (api.get_active_legal_rule_catalog().get("rules") or [])
        if isinstance(rule, dict) and rule.get("legalRuleId")
    }

    wanted = {value for value in args.legal_rule_id if value}
    skipped: list[str] = []

    def grounded_context(legal_rule, artifact, legal_rule_id):
        """Resolve current grounding, or record why this artifact cannot be exported."""
        if str(artifact.get("legalCorpusVersionId") or "") != corpus_version_id:
            skipped.append(f"{legal_rule_id}: artifact targets a superseded corpus")
            return None
        context, fingerprint = service.resolve_source_identity(
            legal_rule=legal_rule,
            legal_corpus_version_id=corpus_version_id,
        )
        if fingerprint != str(artifact.get("sourceFingerprint") or ""):
            skipped.append(f"{legal_rule_id}: legal source changed since triage ran")
            return None
        return {
            str(item["id"]): str(item.get("contentSha256") or "")
            for item in context
            if item.get("id")
        }

    templates: list[dict[str, Any]] = []
    for artifact in load_artifacts(recovery_artifact_root(), ARTIFACT_CATEGORY):
        legal_rule_id = str(artifact.get("legalRuleId") or "")
        if wanted and legal_rule_id not in wanted:
            continue
        grounding_hashes = grounded_context(
            artifact["legalRule"], artifact, legal_rule_id
        )
        if grounding_hashes is None:
            continue
        for engineering_rule in artifact.get("engineeringRules") or []:
            templates.append(
                build_template(
                    engineering_rule,
                    legal_rule_id=legal_rule_id,
                    grounding_hashes=grounding_hashes,
                )
            )

    # A LegalRule triaged to no candidates is a finished decision. Exporting it keeps a
    # cleared cache from treating every context-only rule as unprepared work again.
    no_rule_entries: list[dict[str, Any]] = []
    for artifact in load_artifacts(recovery_artifact_root(), TRIAGE_ARTIFACT_CATEGORY):
        legal_rule_id = str(artifact.get("legalRuleId") or "")
        if wanted and legal_rule_id not in wanted:
            continue
        if artifact.get("candidateChunkIds"):
            continue
        legal_rule = catalog_rules.get(legal_rule_id)
        if legal_rule is None:
            skipped.append(f"{legal_rule_id}: no longer in the active catalog")
            continue
        grounding_hashes = grounded_context(legal_rule, artifact, legal_rule_id)
        if grounding_hashes is None:
            continue
        no_rule_entries.append(
            build_no_rule_entry(
                legal_rule_id=legal_rule_id,
                grounding_hashes=grounding_hashes,
            )
        )

    if not templates and not no_rule_entries:
        raise SystemExit("no exportable triage decisions; run the warm-up first")

    bundle = build_bundle(
        templates,
        bundle_id=args.bundle_id,
        compiler_model=args.compiler_model,
        no_rule_entries=no_rule_entries,
    )
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(bundle, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    print(
        json.dumps(
            {
                "bundle": str(out_path),
                "templateCount": len(templates),
                "noRuleDecisionCount": len(no_rule_entries),
                "legalRuleCount": len({item["legalRuleId"] for item in templates}),
                "skipped": skipped,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
