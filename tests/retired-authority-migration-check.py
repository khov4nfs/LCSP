"""User-run RELEASE migration proof, isolated in a newly created disposable container.

This seeds synthetic POST-CUTOVER state. It does not rerun or replace accepted CUTOVER
evidence, run a provider, deploy production, or prove the full staging gate.
"""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from uuid import uuid4, uuid5

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from langgraph.checkpoint.base import empty_checkpoint
from langgraph.checkpoint.postgres import PostgresSaver

ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "apps/api"
MIGRATIONS = API / "prisma/migrations"
DROP = MIGRATIONS / "20261008160000_w7_drop_v1_authority/migration.sql"
sys.path.insert(0, str(ROOT / "deepagents"))
spec = importlib.util.spec_from_file_location("release_purge_v1", ROOT / "scripts/purge-retired-assessment-state.py")
purge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(purge)


def run(command: list[str], *, env: dict | None = None) -> str:
    result = subprocess.run(command, cwd=ROOT, env=env, text=True, capture_output=True, timeout=180)
    if result.returncode:
        # Targets/inputs here are generated synthetic fixtures only. Never inherit a target URL.
        print((result.stdout + result.stderr)[-12000:], flush=True)
        raise RuntimeError(f"fixture command failed: {command[0]} (exit {result.returncode})")
    return result.stdout


def config_text(migrations: Path) -> str:
    return ('import { defineConfig, env } from "prisma/config";\n'
            "export default defineConfig({schema:" + json.dumps(str(API / "prisma/schema.prisma")) +
            ",migrations:{path:" + json.dumps(str(migrations)) +
            '},datasource:{url:env("DATABASE_URL")}});\n')


def postgres_errors(output: str) -> str:
    # Keep diagnostics, not the SQL statement/payload logged with an error.
    return "\n".join(line for line in output.splitlines()
                     if re.match(r"^(?:\d{4}-\d{2}-\d{2}[^[]*\[\d+\]\s+)?(?:ERROR|DETAIL|HINT|CONTEXT):", line))


def archive(conn, run_id: str, source: str, identity: str, payload: dict,
            assessment: str | None = None, *, copied: bool = False) -> str:
    record = str(uuid4())
    conn.execute(
        'INSERT INTO "LegacyArchiveRecord" (id,"archiveRunId","assessmentId","sourceTable","sourceId",'
        'payload,"payloadSha256","reconciliationClass","reconciliationReason") '
        "SELECT %s::uuid,%s::uuid,%s,%s::\"LegacyArchiveSource\",%s,p,encode(sha256(convert_to(p::text,'UTF8')),'hex'),"
        '%s::"LegacyArtifactReconciliationClass",%s::"LegacyArtifactReconciliationReason" '
        "FROM (SELECT %s::jsonb AS p) input",
        (record, run_id, assessment, source, identity,
         "ARTIFACT_PRESENT_AND_COPIED" if copied else None, "COPIED_AND_VERIFIED" if copied else None, Jsonb(payload)),
    )
    return record


def table_row(conn, table: str, identity: str) -> dict:
    return conn.execute(sql.SQL("SELECT to_jsonb(t) AS payload FROM {} t WHERE id=%s").format(
        sql.Identifier(table)), (identity,)).fetchone()["payload"]


