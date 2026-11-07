"""Produce exact inventory evidence; a BLOCKED report is not release approval."""
import argparse
from collections import Counter
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from instruction_source_inventory import ROOT, INVENTORY, validate_inventory, translation_readiness
from runtime_instruction_bundle import RuntimeInstructionBundleError


def verification_report():
    """Business purpose: Report exact instruction coverage and remaining runtime-control blockers.

    Business rules:
    - Coverage counts do not establish translation, legal or release acceptance.
    Execution flow:
    1. Validate sources, count dispositions and evaluate strict completion separately.
    Failure cases:
    - Source corruption raises; strict-control failures are returned as visible BLOCKED evidence.
    Side effects:
    - Read source and framework metadata without approving assets.
    """
    payload = validate_inventory()
    sites = payload["constructionSites"]
    decisions = Counter(site["migrationDecision"] for site in sites)
    unresolved = [dict(filePath=site["filePath"], symbolName=site["symbolName"], evidence=site["evidence"])
                  for site in sites if site["migrationDecision"] == "EXPLICITLY_UNRESOLVED"]
    framework = [row for row in payload["frameworkInstructions"] if row["controlStatus"] != "CONTROLLED"]
    try:
        validate_inventory(require_complete=True)
        strict, reason = "PASS", None
    except RuntimeInstructionBundleError as error:
        strict, reason = "BLOCKED", str(error)
    return {
        "DISCOVERED_SITES_TOTAL": len(sites),
        "ORIGINAL_SITES_ACCOUNTED": sum("astKind" not in site for site in sites),
        "NEW_SITES_DISCOVERED": sum("astKind" in site for site in sites),
        "UNIQUE_MAINTAINED_SOURCES": len(payload["entries"]),
        "TOTAL_RUNTIME_CONSUMERS": len({(site["filePath"], site["symbolName"]) for site in sites if site["migrationDecision"] != "NON_MODEL_FACING"}),
        "SHARED_SOURCE_CONSUMER_SITES": decisions["SHARED_SOURCE_CONSUMER"],
        "RUNTIME_DATA_SITES": decisions["RUNTIME_DATA"],
        "NON_MODEL_FACING_SITES": decisions["NON_MODEL_FACING"],
        "THIRD_PARTY_SITES": decisions["THIRD_PARTY_CONTROLLED"],
        "FRAMEWORK_INSTRUCTION_SURFACES": len(payload["frameworkInstructions"]),
        "PENDING_SOURCE_MAPPINGS": decisions["EXPLICITLY_UNRESOLVED"],
        "UNRESOLVED_INSTRUCTION_PATHS": unresolved + framework,
        "MISSING_VI_SOURCES": [],
        "MISSING_EN_CANDIDATES": translation_readiness(payload)["missingEnglishCandidates"],
        "SOURCE_DIGEST_VALIDATION": "PASS", "STRICT_INVENTORY_RESULT": strict,
        "STRICT_INVENTORY_REASON": reason,
        "RUNTIME_CUTOVER": "NOT_RUN", "PRODUCTION_APPROVAL": "BLOCKED",
        "countDefinitions": "Sites are expression/legacy-line records. Consumers are distinct local file+symbol pairs. Framework package surfaces are reported separately, not added to local site totals. Overlapping line/AST records do not count as new unique sources."
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = verification_report()
    text = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(text, encoding="utf-8")
    else:
        sys.stdout.reconfigure(encoding="utf-8")
        print(text)
