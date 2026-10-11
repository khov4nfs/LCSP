#!/usr/bin/env python3
"""Owned synthetic corpus preconditions and read-only capture; preparation starts in Playwright."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from uuid import UUID, uuid4

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("staging_legal", ROOT / "tests/staging-legal-preparation.py")
legal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legal)
staging = legal.staging


def main() -> None:
    run_id, action, *args = sys.argv[1:]
    mode = args[0] if args else "initial"
    staging.require(mode in {"initial", "failure", "supersession"}, "unknown corpus scenario")
    stack = staging.Stack(run_id)
    stack.manifest = staging.json_file(stack.private / "stack.json")
    access = staging.json_file(stack.private / "access.json")
    legal.verify_stack(stack, access)
    suffix = "" if mode == "initial" else "-" + mode
    file_name = "legal-corpus-precondition" + suffix + ".json"
    if action == "seed":
        staging.require(not (stack.private / file_name).exists(), "corpus already seeded; do not replace")
        corpus_id = str(uuid4())
        version = f"release-synthetic-{run_id}{suffix}"
        fixture, pin = legal.fixture_input()
        if mode == "failure":
            stack.sql('INSERT INTO "LegalCorpusVersion"(id,version,status,"sourceManifest") VALUES (' +
                      legal.quote(corpus_id) + ',' + legal.quote(version) + ",'APPROVED','{\"synthetic\":true,\"purpose\":\"EMPTY_CORPUS_NO_INDEX_NEGATIVE\"}'::jsonb);")
            stack.sql('INSERT INTO "LegalSourceDocument"(id,"legalCorpusVersionId","documentId",title,"sourceUrl","sourceSha256","sourceEffectStatus") VALUES (' +
                      ','.join(legal.quote(value) for value in [str(uuid4()), corpus_id, pin["documentId"], "Reviewed synthetic notice", "https://example.invalid/release-synthetic", pin["sourceSha256"], pin["sourceEffectStatus"]]) + ');')
        else:
            stack.sql(legal.seed_sql(corpus_id, version, fixture, pin,
                                    status="APPROVED" if mode == "supersession" else "DRAFT"))
            staging.require(int(stack.sql('SELECT count(*) FROM "LegalDocumentChunk" WHERE "legalCorpusVersionId"=' + legal.quote(corpus_id) + ';')) == len(fixture["chunks"]), "seeded chunk count mismatch")
        receipt = {"scope": "REVIEWED_SYNTHETIC_CORPUS_PRECONDITION_ONLY", "status": "PASS", "runId": run_id,
                   "corpusVersionId": corpus_id, "version": version, "mode": mode,
                   "sourceSha256": pin["sourceSha256"] if mode != "failure" else None,
                   "chunks": len(fixture["chunks"]) if mode != "failure" else 0,
                   "validIndex": mode != "failure", "preparationStarted": False,
                   "officialAcquisitionAndLiveIndexConstruction": "NOT_SUBSTITUTED"}
        staging.write_json(stack.private / file_name, receipt, private=True)
        staging.write_json(stack.evidence / file_name, receipt)
    elif action == "capture":
        corpus = staging.json_file(stack.private / file_name)
        corpus_id = str(UUID(corpus["corpusVersionId"]))
        rows = json.loads(stack.sql('SELECT coalesce(json_agg(r),\'[]\') FROM (SELECT p.id,p."executionState",p."failureReason",v.id AS "portfolioVersionId",v."lifecycleState",v."validationOutcome",v."portfolioDigest",o.status AS "outboxStatus" FROM "LegalPreparationRun" p LEFT JOIN "LegalPortfolioVersion" v ON v."preparationRunId"=p.id LEFT JOIN "OutboxMessage" o ON o.id=p."outboxEventId" WHERE p."legalCorpusVersionId"=' + legal.quote(corpus_id) + ') r;'))
        browser = staging.json_file(stack.private / "browser-state.json")
        attempt = browser.get("legalAttempts", {}).get(mode)
        if attempt:
            rows = [row for row in rows if row["id"] == attempt["preparationRunId"]]
        staging.require(len(rows) == 1, "exactly one UI-started preparation required")
        run = rows[0]
        staging.require(run["executionState"] in {"SUCCEEDED", "FAILED"}, "preparation is not terminal")
        persisted = {}
        if run["portfolioVersionId"]:
            portfolio_id = str(UUID(run["portfolioVersionId"]))
            persisted["portfolio"] = json.loads(stack.sql('SELECT row_to_json(p) FROM "LegalPortfolioVersion" p WHERE id=' + legal.quote(portfolio_id) + ';'))
            for label, table in (("legalRules", "LegalPortfolioRule"), ("engineeringRules", "EngineeringRule"), ("provenance", "LegalRuleProvenance"), ("contextRelations", "LegalRuleContextRelation"), ("coverageLinks", "EngineeringRuleLegalRule")):
                persisted[label] = json.loads(stack.sql('SELECT coalesce(json_agg(p),\'[]\') FROM "' + table + '" p WHERE "portfolioVersionId"=' + legal.quote(portfolio_id) + ';'))
            persisted["sourceChunks"] = json.loads(stack.sql('SELECT coalesce(json_agg(p),\'[]\') FROM "LegalDocumentChunk" p WHERE "legalCorpusVersionId"=' + legal.quote(corpus_id) + ';'))
            staging.write_json(stack.evidence / ("legal-portfolio-persisted" + suffix + ".json"), persisted)
        activations = int(stack.sql('SELECT count(*) FROM "LegalPortfolioActivationRecord" WHERE "preparationRunId"=' + legal.quote(run["id"]) + ';'))
        receipt = {"scope": "EXACT_IMAGE_UI_STARTED_LEGAL_PREPARATION_CAPTURE", "runId": run_id,
                   "status": "PASS_RUNTIME_MECHANICS" if run["executionState"] == "SUCCEEDED" else "FAILED_PREPARATION",
                   "imageReceipt": str(staging.IMAGE_EVIDENCE.relative_to(ROOT) / "report.json"),
                   "run": run, "activations": activations, "initiatedThrough": "PLAYWRIGHT_ADMIN_UI",
                   "packetManuallyEdited": False, "semanticReview": "REQUIRED"}
        staging.require((run["executionState"] != "SUCCEEDED") or (run["lifecycleState"] == "ACTIVE" and run["validationOutcome"] == "PASSED" and run["outboxStatus"] == "PUBLISHED" and activations == 1), "persisted activation mismatch")
        staging.write_json(stack.evidence / ("legal-preparation" + suffix + ".json"), receipt)
        staging.write_json(stack.evidence / ("legal-preparation-" + run["id"] + ".json"), receipt)
    else:
        raise ValueError("use seed or capture")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