def seed(conn, paths: dict[str, Path]) -> dict:
    before = datetime(2026, 10, 8, tzinfo=UTC)
    state = {"run": str(uuid4()), "terminal": str(uuid4()), "live": str(uuid4()), "other": str(uuid4()),
             "oldThread": str(uuid4()), "root": str(uuid4()), "otherRoot": str(uuid4()), "corpus": str(uuid4())}
    state["transport"] = str(uuid5(purge.HOST_THREAD_NAMESPACE, "assessment:" + state["live"]))
    conn.execute('INSERT INTO "User" (id,email,"passwordHash","emailVerified","failedLoginCount","updatedAt") '
                 "VALUES ('release-owner','release-owner@example.invalid','synthetic-hash',true,0,now()),"
                 "('release-other','release-other@example.invalid','synthetic-hash',true,0,now())")
    conn.execute('INSERT INTO "LegacyMigrationRun" (id,kind,status,"toolVersion","phaseResults","startedAt",'
                 '"restorePointVerifiedAt","completedAt") VALUES (%s::uuid,\'CUTOVER\',\'COMPLETED\','
                 "'SYNTHETIC_POST_CUTOVER_FIXTURE',%s,%s,%s,%s)",
                 (state["run"], Jsonb({"VALIDATE": {"summary": {"blockingFailures": 0}},
                                     "fixtureOnly": True}), before, before, before))
    for key, owner in (("terminal", "release-owner"), ("live", "release-owner"), ("other", "release-other")):
        conn.execute('INSERT INTO "Assessment" (id,"ownerId",name,"updatedAt","lifecycleState","lifecycleRevision") '
                     "VALUES (%s,%s,'Synthetic RELEASE fixture',now(),%s::\"AssessmentLifecycleState\",%s)",
                     (state[key], owner, None if key == "terminal" else "WAITING_FOR_REQUIRED_INPUT",
                      None if key == "terminal" else 0))
        if key != "terminal":
            thread = state["root" if key == "live" else "otherRoot"]
            conn.execute('INSERT INTO "AssessmentRuntime" ("assessmentId","threadId","rootAgentVersion",'
                         '"checkpointNamespace","updatedAt") VALUES (%s,%s::uuid,\'assessment-root-v2\',%s,now())',
                         (state[key], thread, thread))
            conn.execute('INSERT INTO "AssessmentCase" ("assessmentId","updatedAt") VALUES (%s,now())', (state[key],))
    for key in ("terminal", "live"):
        payload = table_row(conn, "Assessment", state[key])
        payload.update(lifecycleState=None, lifecycleRevision=None)
        archive(conn, state["run"], "ASSESSMENT", state[key], payload, state[key])
    interview = str(uuid4())
    conn.execute('INSERT INTO "AssessmentInterviewThread" (id,"assessmentId","stateJson","updatedAt") '
                 "VALUES (%s,%s,%s,now())", (interview, state["live"], Jsonb({"synthetic": "V1-only content"})))
    archive(conn, state["run"], "ASSESSMENT_INTERVIEW_THREAD", interview,
            table_row(conn, "AssessmentInterviewThread", interview), state["live"])
    for boundary, thread in (("INTERVIEW", state["oldThread"]), ("ASSESSMENT_ROOT", state["root"])):
        identity = str(uuid4())
        conn.execute('INSERT INTO "AssessmentRuntimeTurn" (id,"assessmentId","threadId",boundary,"logicalRunId",'
                     '"correlationId",state,"contextJson","updatedAt") VALUES (%s,%s,%s,%s,%s,%s,\'STOPPED\',%s,now())',
                     (identity, state["live"], thread, boundary, identity, identity, Jsonb({"synthetic": True})))
        if boundary != "ASSESSMENT_ROOT":
            archive(conn, state["run"], "ASSESSMENT_RUNTIME_TURN", identity,
                    table_row(conn, "AssessmentRuntimeTurn", identity), state["live"])
    conn.execute('INSERT INTO "LegalCorpusVersion" (id,version,"sourceManifest") VALUES (%s,%s,\'{}\')',
                 (state["corpus"], state["corpus"]))
    preparation = str(uuid4())
    conn.execute('INSERT INTO "CorpusPreparation" (id,"idempotencyKey","targetCorpusId","requestedBy","correlationId") '
                 "VALUES (%s,%s,%s,'synthetic-service',%s)", (preparation, preparation, state["corpus"], preparation))
    archive(conn, state["run"], "CORPUS_PREPARATION", preparation, table_row(conn, "CorpusPreparation", preparation))
    for event, resource in (("old-catalog", str(uuid4())), ("corpus", state["corpus"])):
        conn.execute('INSERT INTO "AuditEvent" (id,"eventType","resourceType","resourceId","correlationId",payload) '
                     "VALUES (%s,'synthetic.fixture','LEGAL_RULE_CATALOG_VERSION',%s,'synthetic',%s)",
                     (event, resource, Jsonb({"synthetic": True})))
    conn.execute('INSERT INTO "LlmUsageEvent" (id,"userId","assessmentId",provider,model,"invocationId",'
                 '"totalTokens","chargedCredits") VALUES (\'release-usage\',\'release-owner\',%s,\'fixture\',\'fixture\','
                 "'synthetic-invocation',12,3)", (state["terminal"],))
    old_outbox = str(uuid4())
    conn.execute('INSERT INTO "OutboxMessage" (id,"aggregateType","aggregateId","eventType",payload) '
                 "VALUES (%s,'LEGAL_CORPUS_VERSION',%s,'command.legal-corpus.recovery.requested.v1',%s)",
                 (old_outbox, state["corpus"], Jsonb({"correlationId": old_outbox, "synthetic": True})))
    state["oldAcquisitionThread"] = str(uuid5(purge.HOST_THREAD_NAMESPACE,
                                           "event:legal_corpus_recovery_requested:" + old_outbox))
    report_bytes = b"synthetic V1 historical bytes"
    sha = hashlib.sha256(report_bytes).hexdigest()
    report_path = paths["storage"] / "historical-report"
    report_path.write_bytes(report_bytes)
    blob_path = paths["storage"] / "legacy-archive" / (sha + ".blob")
    blob_path.parent.mkdir()
    blob_path.write_bytes(report_bytes)
    record = archive(conn, state["run"], "DOCUMENT_REQUEST", "synthetic-orphan-report",
                     {"documentUrl": report_path.as_uri()}, state["live"], copied=True)
    conn.execute('INSERT INTO "LegacyArchiveBlob" ("recordId","contentSha256","sizeBytes","storageRef") '
                 "VALUES (%s::uuid,%s,%s,%s)", (record, sha, len(report_bytes), "legacy-archive/" + sha + ".blob"))
    (paths["storage"] / "chunks").mkdir()
    (paths["storage"] / "chunks/canonical.fixture").write_bytes(b"synthetic V2 bytes")
    for key in ("terminal", "live", "other"):
        directory = paths["logs"] / ("user_release-other" if key == "other" else "user_release-owner") / ("assessment_" + state[key])
        directory.mkdir(parents=True)
        content = b"[2026-10-07T00:00:00.000Z] synthetic V1 content\n"
        if key == "live":
            content += b'{"timestamp":"2026-10-09T00:00:00+00:00","event":"synthetic V2"}\n'
        if key == "other":
            content = b"synthetic other assessment bytes"
        (directory / "run.log").write_bytes(content)
    (paths["logs"] / "llm-tool-calls.log").write_bytes(b"synthetic V1 mirror")
    (paths["corpus"] / "recovery-artifacts").mkdir()
    (paths["corpus"] / "recovery-artifacts/old.cache").write_bytes(b"synthetic V1 cache")
    job = str(uuid4())
    archive(conn, state["run"], "REPOSITORY_SCAN_JOB", job, {"id": job, "assessmentId": state["terminal"]}, state["terminal"])
    (paths["workspaces"] / job).mkdir()
    (paths["workspaces"] / job / "synthetic-source.txt").write_bytes(b"synthetic V1 workspace")
    for key in ("terminal", "live"):
        fingerprint = conn.execute('SELECT count(*)::int AS count, encode(sha256(convert_to(string_agg('
                                  '"sourceTable"::text || \':\' || "sourceId" || \':\' || "payloadSha256", E\'\\n\' '
                                  'ORDER BY "sourceTable"::text COLLATE "C", "sourceId" COLLATE "C"),\'UTF8\')),\'hex\') AS sha '
                                  'FROM "LegacyArchiveRecord" WHERE "assessmentId"=%s', (state[key],)).fetchone()
        conn.execute('INSERT INTO "LegacyAssessmentArchive" ("assessmentId","ownerId",disposition,"legacyStatus",'
                     '"legacyCreatedAt","legacyUpdatedAt","archiveRunId","recordCount","payloadDigest",'
                     '"v2ThreadId","v2LifecycleState") VALUES (%s,\'release-owner\',%s::"LegacyAssessmentDisposition",'
                     '\'WIZARD_IN_PROGRESS\',%s,%s,%s::uuid,%s,%s,%s::uuid,%s::"AssessmentLifecycleState")',
                     (state[key], "ARCHIVED_TERMINAL" if key == "terminal" else "BACKFILLED_NON_TERMINAL",
                      before, before, state["run"], fingerprint["count"], fingerprint["sha"],
                      None if key == "terminal" else state["root"],
                      None if key == "terminal" else "WAITING_FOR_REQUIRED_INPUT"))
    conn.commit()
    return state


