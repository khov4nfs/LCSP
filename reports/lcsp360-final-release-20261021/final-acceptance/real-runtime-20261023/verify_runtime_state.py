"""Read-only verification of the owned real-browser environment; no inference."""

import hashlib
import importlib.metadata
import json
import pathlib
import shlex
import shutil
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone

import psycopg
from psycopg.rows import dict_row


def command(*args):
    return subprocess.check_output(args, text=True).strip()


reference = json.loads(pathlib.Path(sys.argv[1]).read_text())
private = pathlib.Path(reference["private"])
environment = json.loads((private / "env.json").read_text())
output = pathlib.Path(__file__).resolve().parent
assert reference["postgresPort"] == 55506
assert reference["database"] == "lcsp360_real_runtime_44ed8d07"

with psycopg.connect(
    environment["DATABASE_URL"].split("?")[0],
    options="-c default_transaction_read_only=on",
    row_factory=dict_row,
) as connection:
    sessions = connection.execute(
        '''SELECT a.id, a."userId", u.role, a."createdAt", a."revokedAt"
           FROM "AuthRecord" a JOIN "User" u ON u.id = a."userId"
           WHERE a.type = 'SESSION' ORDER BY a."createdAt"'''
    ).fetchall()
    assert sessions and all(row["revokedAt"] is not None for row in sessions)
    counts = connection.execute(
        '''SELECT (SELECT count(*) FROM "LlmUsageEvent") AS usage,
                  (SELECT count(*) FROM "RepositoryScanJob") AS scans,
                  (SELECT count(*) FROM "ComplianceRuleSetVersion") AS "ruleSetVersions"'''
    ).fetchone()
    assert counts == {"usage": 0, "scans": 0, "ruleSetVersions": 0}
    migration = connection.execute(
        '''SELECT count(*) AS count FROM "_prisma_migrations"
           WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'''
    ).fetchone()
    postgres_version = connection.execute("SHOW server_version").fetchone()

health = {}
for name, url in {
    "api": "http://127.0.0.1:4460/health",
    "agent": "http://127.0.0.1:20246/ok",
    "web": "http://127.0.0.1:3360/sign-in",
}.items():
    with urllib.request.urlopen(url, timeout=20) as response:
        health[name] = {"url": url, "status": response.status}
        assert response.status == 200

queues = json.loads(command(
    "docker", "exec", reference["brokerContainer"], "rabbitmqctl",
    "list_queues", "name", "consumers", "messages_ready",
    "messages_unacknowledged", "--formatter=json",
))
main_queues = [q for q in queues if q["name"].startswith("lcsp.agent_runtime.boundary.") and ".retry." not in q["name"]]
assert len(main_queues) == 15 and all(q["consumers"] == 1 for q in main_queues)
assert all(q["messages_ready"] == q["messages_unacknowledged"] == 0 for q in queues)

key = environment["LCSP_SEMANTIC_AUDIT_ATTESTATION_KEY"]
key_matches = {}
for name in ["api", "agent", "bridge"]:
    line = next(l for l in (private / f"{name}.env").read_text().splitlines() if l.startswith("LCSP_SEMANTIC_AUDIT_ATTESTATION_KEY="))
    value = shlex.split(line)[0].partition("=")[2]
    key_matches[name] = value == key
assert key and all(key_matches.values())

logs = {name: (private / f"{name}.log").read_text(errors="replace") for name in ["api", "web", "agent", "bridge"]}
selected_logs = {}
for name, markers in {
    "api": ["Nest application successfully started", "GET /admin/usage 200", "code=RBAC_DENIED", "code=ASSESSMENT_NOT_FOUND"],
    "web": ["GET /sign-in 200", "GET /admin/usage 200", "Cannot access Image.default on the server"],
    "agent": ['"GET /ok HTTP/1.1" 200', '"GET /metrics HTTP/1.1" 404'],
    "bridge": ["Bound Agent Runtime boundary queue=", "404 Not Found", "RuntimeError:"],
}.items():
    selected_logs[name] = {marker: [l for l in logs[name].splitlines() if marker in l][-3:] for marker in markers}

units = {}
for name in ["api", "web", "agent", "bridge"]:
    units[name] = command("systemctl", "--user", "show", f"lcsp360-real-{name}-20261022.service", "--property=Id,ActiveState,MainPID,MemoryMax,MemoryPeak,CPUQuotaPerSecUSec,RuntimeMaxUSec")
    assert "ActiveState=active" in units[name]

proof = {
    "status": "PASS_REAL_RUNTIME_READ_ONLY_CHECKS_NOT_AI_ACCEPTANCE",
    "capturedAt": datetime.now(timezone.utc).isoformat(),
    "sourceSha": command("git", "rev-parse", "HEAD"),
    "sessions": sessions, "allSessionsRevoked": True,
    "counts": counts, "completedMigrations": migration,
    "health": health, "runtimeBoundaryQueues": main_queues, "allQueuesDrained": True,
    "services": units,
    "versions": {
        "node": command("node", "--version"), "python": sys.version,
        "postgres": postgres_version,
        "rabbitmq": command("docker", "exec", reference["brokerContainer"], "rabbitmqctl", "version"),
        "next": json.loads(pathlib.Path("apps/web/node_modules/next/package.json").read_text())["version"],
        "nest": json.loads(pathlib.Path("apps/api/node_modules/@nestjs/core/package.json").read_text())["version"],
        **{p: importlib.metadata.version(p) for p in ["langchain", "langgraph", "pypdf"]},
    },
    "resources": {"diskFreeBytes": shutil.disk_usage(".").free, "memAvailable": next(l for l in pathlib.Path("/proc/meminfo").read_text().splitlines() if l.startswith("MemAvailable:"))},
    "attestationConfiguration": {"nonempty": True, "sameAcrossServices": key_matches, "keySha256": hashlib.sha256(key.encode()).hexdigest(), "authenticSemanticReceipt": "NOT_RUN"},
    "sourceConfigurationSha256": {p: hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest() for p in ["deepagents/config/model_routes.yaml", "apps/web/src/components/atoms/lcsp-logo.tsx", "deepagents/tools/common/capabilities/agent_runtime/rabbitmq_consumer.py"]},
    "selectedLogs": selected_logs,
    "paidCalls": 0, "paidTokens": 0, "paidCostUsd": "0",
    "modelGate": "NOT_RUN; no approved live-inference budget; no model command was submitted",
    "transportSafety": "Worker HTTP(S)/ALL_PROXY points at closed loopback port 9 with localhost exempted; no mock provider responses. systemd user IPAddressDeny capability probe did not enforce a network boundary and is not claimed as protection.",
}
(output / "runtime-infrastructure.json").write_text(json.dumps(proof, indent=2, default=str) + "\n")
print(json.dumps({"status": proof["status"], "sourceSha": proof["sourceSha"], "allSessionsRevoked": True, "counts": counts, "runtimeBoundaryQueues": len(main_queues)}))
