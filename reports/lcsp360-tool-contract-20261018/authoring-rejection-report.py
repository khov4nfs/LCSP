"""Reconstruct every Rule authoring rejection of a run from its durable events: no hidden prompts, no chain-of-thought.

Input is either a list of stream payloads ({"data": {...}}) or a disposable-observation.json (AssessmentRuntimeEvent rows).
A rejection that cannot be explained (no envelope) or that has no recorded fate is reported as UNEXPLAINED/UNRESOLVED, and the
overall AUTHORING_OBSERVABILITY verdict is FAIL even if the run eventually succeeded.
"""
import json
import sys
from pathlib import Path


def payloads(source) -> list[dict]:
    if isinstance(source, dict) and "AssessmentRuntimeEvent" in source:
        rows = sorted(source["AssessmentRuntimeEvent"], key=lambda e: int(e["sequence"]))
        out = []
        for row in rows:
            blob = row["outputSummaryJson"]
            blob = json.loads(blob) if isinstance(blob, str) else blob
            out.append({"data": ((blob or {}).get("agentStreamEvent", {})).get("data", {})})
        return out
    return source


def build_table(source) -> dict:
    events = [e["data"] for e in payloads(source) if e.get("data")]
    rejections = [e for e in events if e.get("activity_kind") == "RULE_AUTHORING_TOOL_REJECTED"]
    resolutions = {e["rejection_sequence"]: e for e in events if e.get("activity_kind") == "RULE_AUTHORING_REJECTION_RESOLVED"}
    rows, unexplained = [], 0
    for ordinal, event in enumerate(rejections, 1):
        envelope = event.get("rejection")
        if not envelope:
            unexplained += 1
            rows.append({"ordinal": ordinal, "eventSequence": event.get("event_sequence"), "verdict": "UNEXPLAINED", "gapCounts": event.get("gap_counts")})
            continue
        fate = resolutions.get(envelope["sequence"])
        rows.append({"ordinal": ordinal, "sequence": envelope["sequence"], "modelTurn": envelope.get("modelTurn"), "tool": envelope["toolName"], "toolCallId": envelope.get("toolCallId"),
                     "layer": envelope["rejectionLayer"], "source": envelope.get("rejectionSource"), "code": envelope["rejectionCode"], "fieldPaths": envelope.get("fieldPaths"),
                     "draftRevision": envelope.get("draftRevisionBefore"), "draftRevisionAfter": envelope.get("draftRevisionAfter"),
                     "draftUnchanged": envelope.get("draftUnchanged"), "argsFingerprint": envelope.get("argsFingerprint"), "requiredAction": envelope.get("requiredAction"),
                     "resolution": fate["resolution"] if fate else "UNRESOLVED", "resolvedByToolCallId": fate.get("resolved_by_tool_call_id") if fate else None,
                     "resolvedByTool": fate.get("resolved_by_tool") if fate else None})
    unresolved = [r for r in rows if r.get("resolution") == "UNRESOLVED"]
    validations = [e for e in events if e.get("activity_kind", "").startswith("RULE_VALIDATION_")]
    return {"rejections": len(rows), "unexplained": unexplained, "unresolved": len(unresolved),
            "byLayer": {layer: sum(1 for r in rows if r.get("layer") == layer) for layer in sorted({r.get("layer") for r in rows if r.get("layer")})},
            "ruleValidatorRuns": sum(1 for e in validations if e["activity_kind"] == "RULE_VALIDATION_STARTED"),
            "AUTHORING_OBSERVABILITY": "PASS" if unexplained == 0 and not unresolved else "FAIL", "rows": rows}


def markdown(table: dict) -> str:
    lines = [f"# Authoring rejections ({table['rejections']}; unexplained {table['unexplained']}; unresolved {table['unresolved']}; AUTHORING_OBSERVABILITY={table['AUTHORING_OBSERVABILITY']})", "",
             "| # | tool | layer | code | fields | draft rev | resolution | resolving call |", "|---|---|---|---|---|---|---|---|"]
    for r in table["rows"]:
        if r.get("verdict") == "UNEXPLAINED":
            lines.append(f"| {r['ordinal']} | ? | ? | {r['gapCounts']} | ? | ? | UNEXPLAINED | |")
        else:
            lines.append(f"| {r['ordinal']} | {r['tool']} | {r['layer']} | {r['code']} | {', '.join(r['fieldPaths'] or [])} | {r['draftRevision']} | {r['resolution']} | {r['resolvedByTool'] or ''} {r['resolvedByToolCallId'] or ''} |")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    observation = json.loads(Path(sys.argv[1]).read_text())
    table = build_table(observation)
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(sys.argv[1]).with_name("AUTHORING_REJECTIONS")
    out.with_suffix(".json").write_text(json.dumps(table, indent=1) + "\n")
    out.with_suffix(".md").write_text(markdown(table))
    print(json.dumps({k: table[k] for k in ("rejections", "unexplained", "unresolved", "byLayer", "AUTHORING_OBSERVABILITY")}))
