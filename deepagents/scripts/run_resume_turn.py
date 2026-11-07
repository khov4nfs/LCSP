#!/usr/bin/env python3
"""Inspect or explicitly retry one customer-selected audit through its owner API.

This replaces the historical direct-Root launcher. A retry is queued by the existing
API/outbox and still requires native admission, checkpoint recovery and governance.
Default invocation is read-only. It never resets a pilot journal or selects a
historical assessment automatically.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from urllib.parse import urlsplit
from uuid import UUID

import httpx


def validate_target(api_base: str, assessment_id: str, audit_request_id: str) -> str:
    """Business purpose: Require one explicit local assessment and frozen audit target.
    Business rules:
    - No ambient default identity, remote endpoint or URL credentials are accepted.
    Execution flow:
    1. Validate loopback HTTP and canonical UUID arguments.
    Failure cases:
    - Invalid bindings stop before an API request.
    Side effects:
    - Pure validation; returns a normalized endpoint.
    """
    endpoint = urlsplit(api_base)
    if (endpoint.scheme != "http" or endpoint.hostname not in {"127.0.0.1", "localhost", "::1"}
            or not endpoint.port or endpoint.port < 1024 or endpoint.username or endpoint.password
            or endpoint.path not in {"", "/"} or endpoint.query or endpoint.fragment):
        raise ValueError("explicit loopback HTTP API required")
    for value in (assessment_id, audit_request_id):
        if str(UUID(value)) != value:
            raise ValueError("canonical assessment and audit UUIDs required")
    return api_base.rstrip("/")


def request_fingerprint(audit: dict, assessment_id: str, audit_request_id: str) -> str:
    """Business purpose: Bind an explicit retry to the audit intent reviewed by the operator.
    Business rules:
    - Exact assessment/request, source pins, revision, scope and rule identities are frozen.
    - Mutable progress does not change the intent digest; the API owns current retry eligibility.
    Execution flow:
    1. Validate the owner response and serialize its immutable membership/pins.
    2. Return a credential-free SHA256 for the explicit submit step.
    Failure cases:
    - Missing, duplicate or changed identities reject the retry.
    Side effects:
    - Pure digest calculation; never claims an execution or alters a journal.
    """
    keys = ("requestId", "assessmentId", "requestRevision", "scopeMode", "ruleSetVersionId",
            "ruleSetDigest", "repositorySnapshotId", "repositoryCommit")
    if audit.get("assessmentId") != assessment_id or audit.get("requestId") != audit_request_id:
        raise ValueError("audit ownership mismatch")
    if any(audit.get(key) is None for key in keys):
        raise ValueError("incomplete immutable audit intent")
    rules = audit.get("rules")
    if not isinstance(rules, list) or not rules:
        raise ValueError("frozen audit membership required")
    identities = sorted((row["assessmentRuleId"], row["assessmentRuleVersion"]) for row in rules)
    if len({row[0] for row in identities}) != len(identities):
        raise ValueError("duplicate audit member")
    intent = {key: audit[key] for key in keys} | {"rules": identities}
    return hashlib.sha256(json.dumps(intent, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def main(argv: list[str] | None = None) -> int:
    """Business purpose: Make one owner-authorized audit retry concrete before explicit submission.
    Business rules:
    - Read-only by default; submit requires the reviewed fingerprint and a stable idempotency UUID.
    - Only FAILED/INTERRUPTED audits are eligible here; human answers use the normal customer workflow.
    - Owner credentials come from an explicitly named environment variable, never a repository dotenv load.
    Execution flow:
    1. Read the exact audit and print only identity/status/fingerprint metadata.
    2. On explicit submit, verify the reviewed intent and POST the supported retry route once.
    Failure cases:
    - Stale intent, ineligible state or API errors fail without direct execution or automatic retry.
    Side effects:
    - Default performs one owner GET; explicit submit may enqueue governed native work through the API.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-base", required=True)
    parser.add_argument("--assessment-id", required=True)
    parser.add_argument("--audit-request-id", required=True)
    parser.add_argument("--session-env", default="LCSP_CUSTOMER_SESSION_TOKEN")
    parser.add_argument("--submit", action="store_true")
    parser.add_argument("--expected-request-sha256")
    parser.add_argument("--idempotency-key")
    args = parser.parse_args(argv)
    base = validate_target(args.api_base, args.assessment_id, args.audit_request_id)
    session = os.environ.get(args.session_env)
    if not session:
        raise ValueError("customer session environment variable required")
    route = base + "/assessments/" + args.assessment_id + "/rule-audits/" + args.audit_request_id
    with httpx.Client(headers={"Authorization": "Bearer " + session}, timeout=30, follow_redirects=False) as client:
        response = client.get(route)
        response.raise_for_status()
        envelope = response.json()
        if envelope.get("ok") is not True:
            raise ValueError("owner API rejected the audit read")
        audit = envelope["data"]
        digest = request_fingerprint(audit, args.assessment_id, args.audit_request_id)
        receipt = {"assessmentId": args.assessment_id, "auditRequestId": args.audit_request_id,
                   "status": audit["status"], "requestSha256": digest, "submitted": False}
        if args.submit:
            if args.expected_request_sha256 != digest:
                raise ValueError("retry requires the exact previously reviewed audit fingerprint")
            if audit["status"] not in {"FAILED", "INTERRUPTED"}:
                raise ValueError("audit is not eligible for this retry helper")
            if not args.idempotency_key or str(UUID(args.idempotency_key)) != args.idempotency_key:
                raise ValueError("explicit stable idempotency UUID required")
            response = client.post(route + "/retry", json={"idempotencyKey": args.idempotency_key})
            response.raise_for_status()
            envelope = response.json()
            if envelope.get("ok") is not True:
                raise ValueError("owner API rejected the retry")
            receipt.update(submitted=True, status=envelope["data"]["status"],
                           execution="QUEUED_BY_EXISTING_NATIVE_WORKFLOW")
    print(json.dumps(receipt))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"status": "BLOCKED", "errorType": type(error).__name__}))
        raise SystemExit(2) from None
