"""Durable tool-call to physical model invocation causation for later output evaluation.

Business purpose:
Preserve which paid model invocation emitted each tool call so a later business rejection can be tied to the correct response.
Business rules:
- A tool-call ID can recur across physical invocations in one run; unqualified lookup is then ambiguous.
- This mapping is evidence of origin, not itself a domain verdict.
Execution flow:
1. Extract tool-call IDs from the actual model response.
2. Atomically store or verify their existing mappings.
3. Resolve an exact tool-call ID during a later evaluator event.
Failure cases:
- Missing or duplicate IDs and conflicting replay fail closed.
Side effects:
- Writes minimal identifiers to worker-local SQLite; never stores model content or verdicts.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from langchain_core.messages import AIMessage


class CausationConflictError(ValueError):
    """Raised when tool-call origin evidence is absent or contradictory."""


def _initialize(connection: sqlite3.Connection) -> None:
    """Business purpose: Create the minimal durable causation index.

    Business rules:
    - A run, tool-call ID, and physical invocation identify one origin without forbidding provider ID reuse.
    Execution flow:
    1. Enable full synchronous durability.
    2. Create the unique origin table if absent.
    Failure cases:
    - SQLite errors propagate and block response handoff.
    Side effects:
    - May create a worker-local SQLite table.
    """
    # Why: A restart must not erase the model response's physical tool-call identity.
    # How: Keep one row per physical invocation and copy legacy unique rows into the expanded index.
    # Invariant: This table stores identifiers only, never model output or financial verdicts.
    connection.execute("PRAGMA synchronous=FULL")
    connection.execute("""
        CREATE TABLE IF NOT EXISTS physical_tool_call_causation_v2 (
            run_id TEXT NOT NULL,
            tool_call_id TEXT NOT NULL,
            invocation_id TEXT NOT NULL,
            PRIMARY KEY (run_id, tool_call_id, invocation_id)
        )
    """)
    # Why: Existing worker journals may contain the earlier one-origin schema.
    # How: Copy each historical row idempotently without deleting the old evidence table.
    # Invariant: Migration cannot turn a reused provider ID into a fabricated unique verdict origin.
    legacy = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'physical_tool_call_causation'"
    ).fetchone()
    if legacy:
        connection.execute("""INSERT OR IGNORE INTO physical_tool_call_causation_v2
            (run_id, tool_call_id, invocation_id)
            SELECT run_id, tool_call_id, invocation_id FROM physical_tool_call_causation""")
    connection.commit()


def record_physical_tool_call_causation(
    db_path: str | Path, run_id: str, invocation_id: str, response: Any,
) -> int:
    """Business purpose: Bind actual model tool calls to their server-issued physical invocation.

    Business rules:
    - Only the middleware may pass its validated server invocation and actual model response.
    - Duplicate IDs inside one response are forbidden; reuse across physical calls is retained as ambiguity.
    Execution flow:
    1. Extract and validate all AIMessage tool-call IDs.
    2. Lock the SQLite writer and compare existing mappings.
    3. Commit new mappings atomically.
    Failure cases:
    - Missing identity, duplicate ID within one response, or SQLite failure stops handoff.
    Side effects:
    - Persists minimal causation rows on worker disk.
    """
    # Why: A tool rejection has a toolCallId, but model turn does not identify a paid physical attempt.
    # How: Record every tool ID in one transaction after the middleware stamps server invocation identity.
    # Invariant: Never manufacture DOMAIN_REJECTED; a repeated provider ID must not block paid settlement.
    if not run_id or not invocation_id:
        raise CausationConflictError("Run and physical invocation IDs are required")
    messages = response.result if hasattr(response, "result") else [response]
    ids: list[str] = []
    for message in messages:
        if not isinstance(message, AIMessage):
            continue
        for call in message.tool_calls:
            call_id = call.get("id")
            if not isinstance(call_id, str) or not call_id:
                raise CausationConflictError("Model tool call has no stable ID")
            ids.append(call_id)
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path, timeout=10) as connection:
        _initialize(connection)
        if len(ids) != len(set(ids)):
            raise CausationConflictError("Duplicate model tool-call ID in one response")
        connection.execute("BEGIN IMMEDIATE")
        for call_id in ids:
            row = connection.execute(
                "SELECT 1 FROM physical_tool_call_causation_v2 WHERE run_id = ? AND tool_call_id = ? AND invocation_id = ?",
                (run_id, call_id, invocation_id),
            ).fetchone()
            if row is None:
                connection.execute(
                    "INSERT INTO physical_tool_call_causation_v2 (run_id, tool_call_id, invocation_id) VALUES (?, ?, ?)",
                    (run_id, call_id, invocation_id),
                )
        connection.commit()
    return len(ids)


def find_physical_invocation_for_tool_call(
    db_path: str | Path, run_id: str, tool_call_id: str,
) -> str | None:
    """Business purpose: Resolve exact physical origin for a downstream tool rejection.

    Business rules:
    - Require both run and tool-call identity; return no origin when more than one invocation used that ID.
    Execution flow:
    1. Query up to two distinct physical origins.
    2. Return the ID only when exactly one origin exists.
    Failure cases:
    - Missing evidence yields None; SQLite failures propagate.
    Side effects:
    - Read-only worker-local SQLite query.
    """
    # Why: Missing causal evidence must leave the evaluation NOT_EVALUATED.
    # How: Resolve the (runId, toolCallId) pair only if it still has one physical origin.
    # Invariant: A different run cannot claim the same tool call; provider ID reuse returns no verdict authority.
    if not run_id or not tool_call_id or not Path(db_path).exists():
        return None
    with sqlite3.connect(db_path, timeout=10) as connection:
        _initialize(connection)
        rows = connection.execute(
            "SELECT invocation_id FROM physical_tool_call_causation_v2 WHERE run_id = ? AND tool_call_id = ? LIMIT 2",
            (run_id, tool_call_id),
        ).fetchall()
    return rows[0][0] if len(rows) == 1 else None
