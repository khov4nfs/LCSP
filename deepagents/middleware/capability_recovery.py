"""Durable recovery store for in-flight capability envelopes and authoritative settlement.

Business purpose:
Persist in-flight capability tokens in encrypted SQLite envelopes prior to consume and provider dispatch,
and recover them after worker crashes to settle with POST /internal/billing/usage/settle without redispatching.

Business rules:
- Raw capabilityToken is encrypted with AES-256-GCM before writing to SQLite; never stored in plaintext.
- AAD binds admissionId, invocationId, and runId to prevent row-swapping attacks.
- Only terminal acknowledgement removes the record from the accessible recovery set.
- OUTCOME_UNKNOWN responses (settled: false, slotReleased: false) retain the envelope.
- If crash occurred before usage evidence was committed, reports OUTCOME_UNKNOWN, never fabricates receipts.

Execution flow:
1. Initialize local SQLite table with WAL mode and full synchronous durability.
2. Record admission envelope encrypted with AES-256-GCM before consuming capability on server.
3. Commit provider usage evidence upon model completion.
4. On reboot, sweeper reads pending admissions and settles with POST /internal/billing/usage/settle.
5. Remove admission record from accessible set only upon terminal settlement confirmation.

Failure cases:
- Database disk/lock errors propagate to caller.
- Corrupted envelopes or tag mismatches fail closed via CorruptedEnvelopeError.

Side effects:
- Writes and deletes rows in worker-local SQLite recovery database.
"""
from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from middleware.envelope_encryption import (
    WorkerEnvelopeKeyring,
    compute_recovery_aad,
    CorruptedEnvelopeError,
)


