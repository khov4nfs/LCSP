"""Real DELETE API -> native eraser HTTP -> PostgresSaver/Docker, synthetic data only.

Called by the canonical domain vertical. The graph and in-flight work are fixtures;
authorization, CQRS, database cascades, storage and erasure handlers are production.
No provider is called. This is not production-image or staging acceptance.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import UTC, datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from urllib.parse import urlparse
from uuid import UUID

import httpx
import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from langgraph.checkpoint.base import empty_checkpoint
from langgraph.graph import END, START, StateGraph
from starlette.applications import Starlette
import uvicorn

from tools.common.capabilities.agent_runtime import local_server
from tools.common.capabilities.agent_runtime.agent_server_client import agent_thread_id
from tools.common.capabilities.platform.docker_sandbox import DockerSandboxSpec


DOMAIN_TABLES = (
    "AssessmentRuntime", "AssessmentCase", "AssessmentEvidence", "AssessmentCaseFact",
    "AssessmentCaseFactEvidence", "AssessmentRuleDecision", "AssessmentDecisionCoverage",
    "AssessmentHumanRequest", "AssessmentArtifact", "AssessmentEvent",
    "AssessmentRuntimeTurn", "AssessmentRuntimeEvent", "RepositorySnapshot", "RepositoryScanJob",
)


def command(args: list[str]) -> str:
    result = subprocess.run(args, check=True, capture_output=True, text=True, timeout=30)
    return result.stdout


def assessment_rows(db, assessment_id: str) -> dict:
    value = {"Assessment": db.execute('SELECT to_jsonb(t) AS row FROM "Assessment" t WHERE id=%s',
                                     (assessment_id,)).fetchall()}
    for table in DOMAIN_TABLES:
        value[table] = db.execute(sql.SQL('SELECT to_jsonb(t) AS row FROM {} t WHERE "assessmentId"=%s ORDER BY to_jsonb(t)::text')
                                 .format(sql.Identifier(table)), (assessment_id,)).fetchall()
    return value


def main() -> None:
    config = json.loads(Path(sys.argv[1]).read_text())
    root = Path(__file__).resolve().parents[3]
    url = os.environ["LANGGRAPH_CHECKPOINT_DATABASE_URL"]
    parsed = urlparse(url)
    server_url = urlparse(os.environ["LCSP_AGENT_SERVER_URL"])
    assert parsed.hostname == "127.0.0.1" and parsed.path == "/lcsp_assessment_vertical"
    assert server_url.hostname == "127.0.0.1" and server_url.port
    targets = config["targets"]
    survivor = config["survivor"]
    for item in (*targets, survivor):
        for key in ("assessmentId", "ownerId", "threadId"):
            UUID(item[key])
    assert len({item["assessmentId"] for item in (*targets, survivor)}) == 3
    directory = root / "reports/assessment-deletion" / (datetime.now(UTC).strftime("%Y%m%d%H%M%S") + "_" + str(os.getpid()))
    directory.mkdir(parents=True)
    report = {"scope": "SYNTHETIC_CANONICAL_API_POSTGRES_DOCKER_DELETE", "status": "RUNNING", "checks": []}
    created = []
    owned_logs = []
    runtime = local_server.LocalAgentRuntime()
    server = None
    server_thread = None
    cancel = threading.Event()
    drained = threading.Event()
    errors = []

    def passed(name: str) -> None:
        report["checks"].append(name)

    def call(method: str, route: str, *, token: str, body=None) -> httpx.Response:
        return httpx.request(method, config["apiBase"] + route, headers={"authorization": "Bearer " + token},
                             json=body, timeout=60)

    try:
        with psycopg.connect(url, autocommit=True, row_factory=dict_row) as db:
            assert db.execute("SELECT current_database() AS name").fetchone()["name"] == "lcsp_assessment_vertical"
            for item in (*targets, survivor):
                row = db.execute('SELECT a."ownerId",r."threadId"::text AS thread FROM "Assessment" a '
                                 'JOIN "AssessmentRuntime" r ON r."assessmentId"=a.id WHERE a.id=%s',
                                 (item["assessmentId"],)).fetchone()
                assert row == {"ownerId": item["ownerId"], "thread": item["threadId"]}
            assert db.execute('SELECT 1 FROM "AssessmentEvidence" WHERE "assessmentId"=%s', (targets[0]["assessmentId"],)).fetchone()
            assert db.execute('SELECT 1 FROM "AssessmentHumanRequest" WHERE "assessmentId"=%s AND status=\'OPEN\'',
                              (targets[1]["assessmentId"],)).fetchone()
            assert db.execute('SELECT 1 FROM "AssessmentHumanRequest" WHERE "assessmentId"=%s '
                              'AND answers @> \'[{"doesNotKnow":false}]\'::jsonb',
                              (targets[1]["assessmentId"],)).fetchone()
            assert db.execute('SELECT 1 FROM "AssessmentEvidence" WHERE "assessmentId"=%s AND type=\'HUMAN_ANSWER\'',
                              (targets[1]["assessmentId"],)).fetchone()
            audit_id = targets[0]["assessmentId"] + "-synthetic-raw-audit"
            db.execute('INSERT INTO "AuditEvent" (id,"eventType","resourceType","resourceId","correlationId",payload) '
                       "VALUES (%s,'synthetic.raw-history','ASSESSMENT_RECORD',%s,'synthetic',%s::jsonb)",
                       (audit_id, targets[0]["assessmentId"], json.dumps({
                           "assessmentId": targets[0]["assessmentId"], "evidence": "synthetic raw customer payload"})))
            protected_rows = assessment_rows(db, survivor["assessmentId"])
            shared = {table: db.execute(sql.SQL("SELECT to_jsonb(t) AS row FROM {} t ORDER BY id")
                                       .format(sql.Identifier(table))).fetchall()
                      for table in ("LegalPortfolioVersion", "LegalPortfolioRule", "EngineeringRule", "LegalCorpusVersion")}
            saver = runtime._open_checkpointer()
            builder = StateGraph(dict)
            builder.add_node("fixture", lambda state: state)
            builder.add_edge(START, "fixture")
            builder.add_edge("fixture", END)
            runtime.graph = builder.compile(checkpointer=saver)
            thread_groups = {}
            for item in (*targets, survivor):
                threads = [item["threadId"], agent_thread_id("", {"assessmentId": item["assessmentId"]}, "")]
                thread_groups[item["assessmentId"]] = threads
                for thread in threads:
                    runtime.create_thread({"thread_id": thread})
                    for namespace in ("", "native-task:fixture"):
                        cp = empty_checkpoint()
                        cp["channel_values"] = {"__root__": {"fixture": "synthetic private content " + item["assessmentId"]}}
                        cp["channel_versions"] = {"__root__": cp["id"]}
                        saved = saver.put({"configurable": {"thread_id": thread, "checkpoint_ns": namespace}},
                                          cp, {"source": "update", "step": 0}, cp["channel_versions"])
                        saver.put_writes(saved, [("__root__", {"fixture": "synthetic private write " + item["assessmentId"]})], "fixture-task")
                sandbox = DockerSandboxSpec(item["threadId"])
                command(["docker", "create", "--name", sandbox.container_name, "--network", "none",
                         "--label", "lcsp.repository-sandbox=true", "--label", "lcsp.thread-id=" + sandbox.safe_thread_hash,
                         "--label", "lcsp.release-deletion-fixture=" + directory.name, "busybox:1.37"])
                created.append(sandbox.container_name)
                with tempfile.TemporaryDirectory(prefix="release-sandbox-bytes-") as temp:
                    content = Path(temp) / "owned.txt"
                    content.write_text("synthetic assessment-private sandbox bytes " + item["assessmentId"])
                    command(["docker", "cp", str(content), sandbox.container_name + ":/owned.txt"])
                log = root / "tmp" / ("user_" + item["ownerId"]) / ("assessment_" + item["assessmentId"]) / "release-delete-proof.log"
                log.parent.mkdir(parents=True, exist_ok=True)
                log.write_text("synthetic assessment-private log bytes " + item["assessmentId"])
                owned_logs.append(log)
            protected_checkpoints = {thread: list(saver.list({"configurable": {"thread_id": thread}}))
                                     for thread in thread_groups[survivor["assessmentId"]]}
            passed("fixtures have actual tenant/Root identity, owned domain content and native durable namespaces")

            active = targets[1]
            run_id = db.execute('SELECT "currentExecutionId"::text AS id FROM "AssessmentRuntime" WHERE "assessmentId"=%s',
                                (active["assessmentId"],)).fetchone()["id"]

            def in_flight() -> None:
                assert cancel.wait(45), "synthetic in-flight work did not receive cancellation"
                with psycopg.connect(url, autocommit=True, row_factory=dict_row) as observed:
                    row = observed.execute('SELECT "executionState"::text AS state,"leaseToken" FROM "AssessmentRuntime" '
                                           'WHERE "assessmentId"=%s', (active["assessmentId"],)).fetchone()
                    assert row == {"state": "CANCELLED", "leaseToken": None}
                    assert not observed.execute('SELECT 1 FROM "AssessmentHumanRequest" WHERE "assessmentId"=%s AND status=\'OPEN\'',
                                                (active["assessmentId"],)).fetchone()
                drained.set()

            key = (active["threadId"], run_id)
            runtime._runs[key] = {"status": "running"}
            runtime._cancel_events[key] = cancel
            runtime._run_futures[key] = runtime._executor.submit(in_flight)

            @asynccontextmanager
            async def fixture_lifespan(app):
                app.state.runtime = runtime
                yield

            # Reuse production routes and handlers; only graph inputs/execution are synthetic.
            app = Starlette(routes=local_server.app.routes, lifespan=fixture_lifespan)
            server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=server_url.port, log_level="error"))
            server_thread = threading.Thread(target=server.run, daemon=True)
            server_thread.start()
            for _ in range(100):
                if server.started:
                    break
                assert server_thread.is_alive(), "fixture eraser HTTP server exited before readiness"
                time.sleep(.05)
            else:
                raise AssertionError("fixture eraser HTTP readiness timed out")
            owner_token = os.environ["ASSESSMENT_DELETE_OWNER_TOKEN"]
            other_token = os.environ["ASSESSMENT_DELETE_OTHER_TOKEN"]
            assert call("DELETE", "/assessments/" + targets[0]["assessmentId"], token=other_token).status_code == 404
            assert all(saver.get_tuple({"configurable": {"thread_id": item["threadId"]}}) for item in targets)
            passed("foreign-tenant DELETE is refused before any erasure")
            for item in targets:
                result = call("DELETE", "/assessments/" + item["assessmentId"], token=owner_token)
                assert result.status_code == 200, "authorized DELETE failed with HTTP " + str(result.status_code)
                assert result.json()["data"]["deleted"] is True
                assert call("GET", "/assessments/" + item["assessmentId"], token=owner_token).status_code == 404
                assert call("GET", "/assessments/" + item["assessmentId"] + "/human-requests", token=owner_token).status_code == 404
                continued = call("POST", "/assessments/" + item["assessmentId"] + "/runtime/continue",
                                 token=owner_token, body={"targetRunId": run_id})
                assert continued.status_code == 409, "deleted-assessment Continue returned HTTP " + str(continued.status_code)
                assert continued.json()["problem"]["code"] == "RUNTIME_CONTROL_TARGET_STALE"
                assert not db.execute('SELECT 1 FROM "Assessment" WHERE id=%s', (item["assessmentId"],)).fetchone()
                assert all(not rows for rows in assessment_rows(db, item["assessmentId"]).values())
                assert not db.execute('SELECT 1 FROM "OutboxMessage" WHERE "aggregateType"=\'ASSESSMENT\' AND "aggregateId"=%s',
                                      (item["assessmentId"],)).fetchone()
                for thread in thread_groups[item["assessmentId"]]:
                    assert not list(saver.list({"configurable": {"thread_id": thread}}))
                    for table in ("checkpoints", "checkpoint_writes", "checkpoint_blobs"):
                        assert not db.execute(sql.SQL("SELECT 1 FROM {} WHERE thread_id=%s").format(sql.Identifier(table)),
                                              (thread,)).fetchone()
                    assert httpx.get(os.environ["LCSP_AGENT_SERVER_URL"] + "/threads/" + thread + "/state").status_code == 404
                    assert httpx.post(os.environ["LCSP_AGENT_SERVER_URL"] + "/threads/" + thread + "/runs",
                                      json={"input": None}).status_code == 404
                sandbox = DockerSandboxSpec(item["threadId"])
                assert not command(["docker", "ps", "-aq", "--filter", "name=^/" + sandbox.container_name + "$"]).strip()
                assert not (root / "tmp" / ("user_" + item["ownerId"]) / ("assessment_" + item["assessmentId"]) / "release-delete-proof.log").exists()
                assert call("DELETE", "/assessments/" + item["assessmentId"], token=owner_token).json()["data"]["deleted"] is True
                assert call("DELETE", "/assessments/" + item["assessmentId"], token=other_token).status_code == 404
                receipts = db.execute('SELECT payload FROM "AuditEvent" WHERE "resourceId"=%s AND "eventType"=\'ASSESSMENT_DELETED\'',
                                      (item["assessmentId"],)).fetchall()
                assert len(receipts) == 1
                assert all("synthetic assessment-private" not in json.dumps(row) for row in receipts)
            assert drained.is_set(), "DELETE did not drain the running native task"
            assert db.execute('SELECT payload FROM "AuditEvent" WHERE id=%s', (audit_id,)).fetchone()["payload"] == {}
            passed("revocation and open-request cancellation commit before native in-flight erasure")
            passed("owner DELETE erases Case/facts/evidence/coverage/decisions/requests/events/outbox and is idempotent")
            passed("Root/transport checkpoint namespaces, writes and blobs are erased and HTTP resume is revoked")
            passed("identity-verified owned Docker sandbox bytes and private logs are erased")
            artifact = config["artifact"]
            assert call("GET", "/assessments/" + targets[0]["assessmentId"] + "/artifacts/" + artifact["id"] + "/download",
                        token=owner_token).status_code == 404
            assert all(not (Path(config["storageRoot"]) / "chunks" / chunk).exists() for chunk in artifact["chunks"])
            usage = db.execute('SELECT "assessmentId","invocationId","totalTokens"::text AS tokens,"chargedCredits"::text AS credits '
                               'FROM "LlmUsageEvent" WHERE id=%s', (config["usageId"],)).fetchone()
            assert usage == {"assessmentId": None, "invocationId": config["usageId"], "tokens": "12", "credits": "3"}
            passed("immutable report bytes/metadata are erased; invocation/token/cost ledger survives detached")
            assert assessment_rows(db, survivor["assessmentId"]) == protected_rows
            assert all(list(saver.list({"configurable": {"thread_id": thread}})) == rows
                       for thread, rows in protected_checkpoints.items())
            for table, rows in shared.items():
                assert db.execute(sql.SQL("SELECT to_jsonb(t) AS row FROM {} t ORDER BY id")
                                  .format(sql.Identifier(table))).fetchall() == rows
            sandbox = DockerSandboxSpec(survivor["threadId"])
            assert command(["docker", "ps", "-aq", "--filter", "name=^/" + sandbox.container_name + "$"]).strip()
            with tempfile.TemporaryDirectory(prefix="release-survivor-bytes-") as temp:
                preserved = Path(temp) / "owned.txt"
                command(["docker", "cp", sandbox.container_name + ":/owned.txt", str(preserved)])
                assert preserved.read_text() == "synthetic assessment-private sandbox bytes " + survivor["assessmentId"]
            assert call("GET", "/assessments/" + survivor["assessmentId"], token=other_token).status_code == 200
            passed("another tenant's assessment/checkpoints/sandbox and shared legal authorities remain byte-identical")
            report["status"] = "PASS"
    except Exception as error:
        report.update(status="FAIL", reasonType=type(error).__name__, reason=str(error))
        frame = traceback.extract_tb(error.__traceback__)[-1]
        report["failureLocation"] = {"file": Path(frame.filename).name, "line": frame.lineno, "function": frame.name}
        errors.append(error)
    finally:
        cancel.set()
        if server:
            server.should_exit = True
        if server_thread:
            server_thread.join(timeout=10)
        runtime.close()
        for name in reversed(created):
            result = subprocess.run(["docker", "rm", "-f", name], capture_output=True, text=True, timeout=30)
            if result.returncode and "No such container" not in result.stderr:
                report.update(status="FAIL", cleanup="owned fixture sandbox removal failed")
        for log in owned_logs:
            log.unlink(missing_ok=True)
        (directory / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        print("RELEASE DELETE " + report["status"] + "; evidence directory: " + str(directory), file=sys.stderr)
        print(json.dumps({"status": report["status"], "checks": len(report["checks"]), "evidenceDirectory": str(directory)}))
    if errors or report["status"] != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
