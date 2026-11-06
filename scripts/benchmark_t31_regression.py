#!/usr/bin/env python3
"""Read-only T31 forensic QA over immutable Session JSON and Final Report bytes.

This tool is intentionally not a legal verdict engine: it reports reproducible
invariants and highlights decisions requiring independent source-law review.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path


def audit(session: dict, report: dict) -> dict:
    """Compare persisted final decisions, report narratives and HITL provenance.

    Business purpose:
        Identify reproducible inconsistencies in exported T31 evidence.
    Business rules:
        Compare report references with accepted persisted decisions and flag
        narrative, recommendation and provenance gaps without issuing legal
        verdicts or changing candidate rules.
    Execution flow:
        Index accepted decisions, inspect findings and human-answer history,
        count outcomes and return forensic observations plus review candidates.
    Failure cases:
        Missing or malformed required export fields raise; a completed comparison
        reports its observations rather than certifying semantic acceptance.
    Side effects:
        None; source dictionaries remain unchanged and no services are contacted.
    """
    current = {
        d["assessmentRuleId"]: d
        for d in session["assessmentResults"]["decisions"]
        if d.get("state") == "ACCEPTED"
    }
    findings = report["findings"]
    counts = Counter(
        (f["decision"]["applicability"], f["decision"].get("compliance"))
        for f in findings
    )
    mismatched = [
        f["assessmentRuleId"]
        for f in findings
        if f["decision"]["applicability"] == "APPLICABLE"
        and f["summary"].strip().lower().startswith("not applicable")
    ]
    missing_remediations = [
        f["assessmentRuleId"]
        for f in findings
        if f["decision"]["applicability"] == "APPLICABLE"
        and f["decision"].get("compliance") == "NON_COMPLIANT"
        and not any(x.strip() for x in f["recommendations"])
    ]
    unmatched = [
        f["assessmentRuleId"]
        for f in findings
        if f["assessmentRuleId"] not in current
        or f["decisionId"] != current[f["assessmentRuleId"]]["decisionId"]
        or f["decisionRevision"] != current[f["assessmentRuleId"]]["decisionRevision"]
    ]
    outcomes = {
        "notApplicable": counts[("NOT_APPLICABLE", None)],
        "applicableCompliant": counts[("APPLICABLE", "COMPLIANT")],
        "applicableNonCompliant": counts[("APPLICABLE", "NON_COMPLIANT")],
    }
    evidence = session["executionHistory"]["fileAccessObservations"]
    file_paths = [f["path"] for f in evidence.get("files", [])]
    history = session["inputSnapshot"]["humanAnswerHistory"]
    answers = [
        (r["assessmentRuleId"], a["answer"])
        for r in history for a in r.get("answers", [])
        if isinstance(a.get("answer"), str)
    ]
    unknowns = sum(
        any(marker in text.lower() for marker in (
            "status remains unknown", "history remains unknown", "incident history remains unconfirmed"))
        for _, text in answers
    )
    no_incident = sum(
        "no serious incident has occurred" in text.lower()
        for _, text in answers
    )
    rule_candidates = {
        "luat134-art11-cl2-machine-readable-marking-impl":
            "Text-only machine-readable-marking exception needs independent review",
        "art3-cl1-pta-risk-prevention":
            "Circular 05 private-commercial applicability and modality need review",
    }
    review_items = [
        {"ruleId": rule, "reason": why, "verdict": current.get(rule, {}).get("decision", {}).get("compliance")}
        for rule, why in rule_candidates.items() if rule in current
    ]
    circular05_review = []
    for finding in findings:
        source_docs = {
            source.get("documentId", "")
            for req in finding.get("legalBasis", {}).get("legalRequirements", [])
            for source in req.get("sources", [])
        }
        if any(doc.startswith("thong-tu-so-05-2026-tt-bkhcn") for doc in source_docs):
            circular05_review.append({
                "ruleId": finding["assessmentRuleId"],
                "applicability": finding["decision"]["applicability"],
                "compliance": finding["decision"].get("compliance"),
                "reason": "Check Circular 05 Article 1(2)-(3) direct public-service scope vs encouraged private application",
                "status": "INDEPENDENT_LEGAL_REVIEW_REQUIRED",
            })
    return {
        "assessmentId": session["session"]["assessmentId"],
        "pinnedCommit": session["repository"]["commitSha"],
        "findings": len(findings),
        "acceptedDecisions": len(current),
        "outcomes": outcomes,
        "unmatchedDecisionRefs": unmatched,
        "narrativeContradictionRuleIds": mismatched,
        "nonCompliantMissingRecommendationRuleIds": missing_remediations,
        "hitlResponses": len(answers),
        "hitlUnknownLanguageResponses": unknowns,
        "hitlAbsoluteNoSeriousIncidentResponses": no_incident,
        "observedFilePaths": file_paths,
        "repositoryFilesAfterExcludingAgentScratch": [p for p in file_paths if not p.startswith(".lcsp/")],
        "modelCallsRecorded": session["executionMetrics"]["modelCalls"],
        "runtimeEventsRecorded": len(session["executionHistory"]["runtimeEvents"]),
        "originalReportAvailable": session["assessmentResults"]["finalReportStatus"],
        "legalReviewCandidates": review_items,
        "circular05ScopeReview": circular05_review,
    }


def main() -> None:
    """Read immutable input artifacts and publish a forensic comparison.

    Business purpose:
        Tie a local T31 comparison to the exact session/report file bytes.
    Business rules:
        Require both input paths and preserve their contents; any output remains
        a technical review artifact, not a legal approval or live pilot result.
    Execution flow:
        Parse both exports, compare their contents, attach file SHA-256 digests,
        optionally write the configured output and print the resulting JSON.
    Failure cases:
        Invalid arguments, unreadable or malformed inputs, comparison failures
        and output-write errors propagate without fabricating a successful report.
    Side effects:
        Read local artifacts, optionally replace the requested output file and
        print the comparison; do not modify inputs or call external services.
    """
    parser = argparse.ArgumentParser()
    parser.add_argument("--session", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    opts = parser.parse_args()
    session = json.loads(opts.session.read_text(encoding="utf-8"))
    report = json.loads(opts.report.read_text(encoding="utf-8"))
    result = audit(session, report)
    result["sessionFileSha256"] = hashlib.sha256(opts.session.read_bytes()).hexdigest()
    result["reportFileSha256"] = hashlib.sha256(opts.report.read_bytes()).hexdigest()
    text = json.dumps(result, indent=2, ensure_ascii=False)
    if opts.output:
        opts.output.write_text(text + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