class CapabilityRecoveryStore:
    """Encrypted SQLite persistence store for in-flight capability recovery."""

    def __init__(self, db_path: str | Path, keyring: WorkerEnvelopeKeyring) -> None:
        self.db_path = Path(db_path)
        self.keyring = keyring
        self._init_db()

    def _init_db(self) -> None:
        """Business purpose: Initialize SQLite database schema and durability PRAGMAs.

        Business rules:
        - WAL mode enabled for concurrent reader/writer isolation.
        - Synchronous mode FULL enabled to guarantee durability before process return.
        - Idempotent schema initialization; creates capability_recovery and invocation_usage_evidence tables if not exists.

        Execution flow:
        1. Ensure parent directory exists.
        2. Open SQLite connection with 10s timeout.
        3. Execute PRAGMAs and CREATE TABLE statements.
        4. Commit transaction and close connection.

        Failure cases:
        - SQLite file lock or permission errors propagate to caller.

        Side effects:
        - Creates local database file and tables on worker disk.
        """
        # Why: Ensure worker-local durable persistence tables exist with crash-safe WAL journaling.
        # How: Execute PRAGMA journal_mode=WAL, PRAGMA synchronous=FULL, and CREATE TABLE DDLs.
        # Invariants: Recovery tables must be durable before capability consume or provider call.
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.db_path, timeout=10) as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=FULL")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS capability_recovery (
                    admission_id TEXT PRIMARY KEY,
                    invocation_id TEXT NOT NULL,
                    run_id TEXT NOT NULL,
                    encrypted_envelope TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS invocation_usage_evidence (
                    invocation_id TEXT PRIMARY KEY,
                    evidence_payload TEXT NOT NULL,
                    committed_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
                )
            """)
            # Why: LangGraph may crash after a paid response but before its model-node checkpoint.
            # How: Keep only authenticated ciphertext and an explicit expiry for a bounded replay window.
            # Invariant: Response plaintext and prompts never enter the usage evidence table.
            conn.execute("""
                CREATE TABLE IF NOT EXISTS model_response_recovery (
                    admission_id TEXT PRIMARY KEY,
                    invocation_id TEXT NOT NULL,
                    run_id TEXT NOT NULL,
                    step_id TEXT NOT NULL,
                    encrypted_response TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    terminal_ack INTEGER NOT NULL DEFAULT 0 CHECK (terminal_ack IN (0, 1)),
                    UNIQUE (run_id, step_id)
                )
            """)
            # Why: Workers may already have the first version of this local table on disk.
            # How: Add the terminal marker without dropping encrypted responses during startup.
            # Invariant: Existing rows remain non-replayable until the server confirms settlement.
            columns = {row[1] for row in conn.execute("PRAGMA table_info(model_response_recovery)")}
            if "terminal_ack" not in columns:
                conn.execute("ALTER TABLE model_response_recovery ADD COLUMN terminal_ack INTEGER NOT NULL DEFAULT 0")
            # Why: Older local stores may predate the graph-step uniqueness constraint.
            # How: Build an explicit unique index; duplicate historical rows make startup fail closed.
            # Invariant: A replay lookup must never choose one of multiple paid answers nondeterministically.
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS model_response_recovery_run_step_unique "
                "ON model_response_recovery(run_id, step_id)"
            )
            # Why: Expiry that only blocks reads still retains customer output ciphertext indefinitely.
            # How: Purge rows at startup before admitting any more physical calls.
            # Invariant: Response retention cleanup never deletes usage or capability evidence.
            conn.execute(
                "DELETE FROM model_response_recovery WHERE expires_at <= ?",
                (datetime.now(timezone.utc).isoformat(),),
            )
            conn.commit()

    def record_model_response(
        self, admission_id: str, invocation_id: str, run_id: str, step_id: str,
        response: dict[str, Any], expires_at: datetime,
    ) -> None:
        """Business purpose: Preserve a paid model response until its graph checkpoint can commit.

        Business rules:
        - Bind response ciphertext to admission, physical invocation, run, and logical step.
        - Store only encrypted response bytes; the caller owns payload minimization and retention choice.
        Execution flow:
        1. Authenticate the expiry and response shape.
        2. Encrypt JSON with a response-specific AAD.
        3. Commit the ciphertext with SQLite FULL durability.
        Failure cases:
        - Invalid expiry, encryption failure, or disk failure aborts before replay is allowed.
        Side effects:
        - Writes one worker-local encrypted response row.
        """
        # Why: A token receipt alone cannot reconstruct an answer lost before checkpointing.
        # How: Encrypt under AAD that also contains the stable graph step ID.
        # Invariant: A different step or run can never consume this paid response.
        if expires_at.tzinfo is None or not isinstance(response, dict):
            raise ValueError("Response expiry must be timezone-aware and response must be an object")
        aad = compute_recovery_aad("MODEL_RESPONSE", admission_id, invocation_id, f"{run_id}:{step_id}")
        encrypted = self.keyring.encrypt_payload(json.dumps(response, sort_keys=True).encode("utf-8"), aad)
        with sqlite3.connect(self.db_path, timeout=10) as conn:
            conn.execute("PRAGMA synchronous=FULL")
            conn.execute(
                """INSERT INTO model_response_recovery
                (admission_id, invocation_id, run_id, step_id, encrypted_response, expires_at)
                VALUES (?, ?, ?, ?, ?, ?)""",
                (admission_id, invocation_id, run_id, step_id, encrypted, expires_at.astimezone(timezone.utc).isoformat()),
            )
            conn.commit()

    def get_model_response(
        self, admission_id: str, invocation_id: str, run_id: str, step_id: str,
    ) -> dict[str, Any] | None:
        """Business purpose: Recover a paid answer for the exact graph step after a crash.

        Business rules:
        - Require exact admission, physical invocation, run, and step match and a live TTL.
        - Corrupted ciphertext fails closed without returning content.
        Execution flow:
        1. Read the matching row and check expiry.
        2. Authenticate the ciphertext against its row identities.
        3. Return the decoded response object.
        Failure cases:
        - Missing or expired row returns None; tampering raises CorruptedEnvelopeError.
        Side effects:
        - Read-only SQLite query.
        """
        # Why: Replay needs the original paid answer but must never cross run or graph-step boundaries.
        # How: Match identifiers in SQL, then verify AES-GCM AAD before JSON decoding.
        # Invariant: Expired content is unavailable even if an encrypted row remains on disk.
        with sqlite3.connect(self.db_path, timeout=10) as conn:
            row = conn.execute(
                """SELECT encrypted_response, expires_at FROM model_response_recovery
                WHERE admission_id = ? AND invocation_id = ? AND run_id = ? AND step_id = ?""",
                (admission_id, invocation_id, run_id, step_id),
            ).fetchone()
        if row is None or datetime.fromisoformat(row[1]) <= datetime.now(timezone.utc):
            return None
        aad = compute_recovery_aad("MODEL_RESPONSE", admission_id, invocation_id, f"{run_id}:{step_id}")
        response = json.loads(self.keyring.decrypt_payload(row[0], aad))
        if not isinstance(response, dict):
            raise CorruptedEnvelopeError("Recovered model response is not an object")
        return response

    def mark_model_response_terminal(self, admission_id: str) -> None:
        """Business purpose: Enable replay only after server confirms terminal settlement.

        Business rules:
        - Only an existing paid response can be marked; caller must hold the server terminal acknowledgement.
        Execution flow:
        1. Update the exact admission row's terminal marker.
        2. Commit with SQLite full durability.
        Failure cases:
        - Missing response or SQLite write failure raises and cannot authorize replay.
        Side effects:
        - Updates one worker-local response row.
        """
        # Why: A local provider response alone is insufficient proof that financial settlement is terminal.
        # How: Gate lookup on a marker written only after the authoritative server acknowledgement.
        # Invariant: Missing rows cannot silently pass as replayable.
        with sqlite3.connect(self.db_path, timeout=10) as conn:
            conn.execute("PRAGMA synchronous=FULL")
            result = conn.execute(
                "UPDATE model_response_recovery SET terminal_ack = 1 WHERE admission_id = ?",
                (admission_id,),
            )
            if result.rowcount != 1:
                raise ValueError("No model response exists for terminal acknowledgement")
            conn.commit()

    def update_model_response_before_terminal(
        self, admission_id: str, invocation_id: str, run_id: str, step_id: str,
        response: dict[str, Any],
    ) -> None:
        """Business purpose: Persist a server-owned terminal payment decision in the paid answer.

        Business rules:
        - Only the exact pending admission, invocation, run, and step may be updated.
        - A terminal-marked response cannot be rewritten.
        Execution flow:
        1. Encrypt the updated response with the original row binding.
        2. Compare identities and pending state in a single SQLite update.
        3. Commit before marking the response terminal.
        Failure cases:
        - Identity mismatch or terminal row raises without changing ciphertext.
        Side effects:
        - Replaces ciphertext of one pending worker-local response.
        """
        # Why: The authoritative payment-required bit arrives after settlement but before graph checkpoint.
        # How: CAS-update ciphertext only for the same pending physical call.
        # Invariant: A retry or different admission cannot overwrite the paid answer.
        if not isinstance(response, dict):
            raise ValueError("Updated model response must be an object")
        aad = compute_recovery_aad("MODEL_RESPONSE", admission_id, invocation_id, f"{run_id}:{step_id}")
        encrypted = self.keyring.encrypt_payload(json.dumps(response, sort_keys=True).encode("utf-8"), aad)
        with sqlite3.connect(self.db_path, timeout=10) as conn:
            conn.execute("PRAGMA synchronous=FULL")
            result = conn.execute(
                """UPDATE model_response_recovery SET encrypted_response = ?
                WHERE admission_id = ? AND invocation_id = ? AND run_id = ? AND step_id = ? AND terminal_ack = 0""",
                (encrypted, admission_id, invocation_id, run_id, step_id),
            )
            if result.rowcount != 1:
                raise ValueError("Pending model response identity mismatch")
            conn.commit()

    def get_terminal_model_response(self, run_id: str, step_id: str) -> dict[str, Any] | None:
        """Business purpose: Replay the original paid output for an exact graph step.

        Business rules:
        - Only unexpired rows with a durable terminal server acknowledgement are eligible.
        - The encrypted response remains bound to its admission and physical invocation.
        Execution flow:
        1. Find the single terminal row for run and step.
        2. Decrypt via full identifier binding.
        Failure cases:
        - Missing or expired row returns None; corruption fails closed.
        Side effects:
        - Read-only SQLite access.
        """
        # Why: Graph replay knows its stable run and step but not necessarily the old server invocation ID.
        # How: Resolve a terminal row, then authenticate ciphertext using all persisted identities.
        # Invariant: Pending settlement cannot release an answer into the graph.
        with sqlite3.connect(self.db_path, timeout=10) as conn:
            row = conn.execute(
                """SELECT admission_id, invocation_id FROM model_response_recovery
                WHERE run_id = ? AND step_id = ? AND terminal_ack = 1""",
                (run_id, step_id),
            ).fetchone()
        if row is None:
            return None
        return self.get_model_response(row[0], row[1], run_id, step_id)

    def get_terminal_model_response_record(self, run_id: str, step_id: str) -> dict[str, Any] | None:
        """Business purpose: Supply the paid response and identities needed for server-authorized graph replay.

        Business rules:
        - A terminal local row is only a candidate; the caller must compare both IDs with server replay.
        Execution flow:
        1. Find the unexpired terminal row for one run and step.
        2. Authenticate and return its response with admission and invocation IDs.
        Failure cases:
        - Missing or expired row returns None; corrupted ciphertext fails closed.
        Side effects:
        - Read-only SQLite access.
        """
        # Why: A local terminal marker cannot stand in for authoritative server settlement state.
        # How: Return both identities so middleware can compare them with NestJS's SETTLED replay.
        # Invariant: Cross-admission or cross-invocation response reuse is forbidden.
        with sqlite3.connect(self.db_path, timeout=10) as conn:
            row = conn.execute(
                """SELECT admission_id, invocation_id FROM model_response_recovery
                WHERE run_id = ? AND step_id = ? AND terminal_ack = 1""",
                (run_id, step_id),
            ).fetchone()
        if row is None:
            return None
        response = self.get_model_response(row[0], row[1], run_id, step_id)
        if response is None:
            return None
        return {"admissionId": row[0], "invocationId": row[1], "response": response}

    def get_pending_model_response_record(
        self, admission_id: str, invocation_id: str, run_id: str,
    ) -> dict[str, Any] | None:
        """Business purpose: Find an encrypted paid answer during crash settlement recovery.

        Business rules:
        - Require exact admission, physical invocation, and run identifiers.
        - Return only a pending and unexpired response; never mark it terminal here.
        Execution flow:
        1. Read the pending row and its stable graph step.
        2. Authenticate and decode the response for server-owned payment stamping.
        Failure cases:
        - Missing/expired row returns None; ciphertext corruption fails closed.
        Side effects:
        - Read-only SQLite access.
        """
        # Why: The sweeper has a capability envelope but no graph step ID after a worker crash.
        # How: Resolve the step from the exact pending row, then authenticate ciphertext.
        # Invariant: Financial settlement cannot promote an unrelated response.
        with sqlite3.connect(self.db_path, timeout=10) as conn:
            row = conn.execute(
                """SELECT step_id FROM model_response_recovery
                WHERE admission_id = ? AND invocation_id = ? AND run_id = ? AND terminal_ack = 0""",
                (admission_id, invocation_id, run_id),
            ).fetchone()
        if row is None:
            return None
        response = self.get_model_response(admission_id, invocation_id, run_id, row[0])
        if response is None:
            return None
        return {"stepId": row[0], "response": response}

    def delete_model_response(self, admission_id: str) -> None:
        """Business purpose: Erase a temporary paid response after graph checkpoint acknowledgement.

        Business rules:
        - Delete only the selected admission's encrypted response, never another run's row.
        Execution flow:
        1. Delete the exact row.
        2. Commit the deletion.
        Failure cases:
        - SQLite write failure propagates so cleanup can be retried.
        Side effects:
        - Removes ciphertext from the active SQLite table.
        """
        # Why: Model outputs contain customer data and must not persist beyond their recovery need.
        # How: Erase the selected row once checkpoint persistence is confirmed.
        # Invariant: Deletion never changes server settlement state.
        with sqlite3.connect(self.db_path, timeout=10) as conn:
            conn.execute("DELETE FROM model_response_recovery WHERE admission_id = ?", (admission_id,))
            conn.commit()

    def purge_expired_model_responses(self) -> int:
        """Business purpose: Bound retention of encrypted paid answers after lost checkpoints.

        Business rules:
        - Expired content is purged independently of financial admission records.
        Execution flow:
        1. Compare persisted UTC expiry against current UTC time.
        2. Delete expired rows and return the count.
        Failure cases:
        - SQLite failure propagates for operational retry.
        Side effects:
        - Deletes expired ciphertext rows from worker-local SQLite.
        """
        # Why: A worker may never receive checkpoint acknowledgement after a crash.
        # How: Delete ciphertext once its bounded recovery TTL has elapsed.
        # Invariant: Financial receipts and capability reconciliation are unaffected.
        with sqlite3.connect(self.db_path, timeout=10) as conn:
            result = conn.execute(
                "DELETE FROM model_response_recovery WHERE expires_at <= ?",
                (datetime.now(timezone.utc).isoformat(),),
            )
            conn.commit()
            return result.rowcount

    def record_in_flight_admission(self, admission: dict[str, Any]) -> None:
        """Business purpose: Encrypt and persist in-flight capability recovery envelope before admission consume.

        Business rules:
        - Capability token must be encrypted using active keyring key with canonical AAD binding.
        - Raw token must never be written in plaintext to disk, WAL, or temp files.
        - Overwrites previous record for identical admission_id if re-admitted.

        Execution flow:
        1. Extract admission ID, invocation ID, and run ID.
        2. Compute canonical AAD binding bytes.
        3. Encrypt JSON payload using keyring.
        4. INSERT OR REPLACE into capability_recovery table with synchronous=FULL.
        5. Commit transaction.

        Failure cases:
        - Keyring encryption errors or SQLite I/O errors abort the operation and fail closed.

        Side effects:
        - Writes encrypted row to SQLite database and WAL file.
        """
        # Why: Preserve capability token across worker crash without exposing plaintext secrets on disk.
        # How: AEAD encrypt with active key and bind to admission/invocation/run identities via AAD.
        # Invariants: Executed strictly BEFORE consume_invocation_admission.
        admission_id = admission["admissionId"]
        invocation_id = admission["invocationId"]
        run_id = admission["runId"]

        aad = compute_recovery_aad("CAPABILITY_RECOVERY", admission_id, invocation_id, run_id)
        payload_bytes = json.dumps(admission, sort_keys=True).encode("utf-8")
        encrypted_json = self.keyring.encrypt_payload(payload_bytes, aad)

        with sqlite3.connect(self.db_path, timeout=10) as conn:
            conn.execute("PRAGMA synchronous=FULL")
            conn.execute(
                """
                INSERT OR REPLACE INTO capability_recovery (admission_id, invocation_id, run_id, encrypted_envelope)
                VALUES (?, ?, ?, ?)
                """,
                (admission_id, invocation_id, run_id, encrypted_json),
            )
            conn.commit()

    def get_in_flight_admission(self, admission_id: str) -> dict[str, Any] | None:
        """Business purpose: Retrieve and decrypt an in-flight capability envelope by admission ID.

        Business rules:
        - Reads encrypted envelope from SQLite table.
        - Recomputes AAD from stored admission, invocation, and run IDs.
        - Decrypts envelope using keyring; fails closed if tampered or corrupt.

        Execution flow:
        1. Query capability_recovery by admission_id.
        2. If row not found, return None.
        3. Compute AAD binding.
        4. Decrypt payload using keyring.
        5. Parse JSON and return admission dictionary.

        Failure cases:
        - Tampered ciphertext, bad tag, or missing key raises CorruptedEnvelopeError.

        Side effects:
        - Read-only SQLite query; no database state changes.
        """
        # Why: Recover capability envelope during crash recovery or key rotation.
        # How: Authenticate ciphertext and tag against row identities using active or retired key.
        # Invariants: Fails closed on any modification or unauthorized tampering.
        with sqlite3.connect(self.db_path, timeout=10) as conn:
            row = conn.execute(
                "SELECT admission_id, invocation_id, run_id, encrypted_envelope FROM capability_recovery WHERE admission_id = ?",
                (admission_id,),
            ).fetchone()

        if not row:
            return None

        adm_id, inv_id, run_id, enc_env = row
        aad = compute_recovery_aad("CAPABILITY_RECOVERY", adm_id, inv_id, run_id)
        decrypted_str = self.keyring.decrypt_payload(enc_env, aad)
        return json.loads(decrypted_str)

    def re_encrypt_envelope(self, admission_id: str) -> None:
        """Business purpose: Upgrade historical envelope encrypted with retired key to current active key.

        Business rules:
        - Decrypts record using historical key from retired keyring.
        - Re-encrypts payload using current active key.
        - Enables safe decommissioning of retired keys without data loss.

        Execution flow:
        1. Read and decrypt existing record via get_in_flight_admission().
        2. If present, re-write record via record_in_flight_admission() using active key.

        Failure cases:
        - Unrecognized key identifier or corrupted tag raises CorruptedEnvelopeError.

        Side effects:
        - Updates ciphertext and key ID (kid) in capability_recovery table.
        """
        # Why: Zero-downtime key rotation requires re-encrypting older envelopes before deleting retired keys.
        # How: Decrypt with historical key and re-encrypt with current active key.
        # Invariants: Preserves plaintext integrity and AAD binding.
        admission = self.get_in_flight_admission(admission_id)
        if admission is not None:
            self.record_in_flight_admission(admission)

    def record_usage_evidence(self, invocation_id: str, evidence: dict[str, Any]) -> None:
        """Business purpose: Durably commit token usage evidence for an invocation before settlement.

        Business rules:
        - Records reported input, output, and total token counts for an invocation.
        - Commits to SQLite with synchronous=FULL before calling /internal/billing/usage/settle.
        - Guarantees crash recovery knows exact completed token counts without re-dispatching model.

        Execution flow:
        1. Serialize evidence payload dictionary to JSON.
        2. Open SQLite connection with synchronous=FULL.
        3. INSERT OR REPLACE into invocation_usage_evidence table.
        4. Commit transaction.

        Failure cases:
        - SQLite disk full or permission errors propagate to caller.

        Side effects:
        - Persists token usage record in SQLite table on worker disk.
        """
        # Why: Prevent loss of usage evidence if worker crashes during or right before network settlement call.
        # How: Store token counts in dedicated SQLite table committed to disk.
        # Invariants: Must be durably committed before calling settlement endpoint.
        with sqlite3.connect(self.db_path, timeout=10) as conn:
            conn.execute("PRAGMA synchronous=FULL")
            conn.execute(
                """
                INSERT OR REPLACE INTO invocation_usage_evidence (invocation_id, evidence_payload)
                VALUES (?, ?)
                """,
                (invocation_id, json.dumps(evidence, sort_keys=True)),
            )
            conn.commit()

    def get_usage_evidence(self, invocation_id: str) -> dict[str, Any] | None:
        """Business purpose: Read committed usage evidence for a specific invocation ID.

        Business rules:
        - Looks up invocation_usage_evidence by invocation_id.
        - Returns parsed token evidence dictionary or None if absent.

        Execution flow:
        1. Query invocation_usage_evidence by invocation_id.
        2. If row not found, return None.
        3. Deserialize JSON string to dictionary and return.

        Failure cases:
        - SQLite read errors propagate to caller.

        Side effects:
        - Read-only SQLite query; no modifications.
        """
        # Why: Allows crash recovery sweeper to check if model finished and recorded usage before worker crashed.
        # How: Query invocation_usage_evidence table and deserialize payload.
        # Invariants: If present, worker reports COMPLETED; if absent, worker reports OUTCOME_UNKNOWN.
        with sqlite3.connect(self.db_path, timeout=10) as conn:
            row = conn.execute(
                "SELECT evidence_payload FROM invocation_usage_evidence WHERE invocation_id = ?",
                (invocation_id,),
            ).fetchone()
        if not row:
            return None
        return json.loads(row[0])

    def remove_admission_recovery(self, admission_id: str) -> None:
        """Business purpose: Remove admission recovery record from accessible set upon verified terminal settlement.

        Business rules:
        - Only invoked when authoritative server returns terminal acknowledgement (settled: true, slotReleased: true).
        - Deletes row from capability_recovery table.
        - Removal from accessible set ensures worker will not re-attempt settlement on reboot.

        Execution flow:
        1. Open SQLite connection with 10s timeout.
        2. Execute DELETE FROM capability_recovery WHERE admission_id = ?.
        3. Commit transaction.

        Failure cases:
        - SQLite write errors propagate to caller.

        Side effects:
        - Removes row from capability_recovery table in worker database.
        """
        # Why: Release local disk resources and prevent duplicate settlement calls after terminal release.
        # How: Execute targeted SQL DELETE by primary key admission_id.
        # Invariants: NEVER called when server response is non-terminal (settled: false).
        with sqlite3.connect(self.db_path, timeout=10) as conn:
            conn.execute("DELETE FROM capability_recovery WHERE admission_id = ?", (admission_id,))
            conn.commit()

    def list_all_admission_ids(self) -> list[str]:
        """Business purpose: List all in-flight admission IDs pending recovery or settlement.

        Business rules:
        - Reads all admission_id primary keys ordered chronologically by created_at.
        - Used by crash recovery sweeper on startup to discover in-flight invocations.

        Execution flow:
        1. Open SQLite connection.
        2. Execute SELECT admission_id FROM capability_recovery ORDER BY created_at.
        3. Return list of admission ID strings.

        Failure cases:
        - SQLite read errors propagate to caller.

        Side effects:
        - Read-only SQLite query; no modifications.
        """
        # Why: Enumerate all unfinished invocations requiring recovery after unexpected worker restart.
        # How: Query primary keys ordered by creation timestamp.
        # Invariants: Returns empty list if no in-flight admissions are stored.
        with sqlite3.connect(self.db_path, timeout=10) as conn:
            rows = conn.execute("SELECT admission_id FROM capability_recovery ORDER BY created_at").fetchall()
        return [r[0] for r in rows]


def extract_verified_token_evidence(usage_source: Any) -> dict[str, int] | None:
    """Business purpose: Extract and validate complete provider token usage evidence across normal and recovery paths.

    Business rules:
    - Both inputTokens (or input_tokens) and outputTokens (or output_tokens) must be explicitly present.
    - Token counts must be non-negative integers or numeric strings.
    - At least one token count must be strictly greater than 0.
    - Missing or malformed buckets return None to enforce OUTCOME_UNKNOWN routing and prevent underbilling.

    Execution flow:
    1. Inspect dict or response object for input and output token keys.
    2. Validate types and value constraints (non-negative integers).
    3. Calculate total tokens as sum or provided total.
    4. Flatten nested containers and extract priced cache and reasoning token buckets.
    5. Return normalized dictionary or None if incomplete.

    Failure cases:
    - Missing fields, None values, negative numbers, or non-integer types return None.

    Side effects:
    - Pure computation; no database or network side effects.
    """
    # Why: Prevent underbilling where omitted provider tokens default to 0 and get settled as COMPLETED.
    # How: Require explicit presence of both input and output buckets as non-negative ints with total > 0.
    # Invariants & Constraints: Incomplete or ambiguous evidence returns None -> routes to OUTCOME_UNKNOWN.
    if not isinstance(usage_source, dict):
        if hasattr(usage_source, "usage_metadata") or hasattr(usage_source, "response_metadata"):
            usage_dict = getattr(usage_source, "usage_metadata", None)
            resp_meta = getattr(usage_source, "response_metadata", None)
            combined: dict[str, Any] = {}
            if isinstance(usage_dict, dict):
                combined.update(usage_dict)
            if isinstance(resp_meta, dict):
                tok_usage = resp_meta.get("token_usage") or resp_meta.get("usage")
                if isinstance(tok_usage, dict):
                    combined.update(tok_usage)
                else:
                    combined.update(resp_meta)
            usage_source = combined
        else:
            return None

    raw_input = usage_source.get("input_tokens") if "input_tokens" in usage_source else usage_source.get("inputTokens")
    raw_output = usage_source.get("output_tokens") if "output_tokens" in usage_source else usage_source.get("outputTokens")

    if raw_input is None or raw_output is None:
        return None
    if isinstance(raw_input, bool) or isinstance(raw_output, bool):
        return None

    parsed_input: int | None = None
    if isinstance(raw_input, int) and raw_input >= 0:
        parsed_input = raw_input
    elif isinstance(raw_input, str) and raw_input.strip().isdigit():
        parsed_input = int(raw_input.strip())
    else:
        return None

    parsed_output: int | None = None
    if isinstance(raw_output, int) and raw_output >= 0:
        parsed_output = raw_output
    elif isinstance(raw_output, str) and raw_output.strip().isdigit():
        parsed_output = int(raw_output.strip())
    else:
        return None

    if parsed_input == 0 and parsed_output == 0:
        return None

    raw_total = usage_source.get("total_tokens") if "total_tokens" in usage_source else usage_source.get("totalTokens")
    parsed_total: int | None = None
    if raw_total is not None and not isinstance(raw_total, bool):
        if isinstance(raw_total, int) and raw_total >= 0:
            parsed_total = raw_total
        elif isinstance(raw_total, str) and raw_total.strip().isdigit():
            parsed_total = int(raw_total.strip())

    if parsed_total is not None and parsed_total >= (parsed_input + parsed_output):
        total_tokens = parsed_total
    else:
        total_tokens = parsed_input + parsed_output

    evidence: dict[str, int] = {
        "inputTokens": parsed_input,
        "outputTokens": parsed_output,
        "totalTokens": total_tokens,
    }

    # Rationale ("Why"): Unpack all nested token detail containers so priced buckets are not silently dropped.
    # Mechanism ("How"): Flatten response_metadata, token_usage, details, and nested input/output token detail dicts.
    # Invariants & Constraints: Keeps only non-negative numeric bucket values.
    flat_meta = dict(usage_source)
    for container_key in (
        "response_metadata",
        "token_usage",
        "usage",
        "usage_metadata",
        "details",
        "input_token_details",
        "output_token_details",
        "prompt_tokens_details",
        "completion_tokens_details",
        "cache_creation",
    ):
        sub = flat_meta.get(container_key)
        if isinstance(sub, dict):
            flat_meta.update(sub)
            for inner_k in (
                "token_usage",
                "usage",
                "details",
                "prompt_tokens_details",
                "completion_tokens_details",
                "input_token_details",
                "output_token_details",
            ):
                inner_sub = sub.get(inner_k)
                if isinstance(inner_sub, dict):
                    flat_meta.update(inner_sub)

    # Extract priced token buckets from flattened metadata
    bucket_definitions = (
        (
            "cachedInputTokens",
            (
                "cachedInputTokens",
                "cached_input_tokens",
                "cache_read_input_tokens",
                "cache_read",
                "cached_tokens",
                "cache_read_tokens",
                "cached_content_token_count",
                "cachedContentTokenCount",
            ),
        ),
        (
            "cacheWriteTokens",
            (
                "cacheWriteTokens",
                "cache_creation_input_tokens",
                "cache_write_input_tokens",
                "cache_creation",
                "cache_creation_tokens",
                "cache_write_tokens",
                "cacheWriteTokenCount",
            ),
        ),
        (
            "reasoningTokens",
            (
                "reasoningTokens",
                "reasoning_tokens",
                "reasoning",
                "thoughts_token_count",
                "thoughtsTokenCount",
                "reasoningTokenCount",
            ),
        ),
    )
    for target_key, candidate_keys in bucket_definitions:
        for k in candidate_keys:
            if k in flat_meta:
                v = flat_meta[k]
                if v is not None and not isinstance(v, bool):
                    v_int: int | None = None
                    if isinstance(v, int) and v >= 0:
                        v_int = v
                    elif isinstance(v, str) and v.strip().isdigit():
                        v_int = int(v.strip())
                    if v_int is not None:
                        evidence[target_key] = v_int
                        break

    # Invariant: Priced cache tokens cannot exceed total tokens in verified evidence
    if evidence.get("cachedInputTokens", 0) > evidence["totalTokens"]:
        return None

    return evidence


def recover_in_flight_capabilities(
    db_path: str | Path, keyring: WorkerEnvelopeKeyring, api_client: Any
) -> list[dict]:
    """Business purpose: Recover in-flight capabilities after crash and settle with authoritative billing API without model redispatch.

    Business rules:
    - Iterates over all pending in-flight admissions in local SQLite store.
    - If durable usage evidence is verified complete, reports providerCompletionState: COMPLETED with exact token counts.
    - If crash occurred between envelope write and consume (ADMITTED state, no usage evidence), safely cancels admission via /internal/billing/admission/cancel.
    - If cancellation succeeds (CONFIRMED_NO_USAGE), deletes envelope from SQLite store.
    - If cancellation returns 409 Conflict (consume already executed), reports providerCompletionState: OUTCOME_UNKNOWN and retains envelope.
    - If crash occurred after consume or evidence is partial, reports providerCompletionState: OUTCOME_UNKNOWN.
    - Guarantees zero redispatch of downstream provider model.
    - Only deletes admission envelope from store when server returns terminal confirmation (settled: true, slotReleased: true) or cancel succeeds.
    - If server returns non-terminal response (settled: false), retains envelope for audit/reconciliation.

    Execution flow:
    1. Initialize CapabilityRecoveryStore with db_path and keyring.
    2. Enumerate all pending admission IDs.
    3. For each admission, decrypt capability envelope.
    4. Check for verified complete token usage evidence via extract_verified_token_evidence().
    5. If evidence verified: call settle_invocation_usage(COMPLETED).
    6. If no usage evidence exists: attempt cancel_invocation_admission(). If 200 OK, delete envelope; if 409 Conflict, fall back to settle_invocation_usage(OUTCOME_UNKNOWN) and retain envelope.
    7. Return list of settlement and cancellation responses.

    Failure cases:
    - Transport or non-conflict API errors propagate to caller (fail closed).
    - Corrupted envelope fails closed via CorruptedEnvelopeError.

    Side effects:
    - Calls POST /internal/billing/admission/cancel or POST /internal/billing/usage/settle on authoritative API.
    - Deletes settled/cancelled envelopes from local SQLite recovery store.
    """
    # Why: Resolve leaked admission slots and record accurate billable usage after worker crash.
    # How: Sweep SQLite store, decrypt capabilities, inspect usage evidence, and invoke cancel or settlement API.
    # Invariants: 0 provider redispatches; never fabricates usage tokens for unknown outcomes.
    store = CapabilityRecoveryStore(db_path, keyring)
    results = []
    admission_ids = store.list_all_admission_ids()

    for adm_id in admission_ids:
        admission = store.get_in_flight_admission(adm_id)
        if not admission:
            continue

        inv_id = admission["invocationId"]
        cap_token = admission["capabilityToken"]
        attempt_ordinal = admission.get("attemptOrdinal", 1)

        raw_usage = store.get_usage_evidence(inv_id)
        verified_evidence = extract_verified_token_evidence(raw_usage)
        # Why: A crash must not drop the exact tool-call causation IDs pinned by live settlement.
        # How: Preserve only bounded canonical IDs from the durable usage record.
        # Invariant: Invalid IDs cannot be silently omitted from an otherwise COMPLETED receipt.
        if verified_evidence is not None and isinstance(raw_usage, dict) and "toolCallIds" in raw_usage:
            tool_ids = raw_usage["toolCallIds"]
            if (
                not isinstance(tool_ids, list)
                or len(tool_ids) > 64
                or any(not isinstance(value, str) or not 1 <= len(value) <= 200 or re.fullmatch(r"[!-~]+", value) is None for value in tool_ids)
                or tool_ids != sorted(set(tool_ids))
            ):
                verified_evidence = None
            else:
                verified_evidence["toolCallIds"] = tool_ids
        if verified_evidence is not None:
            # Complete verified usage evidence: report COMPLETED with all priced token buckets
            settle_payload = {
                "admissionId": adm_id,
                "invocationId": inv_id,
                "capabilityToken": cap_token,
                "attemptOrdinal": attempt_ordinal,
                "providerCompletionState": "COMPLETED",
                **verified_evidence,
            }
            response = api_client.settle_invocation_usage(settle_payload)
            results.append(response)

            # Invariant: Only remove from recovery store on terminal confirmation
            if response.get("settled") is True and response.get("slotReleased") is True:
                # Why: The worker may have crashed after writing the answer but before receiving settlement.
                # How: Promote only this admission's authenticated response after the server confirms terminal.
                # Invariant: Unknown outcomes retain the slot and cannot make a response replayable.
                pending = store.get_pending_model_response_record(adm_id, inv_id, admission["runId"])
                if pending is not None:
                    if response.get("debitMode") == "ON" and response.get("paymentRequired") is True:
                        from middleware.usage_metering import stamp_server_payment_decision_in_recovery_payload

                        stamped = stamp_server_payment_decision_in_recovery_payload(pending["response"], True)
                        store.update_model_response_before_terminal(
                            adm_id, inv_id, admission["runId"], pending["stepId"], stamped,
                        )
                    store.mark_model_response_terminal(adm_id)
                store.remove_admission_recovery(adm_id)
        else:
            # Absence of verified usage evidence:
            # Could the crash have occurred between writing envelope and atomic CAS consume?
            # If so, server state is still ADMITTED. Attempt safe cancellation first.
            cancel_success = False
            if raw_usage is None and hasattr(api_client, "cancel_invocation_admission"):
                cancel_payload = {
                    "admissionId": adm_id,
                    "invocationId": inv_id,
                    "capabilityToken": cap_token,
                    "cancellationReason": "WORKER_CRASH_RECOVERY_NO_USAGE",
                }
                try:
                    cancel_resp = api_client.cancel_invocation_admission(cancel_payload)
                    if isinstance(cancel_resp, dict) and cancel_resp.get("state") == "CONFIRMED_NO_USAGE" and cancel_resp.get("slotReleased") is True:
                        results.append(cancel_resp)
                        store.remove_admission_recovery(adm_id)
                        cancel_success = True
                except Exception as exc:
                    # Rationale ("Why"): Only treat HTTP 409 as an in-flight race when error_code confirms
                    # the admission has already transitioned to IN_FLIGHT.
                    # Mechanism ("How"): Sweeper checks status_code == 409 and error_code against BILLING_ADMISSION_ALREADY_IN_FLIGHT.
                    # Invariants & Constraints: All other 409 codes (e.g. BILLING_CONCURRENCY_LIMIT_REACHED) or non-409 errors
                    # must fail closed and re-raise.
                    status = getattr(exc, "status_code", None)
                    code = getattr(exc, "error_code", None)
                    is_already_in_flight = (
                        status == 409
                        and code in {
                            "BILLING_ADMISSION_ALREADY_IN_FLIGHT",
                            "admissionAlreadyInFlight",
                        }
                    )
                    if not is_already_in_flight:
                        # Non-in-flight error (e.g. concurrency limit, network failure, auth error) must fail closed
                        raise

            if not cancel_success:
                # Consume already occurred (IN_FLIGHT on server) or evidence was partial/corrupted:
                # Report OUTCOME_UNKNOWN and retain envelope in store for admin reconciliation
                settle_payload = {
                    "admissionId": adm_id,
                    "invocationId": inv_id,
                    "capabilityToken": cap_token,
                    "attemptOrdinal": attempt_ordinal,
                    "providerCompletionState": "OUTCOME_UNKNOWN",
                }
                response = api_client.settle_invocation_usage(settle_payload)
                results.append(response)

                # OUTCOME_UNKNOWN returns settled: false, slotReleased: false -> RETAINS envelope
                if response.get("settled") is True and response.get("slotReleased") is True:
                    store.remove_admission_recovery(adm_id)

    return results


def sweep_and_recover_capabilities_on_startup(
    api_client: Any | None = None,
    db_path: str | Path | None = None,
    keyring: WorkerEnvelopeKeyring | None = None,
) -> list[dict]:
    """Business purpose: Sweep and settle all in-flight capability recovery envelopes upon worker process startup.

    Business rules:
    - Executed before worker accepts or processes new incoming tasks.
    - Resolves keyring from environment or injected parameter; fails closed if missing or corrupt.
    - Resolves worker API client from environment if not provided; fails closed if unconfigured.
    - Calls recover_in_flight_capabilities() to settle in-flight envelopes and clear orphaned locks.

    Execution flow:
    1. Resolve keyring from parameter or WorkerEnvelopeKeyring.from_env().
    2. Resolve db_path from parameter or WORKER_RECOVERY_DB_PATH.
    3. Resolve api_client from parameter or WorkerApiClient.
    4. Invoke recover_in_flight_capabilities().
    5. Return list of recovery settlement results.

    Failure cases:
    - Missing or unconfigured key raises EnvelopeCryptoStartupError.
    - Missing API client credentials raises RuntimeError.
    - Corrupted envelope or database failure raises CorruptedEnvelopeError.

    Side effects:
    - Calls /internal/billing/usage/settle for pending admissions and updates SQLite recovery store.
    """
    # Why: Recover capability envelopes leaked by worker crash before accepting new jobs.
    # How: Sweeps recovery SQLite database, decrypts in-flight envelopes, and settles with server.
    # Invariants: Model is never redispatched; zero new tasks processed until recovery finishes.
    import os

    if keyring is None:
        key = os.environ.get("WORKER_ENVELOPE_ENCRYPTION_KEY")
        if not key or not key.strip():
            raise EnvelopeCryptoStartupError("Missing required WORKER_ENVELOPE_ENCRYPTION_KEY for startup capability recovery")
        keyring = WorkerEnvelopeKeyring.from_env()

    if db_path is None:
        db_path = os.environ.get("WORKER_RECOVERY_DB_PATH", ".data/worker_recovery.db")

    if api_client is None:
        from tools.common.capabilities.platform.api_client import WorkerApiClient
        base_url = os.environ.get("LCSP_API_BASE_URL", "http://127.0.0.1:3000")
        api_key = os.environ.get("LCSP_WORKER_API_KEY", "")
        if not api_key or not api_key.strip():
            raise RuntimeError("Missing required LCSP_WORKER_API_KEY for startup capability recovery")
        api_client = WorkerApiClient(base_url, api_key)

    return recover_in_flight_capabilities(db_path, keyring, api_client)
