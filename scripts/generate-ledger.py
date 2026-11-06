#!/usr/bin/env python3
"""Render the supplied historical HITL rows without inferring completeness or legal acceptance."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import html
import json
from pathlib import Path


def validate_rows(value: object) -> list[dict]:
    """Business purpose: Keep a historical ledger faithful to its supplied evidence.
    Business rules:
    - An export is an array of unique request rows; missing fields cannot become guessed facts.
    Execution flow:
    1. Validate request identity, rule, question, answer, status and supplied timestamps.
    Failure cases:
    - Malformed rows or duplicate requests stop rendering.
    Side effects:
    - Pure validation; never reads a live assessment or modifies historical evidence.
    """
    if not isinstance(value, list):
        raise ValueError("ledger input must be an array")
    seen = set()
    for row in value:
        if not isinstance(row, dict):
            raise ValueError("ledger row must be an object")
        for key in ("requestId", "ruleId", "question", "status"):
            if not isinstance(row.get(key), str) or not row[key]:
                raise ValueError("ledger requires explicit " + key)
        if row["requestId"] in seen:
            raise ValueError("duplicate request identity")
        seen.add(row["requestId"])
        if row.get("answer") is not None and not isinstance(row["answer"], str):
            raise ValueError("answer must be text or null")
        for key in ("createdAt", "resolvedAt"):
            if row.get(key) is not None and not isinstance(row[key], str):
                raise ValueError("timestamp must be supplied text or null")
    return value


def markdown_text(value: object) -> str:
    """Business purpose: Render supplied text without activating markup or changing its words.
    Business rules:
    - Newlines and table delimiters are escaped; missing values stay explicitly unavailable.
    Execution flow:
    1. HTML-escape the supplied value and normalize line breaks for Markdown.
    Failure cases:
    - No inference or summarization is performed.
    Side effects:
    - Pure text formatting.
    """
    if value is None:
        return "(not supplied)"
    return html.escape(str(value), quote=False).replace("|", "&#124;").replace("\r\n", "\n").replace("\n", "<br>")


def render_ledger(rows: list[dict], source_sha256: str) -> str:
    """Business purpose: Produce a reviewable ledger with observed counts and full supplied answers.
    Business rules:
    - Counts describe only these rows; no total case coverage, success or legal verdict is inferred.
    - Historical content is preserved in detail, including unknown or missing answers.
    Execution flow:
    1. Count supplied request statuses and declare the evidence scope.
    2. Render the overview and every question/answer exactly as supplied, with safe escaping.
    Failure cases:
    - Invalid input is rejected before output creation.
    Side effects:
    - Returns Markdown only; does not rewrite its source JSON or historical reports.
    """
    rows = validate_rows(rows)
    statuses = Counter(row["status"] for row in rows)
    lines = ["# Historical HITL ledger from supplied rows", "",
             "- Evidence scope: supplied rows only; completeness of the full assessment is not established.",
             "- Supplied request count: " + str(len(rows)),
             "- Observed RESOLVED rows: " + str(statuses.get("RESOLVED", 0)),
             "- Status counts: " + markdown_text(json.dumps(dict(sorted(statuses.items())))),
             "- Input SHA256: " + source_sha256,
             "- Current integration, current assessment state and legal acceptance: not evaluated by this renderer.",
             "", "| # | Request ID | Rule ID | Status |", "| --- | --- | --- | --- |"]
    for index, row in enumerate(rows, 1):
        lines.append("| " + " | ".join(markdown_text(value) for value in
                     (index, row["requestId"], row["ruleId"], row["status"])) + " |")
    for index, row in enumerate(rows, 1):
        lines += ["", "## Request " + str(index), "",
                  "- Request ID: " + markdown_text(row["requestId"]),
                  "- Rule ID: " + markdown_text(row["ruleId"]),
                  "- Created at: " + markdown_text(row.get("createdAt")),
                  "- Resolved at: " + markdown_text(row.get("resolvedAt")),
                  "- Status: " + markdown_text(row["status"]), "",
                  "### Question", "", markdown_text(row["question"]), "",
                  "### Supplied answer", "", markdown_text(row.get("answer"))]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    """Business purpose: Create a new ledger artifact from an explicitly selected input.
    Business rules:
    - Both paths are explicit; an existing output is never overwritten.
    Execution flow:
    1. Read/hash the source, validate rows, and render all supplied evidence.
    2. Create the new UTF8 Markdown destination once.
    Failure cases:
    - Invalid JSON, unsafe input shape or an existing destination fails visibly.
    Side effects:
    - Writes only the new output file and prints counts/hash metadata.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    raw = args.input.read_bytes()
    rows = validate_rows(json.loads(raw))
    digest = hashlib.sha256(raw).hexdigest()
    with args.output.open("x", encoding="utf-8") as output:
        output.write(render_ledger(rows, digest))
    print(json.dumps({"rows": len(rows), "sourceSha256": digest, "output": str(args.output)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