def checkpoint(saver, thread: str, namespace: str, text: str, *, canonical: str | None = None):
    cp = empty_checkpoint()
    cp["ts"] = "2026-10-09T00:00:00+00:00" if canonical else "2026-10-07T00:00:00+00:00"
    cp["channel_values"] = {"fixture": text}
    cp["channel_versions"] = {"fixture": cp["id"]}
    metadata = {"source": "update", "step": 0}
    if canonical:
        metadata.update(lcsp_boundary_name="assessment_root_requested", assessment_id=canonical)
    config = saver.put({"configurable": {"thread_id": thread, "checkpoint_ns": namespace}}, cp, metadata, cp["channel_versions"])
    saver.put_writes(config, [("fixture", text)], "fixture-task")
    return config


def preserved_database(conn, state: dict) -> str:
    value = {}
    for table in ("Assessment", "AssessmentRuntime", "AssessmentCase"):
        column = "id" if table == "Assessment" else "assessmentId"
        rows = list(conn.execute(sql.SQL("SELECT to_jsonb(t)-'status' AS row FROM {} t WHERE {}=ANY(%s) ORDER BY {}").format(
            sql.Identifier(table), sql.Identifier(column), sql.Identifier(column)), ([state["live"], state["other"]],)))
        value[table] = rows
    for table in ("LegalCorpusVersion", "LlmUsageEvent"):
        value[table] = list(conn.execute(sql.SQL("SELECT to_jsonb(t)-'assessmentId' AS row FROM {} t ORDER BY id").format(
            sql.Identifier(table))))
    value["rootTurns"] = list(conn.execute('SELECT to_jsonb(t) AS row FROM "AssessmentRuntimeTurn" t '
                                         "WHERE boundary='ASSESSMENT_ROOT' ORDER BY id"))
    return purge.digest(value)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-check", action="store_true", help="Validate runner structure without Docker/database execution.")
    args = parser.parse_args()
    drop_tables = re.findall(r'DROP TABLE "([^"]+)";', DROP.read_text())
    assert len(drop_tables) == 29 and len(set(drop_tables)) == 29
    canonical_models = set(re.findall(r"^model (\w+) \{", (API / "prisma/schema.prisma").read_text(), re.M))
    assert not canonical_models.intersection(drop_tables), "RELEASE cannot drop a current canonical model"
    assert DROP.read_text().rstrip().endswith("COMMIT;")
    assert "dotenv" not in config_text(MIGRATIONS)
    if args.self_check:
        print("PASS — runner self-check; no database/container operation")
        return 0
    report_dir = ROOT / "reports/retired-authority-migration" / (datetime.now(UTC).strftime("%Y%m%d%H%M%S") + "_" + str(os.getpid()))
    report_dir.mkdir(parents=True, exist_ok=False)
    report = {"scope": "SYNTHETIC_POST_CUTOVER_DISPOSABLE_FIXTURE", "status": "RUNNING", "checks": []}
    created = []
    pg_container = "lcsp-release-fixture-" + uuid4().hex

    def passed(name: str) -> None:
        report["checks"].append(name)
        print("PASS — " + name, flush=True)

    def save() -> None:
        (report_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n")

    try:
        existing_sandboxes = set(run(["docker", "ps", "-aq", "--filter", "label=lcsp.repository-sandbox=true"]).split())
        report["unrelatedSandboxCount"] = len(existing_sandboxes)
        (API / "tmp").mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="release-disposable-", dir=API / "tmp") as temporary:
            task = Path(temporary)
            prior = task / "prior-migrations"
            prior.mkdir()
            for path in sorted(MIGRATIONS.iterdir()):
                if path == DROP.parent:
                    continue
                if path.is_dir():
                    shutil.copytree(path, prior / path.name)
                elif path.name == "migration_lock.toml":
                    shutil.copyfile(path, prior / path.name)
            prior_config, final_config = task / "prior.config.ts", task / "final.config.ts"
            prior_config.write_text(config_text(prior))
            final_config.write_text(config_text(MIGRATIONS))
            run(["docker", "run", "-d", "--name", pg_container, "--label", "lcsp.release-disposable=true",
                 "-e", "POSTGRES_PASSWORD=synthetic-release-only", "-p", "127.0.0.1::5432", "postgres:16-alpine"])
            created.append(pg_container)
            port = run(["docker", "port", pg_container, "5432/tcp"]).strip().rsplit(":", 1)[1]
            base = f"postgresql://postgres:synthetic-release-only@127.0.0.1:{port}/"
            for _ in range(60):
                try:
                    with psycopg.connect(base + "postgres", autocommit=True, connect_timeout=2) as admin:
                        for name in ("retirement_clean", "retirement_upgrade", "retirement_checkpoints"):
                            admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
                    break
                except psycopg.OperationalError:
                    time.sleep(0.5)
            else:
                raise RuntimeError("disposable PostgreSQL did not become ready")
            env = {**os.environ, "DATABASE_URL": base + "retirement_clean", "NODE_OPTIONS": "--max-old-space-size=1536",
                   "NODE_ENV": "test", "PYTHONPATH": str(ROOT / "deepagents")}

            def migrate(database: str, config: Path) -> None:
                run(["pnpm", "--dir", str(API), "exec", "prisma", "migrate", "deploy", "--config", str(config)],
                    env={**env, "DATABASE_URL": base + database})

            migrate("retirement_clean", final_config)
            passed("clean install replays historical migrations through the RELEASE drop")
            migrate("retirement_upgrade", prior_config)
            paths = {name: task / name for name in ("storage", "workspaces", "logs", "corpus")}
            for path in paths.values():
                path.mkdir()
            with psycopg.connect(base + "retirement_upgrade", row_factory=dict_row) as db:
                state = seed(db, paths)
                preserved = preserved_database(db, state)
                db.commit()
                try:
                    db.execute(DROP.read_text())
                except psycopg.Error as error:
                    assert "identity-bound external V1 purge proof" in str(error), str(error)
                    db.rollback()
                else:
                    raise AssertionError("drop accepted an archive without external purge evidence")
                assert preserved_database(db, state) == preserved
                db.commit()
                passed("missing purge proof refuses the drop transaction without changing canonical state")
            checkpoint_url = base + "retirement_checkpoints"
            with PostgresSaver.from_conn_string(checkpoint_url) as saver:
                saver.setup()
                old = [state["oldThread"], state["oldThread"] + ":old-run:hash", state["oldAcquisitionThread"]]
                for thread in old:
                    checkpoint(saver, thread, "", "synthetic V1 state")
                checkpoint(saver, state["transport"], "", "synthetic mixed V1 state")
                protected = [
                    checkpoint(saver, state["transport"], "", "synthetic mixed V2 state", canonical=state["live"]),
                    checkpoint(saver, state["root"], "", "synthetic Root", canonical=state["live"]),
                    checkpoint(saver, state["root"], "native-task:fixture", "synthetic native task", canonical=state["live"]),
                    checkpoint(saver, state["otherRoot"], "", "synthetic other Root", canonical=state["other"]),
                ]
                originals = [saver.get_tuple(config) for config in protected]
                for thread in (state["oldThread"], state["root"]):
                    sha = hashlib.sha256(thread.encode()).hexdigest()
                    name = "lcsp-repository-sandbox-" + sha[:24]
                    run(["docker", "create", "--name", name, "--network", "none", "--read-only",
                         "--label", "lcsp.repository-sandbox=true", "--label", "lcsp.thread-id=" + sha,
                         "--label", "lcsp.release-fixture-run=" + state["run"],
                         "busybox:1.37"])
                    created.append(name)
                purge_command = [sys.executable, str(ROOT / "scripts/purge-retired-assessment-state.py"),
                    "--database-name", "retirement_upgrade", "--checkpoint-database-name", "retirement_checkpoints",
                    "--run-id", state["run"], "--storage-root", str(paths["storage"]),
                    "--workspace-root", str(paths["workspaces"]), "--private-log-root", str(paths["logs"]),
                    "--corpus-root", str(paths["corpus"]), "--writers-quiesced",
                    "--disposable-fixture-run-id", state["run"]]
                purge_env = {**env, "DATABASE_URL": base + "retirement_upgrade", "LANGGRAPH_CHECKPOINT_DATABASE_URL": checkpoint_url}
                for name, execute in (("preflight", False), ("purge", True), ("rerun", True)):
                    command = [*purge_command, "--receipt", str(report_dir / (name + ".json"))]
                    if execute:
                        command.append("--execute")
                    run(command, env=purge_env)
                    if name == "preflight":
                        assert [saver.get_tuple(config) for config in protected] == originals
                        assert list(saver.list({"configurable": {"thread_id": old[0]}}))
                        assert (paths["storage"] / "historical-report").exists()
                        passed("preflight is read-only")
                for thread in old:
                    assert not list(saver.list({"configurable": {"thread_id": thread}}))
                assert [saver.get_tuple(config) for config in protected] == originals
                assert len(list(saver.list({"configurable": {"thread_id": state["transport"]}}))) == 1
                assert len(run(["docker", "ps", "-aq", "--filter", "label=lcsp.repository-sandbox=true",
                                "--filter", "label=lcsp.release-fixture-run=" + state["run"]]).split()) == 1
                assert existing_sandboxes.issubset(set(run(
                    ["docker", "ps", "-aq", "--filter", "label=lcsp.repository-sandbox=true"]).split())), (
                    "unrelated sandbox identities changed during the fixture run")
                passed("unrelated existing sandboxes remain outside fixture erasure")
                assert not (paths["corpus"] / "recovery-artifacts").exists()
                assert not (paths["storage"] / "historical-report").exists()
                assert not (paths["storage"] / "legacy-archive").exists()
                assert not (paths["logs"] / "llm-tool-calls.log").exists()
                assert not list(paths["workspaces"].iterdir())
                assert (paths["storage"] / "chunks/canonical.fixture").read_bytes() == b"synthetic V2 bytes"
                assert (paths["logs"] / ("user_release-owner/assessment_" + state["live"]) / "run.log").read_bytes() == (
                    b'{"timestamp":"2026-10-09T00:00:00+00:00","event":"synthetic V2"}\n')
                assert (paths["logs"] / ("user_release-other/assessment_" + state["other"]) / "run.log").read_bytes() == b"synthetic other assessment bytes"
                rerun = json.loads((report_dir / "rerun.json").read_text())
                assert rerun["status"] == "PASS" and not rerun["checkpointThreads"] and not rerun["mixedCheckpoints"] and not rerun["sandboxes"]
                passed("native Postgres checkpoints/blobs/writes, V1 sandbox/files/cache/logs erased; canonical and mixed V2 state preserved")
                passed("external erasure rerun is idempotent")
                with psycopg.connect(base + "retirement_upgrade", row_factory=dict_row) as db:
                    db.execute('UPDATE "LegacyMigrationRun" SET "toolVersion"=\'ordinary-release\' WHERE id=%s::uuid',
                               (state["run"],))
                    db.commit()
                    try:
                        db.execute(DROP.read_text())
                    except psycopg.Error as error:
                        assert "identity-bound external V1 purge proof" in str(error), str(error)
                        db.rollback()
                    else:
                        raise AssertionError("ordinary release accepted a fixture-scoped purge receipt")
                    assert preserved_database(db, state) == preserved
                    # Replay the fixture identity required by the immutable historical SQL guard.
                    db.execute('UPDATE "LegacyMigrationRun" SET "toolVersion"=\'SYNTHETIC_POST_W6_FIXTURE\' WHERE id=%s::uuid',
                               (state["run"],))
                    db.commit()
                passed("fixture-scoped purge evidence cannot authorize an ordinary release drop")
                migrate("retirement_upgrade", final_config)
                migrate("retirement_upgrade", final_config)
                with psycopg.connect(base + "retirement_upgrade", row_factory=dict_row) as db:
                    for table in drop_tables:
                        assert db.execute("SELECT to_regclass(%s) AS relation", ('"' + table + '"',)).fetchone()["relation"] is None
                    assert not db.execute('SELECT 1 FROM "Assessment" WHERE id=%s', (state["terminal"],)).fetchone()
                    assert db.execute('SELECT "assessmentId" FROM "LlmUsageEvent" WHERE id=\'release-usage\'').fetchone()["assessmentId"] is None
                    assert not db.execute('SELECT 1 FROM "OutboxMessage" WHERE "eventType"=\'command.legal-corpus.recovery.requested.v1\'').fetchone()
                    assert not db.execute('SELECT 1 FROM "AuditEvent" WHERE id=\'old-catalog\'').fetchone()
                    assert db.execute('SELECT "resourceType" FROM "AuditEvent" WHERE id=\'corpus\'').fetchone()["resourceType"] == "LEGAL_CORPUS_VERSION"
                    assert preserved_database(db, state) == preserved
                assert [saver.get_tuple(config) for config in protected] == originals
                passed("populated synthetic post-CUTOVER upgrade drops 29 V1 tables; canonical owner/Case/Root/accounting/corpus unchanged")
                passed("second Prisma deploy is a no-op")
            report["status"] = "PASS"
    except Exception as error:
        report.update(status="FAIL", reasonType=type(error).__name__, reason=str(error))
        print("FAIL — " + str(error), flush=True)
        if pg_container in created:
            try:
                logs = subprocess.run(["docker", "logs", pg_container], capture_output=True, text=True, timeout=10)
                diagnostics = postgres_errors(logs.stdout + logs.stderr)
                if diagnostics:
                    (report_dir / "postgres-errors.log").write_text(diagnostics + "\n")
                    report["postgresErrors"] = "postgres-errors.log"
                    print(diagnostics, flush=True)
            except (OSError, subprocess.SubprocessError):
                report["diagnostics"] = "owned PostgreSQL log collection failed"
    finally:
        for container in reversed(created):
            result = subprocess.run(["docker", "rm", "-f", container], capture_output=True, text=True, timeout=30)
            # A V1 sandbox is already gone after erasure. All other removals must succeed.
            if result.returncode and "No such container" not in result.stderr:
                report.update(status="FAIL", cleanup="owned fixture container removal failed")
        save()
        print("Evidence directory: " + str(report_dir), flush=True)
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
