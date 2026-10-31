"""Provider-free load: real RabbitMQ, HTTP server, API slots, native Root and PG checkpoints.

Only the model and repository backend are fixtures. No paid invocation or
production headroom/semantic acceptance is implied by this evidence.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import TypedDict
from unittest.mock import patch

data = json.loads(Path(sys.argv[1]).read_text())
os.environ.update(NESTJS_API_BASE_URL=data["base"], DATABASE_URL=data["databaseUrl"],
    LANGGRAPH_CHECKPOINT_DATABASE_URL=data["checkpointDatabaseUrl"], LCSP_AGENT_RUNTIME_MODE="production",
    LCSP_AGENT_RUNTIME_BOUNDARY_WORKERS="3", LCSP_AGENT_SERVER_MAX_CONCURRENT_JOBS="3",
    LCSP_AGENT_SERVER_URL="http://127.0.0.1:3429", RABBITMQ_URL="amqp://guest:guest@127.0.0.1:5678/",
    LCSP_ROOT_CAPACITY_RABBITMQ_MANAGEMENT_URL="http://127.0.0.1:15678",
    LCSP_AGENT_RUNTIME_RABBITMQ_QUEUE_PREFIX="lcsp364.fixture", LANGCHAIN_TRACING_V2="false")

import httpx
import pika
import psycopg
import uvicorn
from deepagents.backends import FilesystemBackend
from langchain_core.messages import AIMessage
from langgraph.graph import StateGraph, START, END
from langgraph.runtime import Runtime
from assessment_root.boundary import AssessmentRootBoundary
from assessment_root.runner import run_assessment_root
from tools.common.capabilities.agent_runtime import local_server, rabbitmq_consumer as bridge
from tools.common.capabilities.agent_runtime.root_capacity import RootCapacityClient
from vertical.scripted_root import DynamicScriptedModel, full_script, _call
from types import SimpleNamespace

timeline, results = [], {}
result_lock = threading.Lock()
stop_consumers = threading.Event()
prefix = "lcsp364.fixture.assessment_root_requested"
exchange = "lcsp364.fixture"
binding = bridge.BoundaryBinding("assessment_root_requested", "command.assessment.root.requested.v1", prefix)


class DelayedModel(DynamicScriptedModel):
    first: bool = True

    def _generate(self, messages, **kwargs):
        time.sleep(24 if self.first else 0.05)
        self.first = False
        return super()._generate(messages, **kwargs)


def runner(client, assessment_id, **kwargs):
    captured = {}
    steps = full_script(captured) + [lambda m: _call("request_finalization", {}, "finalize"),
        lambda m: _call("submit_final_report", {"summary": "Provider-free fixture report.",
            "findings": [{"assessment_rule_id": rule, "summary": "Follows its accepted fixture decision.",
                "recommendations": []} for rule in ["ER-DEF", "ER-RET", "ER-XREF"]]}, "report")]
    kwargs.update(model=DelayedModel(responses=[], steps=steps), governance=(),
        backend_factory=lambda claim, context: (FilesystemBackend(root_dir=data["repoDir"], virtual_mode=True), None))
    result = run_assessment_root(client, assessment_id, **kwargs)
    with result_lock:
        results[assessment_id] = {"state": result["state"], "finishedAt": time.time()}
    assert result["state"] == "SUCCEEDED", result
    return result


boundary = AssessmentRootBoundary(SimpleNamespace(nestjs_api_base_url=data["base"],
    worker_api_key=os.environ["WORKER_API_KEY"]), runner=runner)


class State(TypedDict):
    messages: list
    result: dict


def fixture_graph(*, checkpointer, store):
    def execute(_state, runtime: Runtime):
        return {"result": boundary.handle(runtime.context["system_event"], "provider-free-load")}
    builder = StateGraph(State, context_schema=dict)
    builder.add_node("registered_assessment_boundary", execute)
    builder.add_edge(START, "registered_assessment_boundary")
    builder.add_edge("registered_assessment_boundary", END)
    return builder.compile(checkpointer=checkpointer, store=store)


def consume(ready):
    connection = pika.BlockingConnection(pika.URLParameters(os.environ["RABBITMQ_URL"]))
    channel = connection.channel()
    with bridge.BoundedBoundaryExecutor(max_workers=3) as executor:
        try:
            bridge._configure_channel(connection=connection, channel=channel, executor=executor,
                exchange=exchange, bindings=(binding,), prefetch_count=3, worker_count=3,
                requeue_on_error=True, requeue_delay_seconds=2, fallback_max_redeliveries=2)
            ready.set()
            while not stop_consumers.is_set():
                connection.process_data_events(time_limit=0.1)
        finally:
            channel.stop_consuming()
            connection.close()


def snapshot(db, submitted, started):
    row = db.execute('SELECT desired,effective,reason FROM "AssessmentRootCapacity"').fetchone()
    active = db.execute('SELECT count(*) FROM "AssessmentRootExecutionSlot" WHERE "releasedAt" IS NULL').fetchone()[0]
    with local_server.app.state.runtime._lock:
        actual = len(local_server.app.state.runtime._executing_root_runs)
    metrics = db.execute('SELECT "runtimeMetrics", "databaseMetrics" FROM "AssessmentRootCapacity"').fetchone()
    runtime, database = metrics[0] or {}, metrics[1] or {}
    point = {"at": time.time(), "elapsedSeconds": time.monotonic() - started, "scenario": submitted,
        "desired": row[0], "effective": row[1], "reason": row[2], "admitted": active, "actualRoots": actual,
        "queued": database.get("queued"), "cpuPressure": runtime.get("cpuPressure"),
        "memoryAvailableBytes": runtime.get("memoryAvailableBytes"), "processRssBytes": runtime.get("processRssBytes"),
        "sandboxMemoryBytes": runtime.get("sandboxMemoryBytes"), "sandboxCpuCores": runtime.get("sandboxCpuCores"),
        "dbConnectionRatio": database.get("dbConnectionRatio"), "checkpointLatencyMs": runtime.get("checkpointLatencyMs"),
        "brokerReady": runtime.get("brokerReady"), "brokerUnacknowledged": runtime.get("brokerUnacknowledged")}
    assert active <= 3 and actual <= 3
    timeline.append(point)
    return point


def main():
    reports = []
    written = False
    with tempfile.TemporaryDirectory(prefix="lcsp364-server-") as temp:
        os.environ["LCSP_AGENT_SERVER_LOCK_PATH"] = str(Path(temp) / "server.lock")
        ready = [threading.Event(), threading.Event()]
        workers = [threading.Thread(target=consume, args=(event,), daemon=True) for event in ready]
        for worker in workers: worker.start()
        for event in ready: assert event.wait(15), "broker setup failed"
        with patch.dict(sys.modules, {"agent": SimpleNamespace(create_root_agent=fixture_graph)}):
            server = uvicorn.Server(uvicorn.Config(local_server.app, host="127.0.0.1", port=3429, log_level="warning"))
            server_thread = threading.Thread(target=server.run, daemon=True)
            server_thread.start()
            db = psycopg.connect(data["checkpointDatabaseUrl"], autocommit=True)
            publisher = pika.BlockingConnection(pika.URLParameters(os.environ["RABBITMQ_URL"]))
            channel = publisher.channel()
            channel.confirm_delivery()
            try:
                deadline = time.monotonic() + 30
                while not server.started:
                    assert time.monotonic() < deadline, "native HTTP server did not start"
                    time.sleep(0.1)
                for case in data["cases"]:
                    count = case["submitted"]
                    started = time.monotonic()
                    started_wall = time.time()
                    for job in case["jobs"]:
                        db.execute('UPDATE "OutboxMessage" SET status=\'PUBLISHED\', "publishedAt"=now() WHERE id=%s', [job["commandId"]])
                        channel.basic_publish(exchange=exchange, routing_key=binding.source_event,
                            body=json.dumps(job["message"]).encode(), mandatory=True,
                            properties=pika.BasicProperties(delivery_mode=2))
                    # Exercise lost ACK/duplicate delivery without another model invocation.
                    channel.basic_publish(exchange=exchange, routing_key=binding.source_event,
                        body=json.dumps(case["jobs"][0]["message"]).encode(), mandatory=True)
                    points = []
                    while True:
                        points.append(snapshot(db, count, started))
                        with result_lock:
                            completed = sum(job["assessmentId"] in results for job in case["jobs"])
                        if completed == count and points[-1]["admitted"] == 0: break
                        assert time.monotonic() - started < 150, f"load scenario {count} did not progress"
                        time.sleep(0.5)
                    ids = [job["assessmentId"] for job in case["jobs"]]
                    assert all(results[assessment_id]["state"] == "SUCCEEDED" for assessment_id in ids), "native fixture Root failed"
                    waits = db.execute('SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY extract(epoch FROM ("startedAt"-%s::timestamp))*1000), '
                        'percentile_cont(0.95) WITHIN GROUP(ORDER BY extract(epoch FROM ("startedAt"-%s::timestamp))*1000) '
                        'FROM "AssessmentRootExecutionSlot" WHERE "assessmentId"=ANY(%s)',
                        [datetime.fromtimestamp(started_wall, UTC).replace(tzinfo=None), datetime.fromtimestamp(started_wall, UTC).replace(tzinfo=None), ids]).fetchone()
                    executions = db.execute('SELECT count(*) FROM "AssessmentRuntimeTurn" WHERE "assessmentId"=ANY(%s)', [ids]).fetchone()[0]
                    assert executions == count, "duplicate delivery invoked a second authoritative Root"
                    spans = db.execute('SELECT "startedAt", "releasedAt" FROM "AssessmentRootExecutionSlot" WHERE "assessmentId"=ANY(%s) ORDER BY "startedAt"', [ids]).fetchall()
                    authoritative_max = max(sum(start <= at < end for start, end in spans) for at, _ in spans)
                    assert authoritative_max <= 3
                    if count >= 2: assert authoritative_max >= 2, "two native Roots never overlapped"
                    order = db.execute('SELECT "assessmentId" FROM "AssessmentRootExecutionSlot" WHERE "assessmentId"=ANY(%s) ORDER BY "admittedAt"', [ids]).fetchall()
                    if count > 1: assert case["jobs"][-1]["assessmentId"] in [item[0] for item in order[:2]], "tenant-skew fairness failed"
                    reports.append({"submitted": count, "completed": completed,
                        "maximumRoots": max(p["actualRoots"] for p in points), "maximumAdmitted": max(p["admitted"] for p in points),
                        "maximumClaimedRootOverlap": authoritative_max,
                        "rootSpans": [{"startedAt": start.isoformat(), "quiescentAt": end.isoformat()} for start, end in spans],
                        "queueWaitP50Ms": waits[0], "queueWaitP95Ms": waits[1],
                        "elapsedSeconds": time.monotonic() - started, "throughputPerMinute": count * 60 / (time.monotonic() - started),
                        "providerRequests": 0, "providerTokens": None, "referenceCost": None,
                        "accountingNote": "Provider-free model has no provider token/price receipt; values remain unknown."})
                    # Observe ordinary demand scale-down automatically between waves.
                    down_deadline = time.monotonic() + 20
                    while snapshot(db, count, started)["effective"] > 1:
                        assert time.monotonic() < down_deadline, "idle capacity did not drain to the configured minimum"
                        time.sleep(0.5)
                runtime = local_server.app.state.runtime
                runtime._draining = True
                runtime._report_capacity()
                assert db.execute('SELECT effective FROM "AssessmentRootCapacity"').fetchone()[0] == 0
                payload = {"scope": "LOCAL_PROVIDER_FREE_NATIVE_INTEGRATION_NOT_PRODUCTION", "capturedAt": time.time(),
                    "physicalCeiling": 3, "bridgeReplicas": 2, "maximumObservedRoots": max(p["actualRoots"] for p in timeline),
                    "scenarios": reports, "timeline": timeline,
                    "limitations": ["Scripted model", "Local filesystem repository fixture; no Docker sandbox workload", "No paid provider accounting", "No production acceptance"]}
                Path(data["output"]).write_text(json.dumps(payload, indent=2))
                written = True
                print(json.dumps({"status": "PASS", "maximumObservedRoots": payload["maximumObservedRoots"]}))
            finally:
                if not written:
                    Path(data["output"]).write_text(json.dumps({"status": "BLOCKED", "scenarios": reports,
                        "scope": "LOCAL_PROVIDER_FREE_NATIVE_INTEGRATION_NOT_PRODUCTION", "timeline": timeline}, indent=2))
                stop_consumers.set()
                for worker in workers: worker.join(timeout=30)
                server.should_exit = True
                server_thread.join(timeout=30)
                db.close()
                for queue in [prefix, bridge._retry_queue_name(prefix, 2), bridge._retry_queue_name(prefix, 15), bridge._retry_queue_name(prefix, 4)]:
                    channel.queue_delete(queue=queue)
                channel.exchange_delete(exchange=exchange)
                publisher.close()


if __name__ == "__main__": main()
