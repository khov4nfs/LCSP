"""Read-only, sanitized Fogewise preflight. Run through the production virtualenv."""
import hashlib
import json
import os
import shutil
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit, unquote


def run(*args):
    return subprocess.check_output(args, text=True, timeout=30).strip()


def main():
    root = Path("/srv/apps/LCSP").resolve()
    from dotenv import dotenv_values
    import psycopg
    env = dotenv_values(root / ".env.pm2")
    result = {"observedAt": datetime.now(UTC).isoformat(), "readOnly": True,
        "host": run("hostname"), "checkout": str(root),
        "revision": run("git", "-C", str(root), "rev-parse", "HEAD"),
        "branch": run("git", "-C", str(root), "branch", "--show-current"),
        "dirtyPaths": run("git", "-C", str(root), "status", "--porcelain").splitlines(),
        "cpuCount": os.cpu_count(), "loadAverage": os.getloadavg(),
        "memory": run("free", "-b"), "disk": dict(zip(("totalBytes", "usedBytes", "freeBytes"), shutil.disk_usage(root))),
        "pressure": {name: Path(f"/proc/pressure/{name}").read_text().strip() for name in ("cpu", "memory", "io")},
        "configurationFingerprints": {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in (root / ".env.pm2", root / "ecosystem.config.cjs", root / "deepagents/uv.lock") if p.exists()},
        "runtimeSettings": {k: v for k, v in env.items() if k in {
            "LCSP_AGENT_RUNTIME_BOUNDARY_WORKERS", "LCSP_AGENT_RUNTIME_RABBITMQ_PREFETCH",
            "LCSP_AGENT_RUNTIME_JOBS_PER_WORKER", "LCSP_AGENT_RUNTIME_MODE", "LCSP_AGENT_RUNTIME_ROLE",
            "LCSP_REPOSITORY_SANDBOX_MEMORY", "LCSP_REPOSITORY_SANDBOX_CPUS", "LCSP_ROOT_CAPACITY_POLICY"}},
    }
    pm2 = json.loads(run("pm2", "jlist"))
    result["processes"] = [{"name": p["name"], "pid": p["pid"], "status": p["pm2_env"]["status"],
        "cwd": p["pm2_env"].get("pm_cwd"), "restarts": p["pm2_env"].get("restart_time"),
        "memoryBytes": p.get("monit", {}).get("memory"), "cpuPercent": p.get("monit", {}).get("cpu")}
        for p in pm2 if p["name"].startswith("lcsp-")]
    owned_pids = {p["pid"] for p in result["processes"]}
    runtime_environment, api_environment = None, None
    process_records = []
    candidates = {}
    for proc in Path("/proc").iterdir():
        if proc.name.isdigit():
            try:
                status = proc.joinpath("status").read_text()
                parent = int(next(line.split()[1] for line in status.splitlines() if line.startswith("PPid:")))
                candidates[int(proc.name)] = (proc, parent, status)
            except (OSError, StopIteration, ValueError):
                pass
    for _ in range(8):
        owned_pids.update(pid for pid, (_, parent, _) in candidates.items() if parent in owned_pids)
    for pid in sorted(owned_pids):
        if pid not in candidates:
            continue
        proc, _, status = candidates[pid]
        try:
            args = proc.joinpath("cmdline").read_bytes().decode().split("\0")
            live_env = dict(item.split("=", 1) for item in proc.joinpath("environ").read_bytes().decode().split("\0") if "=" in item)
            role = ("server" if "tools.common.capabilities.agent_runtime.local_server" in args else
                    "bridge" if "tools.common.capabilities.agent_runtime.rabbitmq_consumer" in args else
                    "api" if any(arg.endswith("apps/api/dist/src/main.js") or arg == "dist/src/main.js" for arg in args) else None)
            if role:
                rss = next((int(line.split()[1]) * 1024 for line in status.splitlines() if line.startswith("VmRSS:")), None)
                process_records.append({"pid": pid, "role": role, "rssBytes": rss,
                    "capacitySettings": {key: live_env[key] for key in (
                        "LCSP_AGENT_RUNTIME_BOUNDARY_WORKERS", "LCSP_AGENT_RUNTIME_RABBITMQ_PREFETCH",
                        "LCSP_AGENT_RUNTIME_JOBS_PER_WORKER", "LCSP_AGENT_RUNTIME_MODE", "LCSP_AGENT_RUNTIME_ROLE") if key in live_env}})
            if role == "server": runtime_environment = live_env
            if role == "api": api_environment = live_env
        except (OSError, UnicodeError, ValueError):
            pass
    result["runtimeProcesses"] = process_records
    result["authoritySources"] = {"api": "PROC_ENV" if api_environment else "DECLARED_ENV_FILE",
        "checkpoints": "PROC_ENV" if runtime_environment else "DECLARED_ENV_FILE"}
    ids = run("docker", "ps", "-q", "--filter", "name=lcsp-repository-sandbox-").split()
    containers = json.loads(run("docker", "inspect", *ids)) if ids else []
    result["sandboxes"] = [{"idHash": hashlib.sha256(c["Id"].encode()).hexdigest()[:16],
        "imageId": c["Image"], "status": c["State"]["Status"],
        "memoryLimitBytes": c["HostConfig"]["Memory"], "nanoCpuLimit": c["HostConfig"]["NanoCpus"]} for c in containers]
    result["sandboxUsage"] = [json.loads(line) for line in run("docker", "stats", "--no-stream", "--format",
        '{"cpuPercent":"{{.CPUPerc}}","memory":"{{.MemUsage}}","pids":"{{.PIDs}}"}', *ids).splitlines()] if ids else []
    image = json.loads(run("docker", "image", "inspect", "lcsp-agent-runtime:production-sandbox"))[0]
    result["sandboxImage"] = {"id": image["Id"], "digests": image.get("RepoDigests"),
        "revision": (image["Config"].get("Labels") or {}).get("org.opencontainers.image.revision"), "createdAt": image["Created"]}
    broker = urlsplit(env["RABBITMQ_URL"])
    vhost = unquote(broker.path[1:]) if broker.path not in {"", "/"} else "/"
    queues = json.loads(run("docker", "exec", "fogewise-rabbitmq", "rabbitmqctl", "list_queues", "-p", vhost,
        "name", "messages_ready", "messages_unacknowledged", "consumers", "memory", "--formatter", "json"))
    result["broker"] = {"vhost": vhost, "queues": [q for q in queues if "lcsp" in q["name"]]}
    result["databases"] = {}
    api_authority = api_environment or env
    checkpoint_authority = runtime_environment or env
    for role, configured_url in {
        "api": api_authority["DATABASE_URL"],
        "checkpoints": checkpoint_authority.get("LANGGRAPH_CHECKPOINT_DATABASE_URL") or checkpoint_authority["DATABASE_URL"],
    }.items():
      parsed = urlsplit(configured_url)
      database_url = urlunsplit(parsed._replace(query=urlencode([(k, v) for k, v in parse_qsl(parsed.query) if k != "schema"])))
      with psycopg.connect(database_url, connect_timeout=5, autocommit=True) as db:
        with db.cursor() as cursor:
            cursor.execute("SET default_transaction_read_only = on")
            started = time.monotonic()
            cursor.execute("SELECT current_database(), current_setting('max_connections'), (SELECT count(*) FROM pg_stat_activity)")
            name, limit, used = cursor.fetchone()
            health = {"database": name, "maxConnections": int(limit), "usedConnections": used,
                "probeLatencyMs": (time.monotonic() - started) * 1000}
            for key, query in {
                "rootExecutionStates": 'SELECT "executionState"::text, count(*) FROM "AssessmentRuntime" GROUP BY 1',
                "assessmentLifecycleStates": 'SELECT "lifecycleState"::text, count(*) FROM "Assessment" GROUP BY 1',
                "activeRootLeases": 'SELECT count(*) FROM "AssessmentRuntime" WHERE "executionState" = \'RUNNING\'',
                "expiredRunningLeases": 'SELECT count(*) FROM "AssessmentRuntime" WHERE "executionState" = \'RUNNING\' AND "leaseExpiresAt" < now()',
                "unfinishedMigrations": 'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL',
            }.items():
                cursor.execute(query)
                health[key] = cursor.fetchall()
            cursor.execute("SELECT to_regclass('public.checkpoints'), to_regclass('public.store')")
            checkpoint_table, store_table = cursor.fetchone()
            if checkpoint_table:
                started = time.monotonic()
                cursor.execute("SELECT count(*) FROM checkpoints")
                health["checkpointRows"] = cursor.fetchone()[0]
                health["checkpointReadLatencyMs"] = (time.monotonic() - started) * 1000
            if store_table:
                cursor.execute("SELECT value->'run'->>'status', count(*) FROM store WHERE prefix LIKE 'lcsp-agent-runtime-runs%' GROUP BY 1")
                health["nativeTransportStates"] = cursor.fetchall()
            result["databases"][role] = health
    result["health"] = {name: run("curl", "--silent", "--output", "/dev/null", "--write-out", "%{http_code}", "--max-time", "5", url)
        for name, url in {"api": "http://127.0.0.1:8080/health", "web": "http://127.0.0.1:3002/", "runtime": "http://127.0.0.1:2024/ok"}.items()}
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
