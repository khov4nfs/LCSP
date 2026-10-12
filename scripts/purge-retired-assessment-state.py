"""One-off RELEASE release operation, never imported or packaged into the runtime.

Run before the ordered drop, against a quiesced target with its CUTOVER ledger intact.
Only archived identities authorize erasure; canonical pins/threads/files win.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from datetime import datetime
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit
from uuid import UUID, uuid5

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

CHECKPOINT_TABLES = ("checkpoints", "checkpoint_blobs", "checkpoint_writes")
HOST_THREAD_NAMESPACE = UUID("b7b26975-09de-44e5-a7d5-c996523fd289")


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def connection_url(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise ValueError("PostgreSQL URL required")
    return urlunsplit(parsed._replace(query=urlencode([
        (key, item) for key, item in parse_qsl(parsed.query) if key != "schema"
    ])))


def archive_fingerprint(conn) -> dict:
    return conn.execute('SELECT count(*)::int AS count, encode(sha256(convert_to(coalesce('
                        'string_agg("sourceTable"::text || \':\' || "sourceId" || \':\' || '
                        '"payloadSha256", E\'\\n\' ORDER BY "sourceTable"::text COLLATE "C", '
                        '"sourceId" COLLATE "C"),\'\'),\'UTF8\')),\'hex\') AS sha256 '
                        'FROM "LegacyArchiveRecord"').fetchone()


def thread_owned(thread: str, parents: set[str]) -> bool:
    # V1's removed nested saver used parent:logicalRunId:sha256; V2 tasks use
    # checkpoint namespaces under the same server-owned Root thread.
    return any(thread == parent or thread.startswith(parent + ":") for parent in parents)


def classify_threads(threads: set[str], legacy: set[str], canonical: set[str]) -> set[str]:
    if any(thread_owned(thread, legacy) for thread in canonical):
        raise ValueError("V1/V2 thread ownership overlaps")
    targets = {thread for thread in threads if thread_owned(thread, legacy)}
    if any(thread_owned(thread, canonical) for thread in targets):
        raise ValueError("V1/V2 thread ownership overlaps")
    if any(not thread_owned(thread, legacy | canonical) for thread in threads):
        raise ValueError("unclassified checkpoint identity; no erasure is authorized")
    return targets


def canonical_artifact_paths(storage: Path, refs: list[str]) -> set[Path]:
    paths = set()
    for ref in refs:
        manifest = json.loads(ref)
        if (set(manifest) != {"artifact_id", "total_size", "hash", "chunks"}
                or not re.fullmatch(r"[a-f0-9]{64}", manifest.get("hash", ""))
                or manifest.get("chunks") != [manifest["hash"] + ".chunk"]
                or type(manifest.get("total_size")) is not int or manifest["total_size"] < 0):
            raise ValueError("unclassified canonical artifact identity")
        UUID(manifest["artifact_id"])
        paths.add(safe_path(storage, "chunks/" + manifest["chunks"][0]))
    return paths


def mixed_checkpoint_targets(rows: list[dict], before: datetime, assessment_id: str) -> list[dict]:
    targets = []
    for row in rows:
        metadata = row["metadata"]
        if (metadata.get("lcsp_boundary_name") == "assessment_root_requested"
                and metadata.get("assessment_id") == assessment_id):
            continue
        timestamp = datetime.fromisoformat(row["checkpoint"].get("ts", ""))
        if timestamp.tzinfo is None or timestamp > before:
            raise ValueError("unclassified mixed checkpoint identity")
        targets.append(row)
    return targets


def mixed_checkpoints(conn, mixed: dict[str, str], before: datetime) -> list[dict]:
    if not conn.execute("SELECT to_regclass('checkpoints') AS relation").fetchone()["relation"]:
        return []
    targets = []
    for thread, assessment in mixed.items():
        # JSON metadata and channel version identities suffice; never deserialize/log customer blobs.
        rows = list(conn.execute("SELECT thread_id, checkpoint_ns, checkpoint_id, checkpoint, metadata "
                                 "FROM checkpoints WHERE thread_id=%s OR thread_id LIKE %s", (thread, thread + ":%")))
        for table, reference in (
            ("checkpoint_writes", "c.checkpoint_id=b.checkpoint_id"),
            ("checkpoint_blobs", "c.checkpoint->'channel_versions'->>b.channel=b.version"),
        ):
            if conn.execute(sql.SQL("SELECT 1 FROM {} b WHERE (b.thread_id=%s OR b.thread_id LIKE %s) "
                            "AND NOT EXISTS (SELECT 1 FROM checkpoints c WHERE c.thread_id=b.thread_id "
                            "AND c.checkpoint_ns=b.checkpoint_ns AND {}) LIMIT 1").format(
                                sql.Identifier(table), sql.SQL(reference)), (thread, thread + ":%")).fetchone():
                raise ValueError("unclassified orphan state in mixed checkpoint namespace")
        targets.extend(mixed_checkpoint_targets(rows, before, assessment))
    return targets


def erase_mixed_checkpoints(conn, targets: list[dict]) -> None:
    for row in targets:
        key = (row["thread_id"], row["checkpoint_ns"], row["checkpoint_id"])
        conn.execute("DELETE FROM checkpoint_writes WHERE thread_id=%s AND checkpoint_ns=%s AND checkpoint_id=%s", key)
        conn.execute("DELETE FROM checkpoints WHERE thread_id=%s AND checkpoint_ns=%s AND checkpoint_id=%s", key)
    for row in targets:
        for channel, version in row["checkpoint"]["channel_versions"].items():
            conn.execute("DELETE FROM checkpoint_blobs b WHERE thread_id=%s AND checkpoint_ns=%s AND channel=%s "
                         "AND version=%s AND NOT EXISTS (SELECT 1 FROM checkpoints c WHERE c.thread_id=b.thread_id "
                         "AND c.checkpoint_ns=b.checkpoint_ns AND c.checkpoint->'channel_versions'->>b.channel=b.version)",
                         (row["thread_id"], row["checkpoint_ns"], channel, str(version)))


def retained_log_bytes(content: bytes, before: datetime) -> bytes:
    """Separate pre-cutover V1 log records, including their multiline continuations."""
    kept = []
    current_timestamp = None
    for line in content.decode("utf-8").splitlines(keepends=True):
        timestamp = None
        if line.startswith("["):
            match = re.match(r"^\[([0-9T:.+Z-]+)\]", line)
            if match:
                timestamp = match.group(1)
        elif line.lstrip().startswith("{"):
            try:
                row = json.loads(line)
                timestamp = row.get("timestamp") if isinstance(row, dict) else None
            except json.JSONDecodeError:
                pass
        if timestamp is not None:
            current_timestamp = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            if current_timestamp.tzinfo is None:
                raise ValueError("unclassified private log timestamp")
        if current_timestamp is None:
            raise ValueError("unclassified private log record")
        if current_timestamp > before:
            kept.append(line)
    return "".join(kept).encode("utf-8")


def safe_path(root: Path, relative: str) -> Path:
    root = root.absolute()
    parts = Path(relative).parts
    if not parts or Path(relative).is_absolute() or any(part in {"..", "."} for part in parts):
        raise ValueError("unsafe erasure path")
    candidate = root.joinpath(*parts)
    for item in (root, *root.parents, *[root.joinpath(*parts[:i]) for i in range(1, len(parts) + 1)]):
        if item.is_symlink():
            raise ValueError("symlink in erasure path")
    if root.resolve() not in candidate.resolve().parents:
        raise ValueError("erasure path escapes its authorized root")
    return candidate


def verify_file(path: Path, sha256: str, size: int) -> None:
    if not re.fullmatch(r"[a-f0-9]{64}", sha256) or size < 0:
        raise ValueError("invalid archived artifact identity")
    if not path.exists():
        return  # Restart after an interrupted erase is safe.
    if not path.is_file() or path.stat().st_size != size:
        raise ValueError("archived artifact size/type mismatch")
    with path.open("rb") as source:
        actual = hashlib.file_digest(source, "sha256").hexdigest()
    if actual != sha256:
        raise ValueError("archived artifact hash mismatch")


def docker(*args: str) -> str:
    result = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=30)
    if result.returncode:
        # Docker errors can include mounts or credentials; never print them.
        raise RuntimeError("Docker operation failed")
    return result.stdout


def sandbox_targets(containers: list[dict], legacy: set[str], canonical: set[str]) -> list[str]:
    old = {hashlib.sha256(thread.encode()).hexdigest() for thread in legacy}
    protected = {hashlib.sha256(thread.encode()).hexdigest() for thread in canonical}
    targets = []
    for container in containers:
        labels = container.get("Config", {}).get("Labels") or {}
        thread_hash = labels.get("lcsp.thread-id")
        if thread_hash in protected:
            continue
        if labels.get("lcsp.repository-sandbox") != "true" or thread_hash not in old:
            raise ValueError("unclassified repository sandbox identity")
        if container.get("Name", "").lstrip("/") != "lcsp-repository-sandbox-" + thread_hash[:24]:
            raise ValueError("repository sandbox name/label mismatch")
        if container.get("Mounts"):
            raise ValueError("repository sandbox has persistent mounts; classify their ownership first")
        targets.append(container["Id"])
    return sorted(targets)


def sandbox_filters(fixture_run_id: str | None, database: str, checkpoint_database: str, run: dict | None) -> tuple[str, ...]:
    filters = ("--filter", "label=lcsp.repository-sandbox=true")
    if fixture_run_id is None:
        return filters
    identity = str(UUID(fixture_run_id))
    if (database != "retirement_upgrade" or checkpoint_database != "retirement_checkpoints" or not run
            or str(run["id"]) != identity or run["toolVersion"] != "SYNTHETIC_POST_CUTOVER_FIXTURE"
            or run["phaseResults"].get("fixtureOnly") is not True):
        raise ValueError("sandbox fixture scope requires the matching synthetic disposable cutover")
    return (*filters, "--filter", "label=lcsp.release-fixture-run=" + identity)


def check_database(conn, expected: str) -> None:
    if conn.execute("SELECT current_database()").fetchone()["current_database"] != expected:
        raise ValueError("database identity mismatch")


def checkpoint_threads(conn) -> set[str]:
    threads: set[str] = set()
    for table in CHECKPOINT_TABLES:
        if conn.execute("SELECT to_regclass(%s) AS relation", (table,)).fetchone()["relation"]:
            conn.execute(sql.SQL("LOCK TABLE {} IN SHARE ROW EXCLUSIVE MODE").format(sql.Identifier(table)))
            threads.update(row["thread_id"] for row in conn.execute(
                sql.SQL("SELECT DISTINCT thread_id FROM {}").format(sql.Identifier(table))
            ))
    return threads


def load_inventory(conn, run_id: str, storage: Path, workspaces: Path, artifact_roots: list[Path],
                   private_logs: Path, corpus_root: Path):
    for table in ("AssessmentRuntime", "AssessmentRuntimeTurn", "AssessmentCase", "AssessmentArtifact",
                  "RepositoryScanJob", "OutboxMessage", "LegalPreparationRun",
                  "LegacyArchiveRecord", "LegacyArchiveBlob", "LegacyMigrationRun"):
        conn.execute(sql.SQL("LOCK TABLE {} IN SHARE ROW EXCLUSIVE MODE").format(sql.Identifier(table)))
    run = conn.execute('SELECT * FROM "LegacyMigrationRun" WHERE id=%s::uuid FOR UPDATE', (run_id,)).fetchone()
    if not run or run["kind"] != "CUTOVER" or run["status"] != "COMPLETED" or not run["restorePointVerifiedAt"]:
        raise ValueError("completed verified CUTOVER cutover receipt is required")
    if run["phaseResults"].get("VALIDATE", {}).get("summary", {}).get("blockingFailures") != 0:
        raise ValueError("CUTOVER reconciliation did not pass")
    if conn.execute('SELECT 1 FROM "AssessmentRuntimeTurn" WHERE state IN '
                    "('RUNNING','STOP_REQUESTED','RESUME_REQUESTED') LIMIT 1").fetchone():
        raise ValueError("all runtime writers must be quiesced")
    if conn.execute('SELECT 1 FROM "AssessmentRuntime" WHERE "executionState"=\'RUNNING\' LIMIT 1').fetchone():
        raise ValueError("canonical assessment execution must be quiesced")
    if conn.execute('SELECT 1 FROM "LegalPreparationRun" WHERE "executionState"=\'RUNNING\' LIMIT 1').fetchone():
        raise ValueError("legal preparation execution must be quiesced")
    records = list(conn.execute('SELECT "sourceTable", "sourceId", payload, payload::text AS text, '
                               '"payloadSha256" FROM "LegacyArchiveRecord" ORDER BY "sourceTable", "sourceId"'))
    if any(hashlib.sha256(row["text"].encode()).hexdigest() != row["payloadSha256"] for row in records):
        raise ValueError("CUTOVER archive payload hash mismatch")
    legacy: set[str] = set()
    jobs: set[str] = set()
    files: dict[Path, tuple[str, int]] = {}
    runtimes = list(conn.execute('SELECT "assessmentId", "threadId" FROM "AssessmentRuntime"'))
    canonical = {str(row["threadId"]) for row in runtimes}
    mixed = {str(uuid5(HOST_THREAD_NAMESPACE, "assessment:" + row["assessmentId"])): row["assessmentId"] for row in runtimes}
    canonical.update(mixed)
    canonical.update(str(uuid5(HOST_THREAD_NAMESPACE, "event:legal_portfolio_preparation_requested:" + row["correlationId"]))
                     for row in conn.execute('SELECT "correlationId" FROM "LegalPreparationRun"'))
    canonical.update(row["threadId"] for row in conn.execute(
        'SELECT "threadId" FROM "AssessmentRuntimeTurn" WHERE boundary=\'ASSESSMENT_ROOT\''))
    from tools.common.capabilities.agent_runtime.agent_server_client import agent_thread_id
    from tools.common.capabilities.agent_runtime.invocation import invocation_boundary_manifest

    boundaries = {item["source_event"]: item["name"] for item in invocation_boundary_manifest()}
    messages = list(conn.execute('SELECT "eventType", payload, payload->>\'correlationId\' AS "correlationId" FROM "OutboxMessage"'))
    for row in messages:
        if row["eventType"] in boundaries:
            if not isinstance(row["correlationId"], str) or not row["correlationId"]:
                raise ValueError("canonical outbox lacks transport correlation identity")
            canonical.add(agent_thread_id(boundaries[row["eventType"]], row["payload"], row["correlationId"]))
        elif row["eventType"] == "command.legal-corpus.recovery.requested.v1":
            if not isinstance(row["correlationId"], str) or not row["correlationId"]:
                raise ValueError("obsolete acquisition outbox lacks transport identity")
            legacy.add(agent_thread_id("legal_corpus_recovery_requested", row["payload"], row["correlationId"]))
    protected_files = canonical_artifact_paths(storage, [row["storageRef"] for row in conn.execute(
        'SELECT "storageRef" FROM "AssessmentArtifact" WHERE "storageRef" IS NOT NULL')])
    roots = [storage, *artifact_roots]

    def add_file(path: Path, identity: tuple[str, int]):
        if path in protected_files:
            raise ValueError("V1 artifact overlaps canonical artifact storage")
        if path in files and files[path] != identity:
            raise ValueError("conflicting archived file identity")
        verify_file(path, *identity)
        files[path] = identity

    blobs = {str(row["recordId"]): row for row in conn.execute('SELECT * FROM "LegacyArchiveBlob"')}
    document_rows = conn.execute('SELECT id::text, "sourceId" FROM "LegacyArchiveRecord" '
                                'WHERE "sourceTable"=\'DOCUMENT_REQUEST\'')
    document_blobs = {row["sourceId"]: blobs.get(row["id"]) for row in document_rows}
    for blob in blobs.values():
        ref = blob["storageRef"]
        if ref != f'legacy-archive/{blob["contentSha256"]}.blob':
            raise ValueError("unexpected legacy blob storage reference")
        add_file(safe_path(storage, ref), (blob["contentSha256"], blob["sizeBytes"]))
    archive_directory = safe_path(storage, "legacy-archive")
    if archive_directory.exists():
        for entry in archive_directory.iterdir():
            if not re.fullmatch(r"[a-f0-9]{64}\.blob", entry.name):
                raise ValueError("unclassified legacy archive file")
            path = safe_path(storage, "legacy-archive/" + entry.name)
            add_file(path, (entry.stem, path.stat().st_size))
    for row in records:
        source, identity, payload = row["sourceTable"], row["sourceId"], row["payload"]
        if source == "ASSESSMENT_RUNTIME_TURN":
            if payload.get("boundary") == "ASSESSMENT_ROOT" or not payload.get("threadId"):
                raise ValueError("archive contains ambiguous runtime ownership")
            legacy.add(payload["threadId"])
        elif source == "ASSESSMENT":
            # The V1 bridge's deterministic outer thread predates AssessmentRuntime.
            legacy.add(str(uuid5(HOST_THREAD_NAMESPACE, "assessment:" + identity)))
        elif source == "REPOSITORY_SCAN_JOB":
            # Canonical hydration uses a fresh TemporaryDirectory, never the V1 job workspace.
            jobs.add(identity)
        elif source == "FILESYSTEM_ARTIFACT":
            label, relative = identity.split(":", 1)
            matches = [root for root in artifact_roots if root.name == label]
            if len(matches) != 1 or payload.get("relativePath") != relative:
                raise ValueError("archived cache/bundle root is not uniquely supplied")
            add_file(safe_path(matches[0], relative), (payload["sha256"], payload["sizeBytes"]))
        elif source == "DOCUMENT_REQUEST" and payload.get("documentUrl"):
            reference = urlsplit(payload["documentUrl"])
            if reference.scheme == "file":
                if reference.netloc not in {"", "localhost"}:
                    raise ValueError("nonlocal historical report needs storage-owner erasure proof")
                path = Path(unquote(reference.path)).absolute()
                candidates = [root for root in roots if root.absolute() in path.parents]
                if len(candidates) != 1:
                    raise ValueError("historical report is outside the supplied erasure roots")
                path = safe_path(candidates[0], str(path.relative_to(candidates[0].absolute())))
                blob = document_blobs[identity]
                if path.exists() and not blob:
                    raise ValueError("persisted historical report lacks verified CUTOVER bytes")
                if blob:
                    add_file(path, (blob["contentSha256"], blob["sizeBytes"]))
            elif reference.scheme in {"http", "https"} and document_blobs[identity]:
                raise ValueError("remote historical report needs storage-owner erasure proof")
    directories = [safe_path(workspaces, identity) for identity in sorted(jobs)]
    directories.append(archive_directory)
    if any(path.exists() and not path.is_dir() for path in directories):
        raise ValueError("historical workspace is not a directory")
    rewrites = {}
    for row in records:
        if row["sourceTable"] != "ASSESSMENT":
            continue
        identity = row["sourceId"]
        owner = row["payload"].get("ownerId")
        if not isinstance(owner, str):
            raise ValueError("archived assessment has no log owner")
        for user in (owner, "unknown_user"):
            directory = safe_path(private_logs, f"user_{user}/assessment_{identity}")
            if not directory.exists():
                continue
            if not directory.is_dir():
                raise ValueError("unclassified private log directory")
            if identity not in mixed.values():
                directories.append(directory)
                continue
            for entry in directory.iterdir():
                path = safe_path(private_logs, str(entry.relative_to(private_logs)))
                if entry.name == "graphs":
                    directories.append(path)  # Removed V1 graph exporter was its sole writer.
                elif entry.name in {"run.log", "orchestration.log"} and path.is_file():
                    rewrites[path] = retained_log_bytes(path.read_bytes(), run["startedAt"])
                else:
                    raise ValueError("unclassified mixed assessment-private file")
    # This cache and per-rule mirror have no V2 producer, reader or semantic authority.
    directories.append(safe_path(corpus_root, "recovery-artifacts"))
    mirror = safe_path(private_logs, "llm-tool-calls.log")
    if mirror.exists():
        with mirror.open("rb") as source:
            mirror_hash = hashlib.file_digest(source, "sha256").hexdigest()
        add_file(mirror, (mirror_hash, mirror.stat().st_size))
    known_assessments = set(mixed.values()) | {
        row["sourceId"] for row in records if row["sourceTable"] == "ASSESSMENT"
    }
    for directory in private_logs.glob("user_*/assessment_*"):
        if directory.name.removeprefix("assessment_") not in known_assessments:
            raise ValueError("unclassified assessment-private log identity")

    # Archived identities remain available for restart; this digest describes
    # the current erasure inventory, not a second semantic or retention authority.
    manifest = {
        "records": [(row["sourceTable"], row["sourceId"], row["payloadSha256"]) for row in records],
        "legacyThreads": sorted(legacy), "canonicalThreads": sorted(canonical),
        "files": [(str(path), *value) for path, value in sorted(files.items())],
        "workspaces": [str(path) for path in directories],
        "mixedLogs": sorted(str(path) for path in rewrites), "protectedArtifacts": sorted(str(path) for path in protected_files),
    }
    # The deterministic transport identity was reused by V2: separate its history,
    # while keeping the independent server-owned Root checkpoint namespace intact.
    return legacy - set(mixed), canonical, files, directories, digest(manifest), mixed, run["startedAt"], rewrites


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-name", required=True)
    parser.add_argument("--checkpoint-database-name", required=True)
    parser.add_argument("--run-id", required=True, type=UUID)
    parser.add_argument("--storage-root", required=True, type=Path)
    parser.add_argument("--workspace-root", required=True, type=Path)
    parser.add_argument("--artifact-root", action="append", default=[], type=Path)
    parser.add_argument("--private-log-root", required=True, type=Path)
    parser.add_argument("--corpus-root", required=True, type=Path)
    parser.add_argument("--receipt", required=True, type=Path)
    parser.add_argument("--writers-quiesced", action="store_true", required=True)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--disposable-fixture-run-id", type=UUID)
    args = parser.parse_args()
    # No .env loader and no production default. The caller supplies both exact targets.
    with psycopg.connect(connection_url(os.environ["DATABASE_URL"]), row_factory=dict_row) as db, psycopg.connect(
        connection_url(os.environ["LANGGRAPH_CHECKPOINT_DATABASE_URL"]), row_factory=dict_row
    ) as checkpoints:
        check_database(db, args.database_name)
        check_database(checkpoints, args.checkpoint_database_name)
        old, protected, files, directories, manifest, mixed, before, rewrites = load_inventory(
            db, str(args.run_id), args.storage_root, args.workspace_root, args.artifact_root,
            args.private_log_root, args.corpus_root)
        threads = classify_threads(checkpoint_threads(checkpoints), old, protected)
        mixed_targets = mixed_checkpoints(checkpoints, mixed, before)
        fixture_id = str(args.disposable_fixture_run_id) if args.disposable_fixture_run_id else None
        fixture_run = db.execute('SELECT id,"toolVersion","phaseResults" FROM "LegacyMigrationRun" '
                                 'WHERE id=%s::uuid', (str(args.run_id),)).fetchone() if fixture_id else None
        listing = ("ps", "-aq", *sandbox_filters(fixture_id, args.database_name,
                                                args.checkpoint_database_name, fixture_run))
        # Nested V1 checkpoint threads could also own a sandbox.
        container_ids = docker(*listing).split()
        containers = json.loads(docker("inspect", *container_ids)) if container_ids else []
        targets = sandbox_targets(containers, old | threads, protected)
        receipt = {"status": "PREFLIGHT", "manifestSha256": manifest, "archive": archive_fingerprint(db),
                   "disposableFixtureRunId": fixture_id,
                   "checkpointThreads": len(threads), "sandboxes": len(targets),
                   "mixedCheckpoints": len(mixed_targets), "mixedPrivateLogs": len(rewrites),
                   "artifactIdentities": len(files), "workspaceIdentities": len(directories),
                   "protectedThreads": len(protected)}
        if args.execute:
            erase_mixed_checkpoints(checkpoints, mixed_targets)
            for table in CHECKPOINT_TABLES:
                if checkpoints.execute("SELECT to_regclass(%s) AS relation", (table,)).fetchone()["relation"]:
                    checkpoints.execute(sql.SQL("DELETE FROM {} WHERE thread_id=ANY(%s)").format(
                        sql.Identifier(table)), (sorted(threads),))
            for container in targets:
                docker("rm", "-f", container)
            for path, identity in files.items():
                verify_file(path, *identity)
                path.unlink(missing_ok=True)
            for path, content in rewrites.items():
                # Writers are quiesced. Replace only the identified file; keep V2 records byte-identical.
                if content:
                    with path.open("wb") as output:
                        output.write(content)
                else:
                    path.unlink(missing_ok=True)
            for path in directories:
                if path.exists():
                    shutil.rmtree(path)
            if classify_threads(checkpoint_threads(checkpoints), old, protected) or mixed_checkpoints(checkpoints, mixed, before):
                raise ValueError("legacy checkpoints remain")
            remaining = docker(*listing).split()
            if sandbox_targets(json.loads(docker("inspect", *remaining)) if remaining else [], old | threads, protected):
                raise ValueError("legacy sandboxes remain")
            if any(path.exists() and retained_log_bytes(path.read_bytes(), before) != path.read_bytes()
                   for path in rewrites):
                raise ValueError("legacy private log records remain")
            if any(path.exists() for path in [*files, *directories]):
                raise ValueError("legacy filesystem data remains")
            checkpoints.commit()
            receipt["status"] = "PASS"
            receipt["remaining"] = {"checkpoints": 0, "sandboxes": 0, "files": 0, "workspaces": 0}
            # Commit after checkpoint erasure; interruption before this write requires
            # a safe idempotent rerun rather than authorizing a premature table drop.
            db.execute('UPDATE "LegacyMigrationRun" SET "phaseResults"=jsonb_set('
                       '"phaseResults",\'{W7_V1_PURGE}\',%s::jsonb,true) WHERE id=%s::uuid',
                       (Jsonb(receipt), str(args.run_id)))
        args.receipt.parent.mkdir(parents=True, exist_ok=True)
        args.receipt.write_text(json.dumps(receipt, indent=2) + "\n")
        print(json.dumps(receipt))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError, KeyError, psycopg.Error) as error:
        print(json.dumps({"status": "FAIL", "reasonType": type(error).__name__}))
        raise SystemExit(1) from None
