"""Apply the scanner policy to one existing report, with a read-only preview by default."""

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from dotenv import load_dotenv
import psycopg
from psycopg.types.json import Jsonb

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "deepagents"))

from orchestration.technical_coverage_policy import attach_partial_coverage_policy


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report_id")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--replay", action="store_true", help="Invoke the original accepted-evidence event after repair")
    args = parser.parse_args()
    if args.replay and not args.apply:
        parser.error("--replay requires --apply")
    event = None
    load_dotenv(REPO_ROOT / ".env")
    url = urlsplit(os.environ["DATABASE_URL"])
    query = urlencode([(key, value) for key, value in parse_qsl(url.query) if key != "schema"])
    with psycopg.connect(urlunsplit(url._replace(query=query))) as conn:
        with conn.cursor() as cur:
            cur.execute('SELECT "evidencePayload" FROM "TechnicalEvidenceReport" WHERE id = %s FOR UPDATE', (args.report_id,))
            row = cur.fetchone()
            if row is None:
                raise ValueError("Evidence report not found")
            before = row[0]
            after = attach_partial_coverage_policy(before)
            policy = after.get("partialCoveragePolicyDecision")
            print(json.dumps({"reportId": args.report_id, "changed": before != after,
                              "applied": args.apply, "policy": {
                                  key: value for key, value in (policy or {}).items() if key != "limitations"
                              }, "limitationCount": len((policy or {}).get("limitations", []))}))
            if args.apply and before != after:
                cur.execute('UPDATE "TechnicalEvidenceReport" SET "evidencePayload" = %s WHERE id = %s',
                            (Jsonb(after), args.report_id))
            if args.replay:
                if not policy or policy.get("permittedForInterview") is not True:
                    raise ValueError("Report policy does not permit Interview replay")
                cur.execute('SELECT payload FROM "OutboxMessage" WHERE "aggregateId" = %s AND "eventType" = %s ORDER BY "createdAt" DESC LIMIT 1',
                            (args.report_id, "event.technical-evidence.accepted.v1"))
                original_event = cur.fetchone()
                if original_event is None:
                    raise ValueError("Original accepted-evidence event not found")
                event = original_event[0]
    if event is not None:
        from tools.common.capabilities.managed.invocation import invoke_boundary
        result = invoke_boundary("engineering_assessment_requested", event, event["correlationId"])
        print(json.dumps(result))


if __name__ == "__main__":
    main()
