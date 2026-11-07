"""Provider-free HITL review through real API, native graph and durable PostgreSQL checkpoints."""
from __future__ import annotations

import io
import json
import os
from pathlib import Path
import sys
import tarfile

from deepagents.backends import FilesystemBackend
from langchain_core.messages import AIMessage
from langgraph.checkpoint.postgres import PostgresSaver

from assessment_root.client import AssessmentRuntimeClient
from assessment_root.runner import run_assessment_root
from tools.common.capabilities.platform.repository_sandbox import (
    _sanitize_archive, RuntimeRepositoryFilesystemBackend, activate_repository_backend,
)
from vertical.scripted_root import BoundedReadStep, DynamicScriptedModel, _catalog_read, _call


def main():
    # Synthetic admission is created by the isolated provider-free JS fixture only.
    from orchestration.runtime_control import active_runtime_run_id, active_runtime_incarnation_id
    active_runtime_run_id.set(os.environ["LCSP_TEST_ROOT_RUNTIME_RUN_ID"])
    active_runtime_incarnation_id.set(os.environ["LCSP_TEST_ROOT_INCARNATION_ID"])
    base, key, assessment_id, fixture_dir, mode, request_id = sys.argv[1:7]
    captured = {}
    client = AssessmentRuntimeClient(base, key)
    native_claim = client.claim
    native_context = client.context

    def claim(identity):
        result = native_claim(identity)
        captured["claim"] = {name: result.get(name) for name in
                             ["checkpointThreadId", "threadId", "executionId", "resumeCheckpointId", "humanAnswerReviewRequired", "humanAnswerReviewCheckpointId", "humanAnswerReviewExecutionId", "recoveredExecution"]}
        return result

    def context():
        result = native_context()
        captured["context"] = result
        return result

    client.claim = claim
    client.context = context

    def backend(claim, context):
        # The real archive sanitizer excludes customer-authored runtime state before source is visible.
        thread_root = Path(fixture_dir) / assessment_id
        source_root = thread_root / "workspace/repository"
        source_root.mkdir(parents=True, exist_ok=True)
        entries = {
            "snapshot/README.md": ("Historical notification ownership records were permanently destroyed; no alternate source is available.\n"
                                   if mode == "ask-block" else "Notification ownership is maintained outside this repository.\n"),
            "snapshot/src/notice.py": "notification_enabled = True\n",
            "snapshot/.lcsp/injected.txt": "EXCLUDED_SCOPE_SENTINEL",
        }
        existing_readme = source_root / "README.md"
        if existing_readme.exists():
            entries["snapshot/README.md"] = existing_readme.read_text()
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode="w:gz") as bundle:
            for name, text in entries.items():
                payload = text.encode()
                member = tarfile.TarInfo(name)
                member.size = len(payload)
                bundle.addfile(member, io.BytesIO(payload))
        clean, coverage = _sanitize_archive(archive.getvalue(), snapshot_id=context["repositorySnapshotId"])
        with tarfile.open(fileobj=io.BytesIO(clean), mode="r:gz") as bundle:
            bundle.extractall(source_root, filter="data")
        assert not (source_root / ".lcsp/injected.txt").exists()
        assert any(row["path"] == ".lcsp/injected.txt" for row in coverage["skippedEntries"])
        marker = source_root / ".lcsp/repository.json"
        marker.parent.mkdir(exist_ok=True)
        marker.write_text(json.dumps({"assessmentId": assessment_id, "snapshotId":context["repositorySnapshotId"],
                                      "commitSha":context["repositoryCommit"], "sourceCoverage":coverage}))
        captured["sourceRoot"] = {"snapshotId":context["repositorySnapshotId"],
                                  "commitSha":context["repositoryCommit"],"coverage":coverage}
        (thread_root / "other-project").mkdir(exist_ok=True)
        (thread_root / "other-project/private.txt").write_text("PRIVATE_SCOPE_SENTINEL")
        thread_backend = FilesystemBackend(root_dir=thread_root, virtual_mode=True)
        runtime_backend = RuntimeRepositoryFilesystemBackend(read_only_repository=True)
        with activate_repository_backend(thread_backend):
            assert "PRIVATE_SCOPE_SENTINEL" not in str(runtime_backend.read("/other-project/private.txt"))
            assert "notification_enabled" in str(runtime_backend.read("/src/notice.py"))
            denied = runtime_backend.write("/src/forged.py", "forbidden")
            assert denied.error is not None
        captured["sourceRoot"]["outsideScopeExcluded"] = True
        captured["sourceRoot"]["sourceWriteDenied"] = True
        return runtime_backend, activate_repository_backend(thread_backend)

    catalog = {}
    steps = [BoundedReadStep(_catalog_read(catalog), "phase2-catalog", catalog)]

    def ask(messages):
        rules = catalog["rule_set"]
        by_id = {row["assessmentRuleId"]:row for row in rules["assessmentRules"]}
        args = {"assessment_rule_id":"ER-RET", "criterion_ids":by_id["ER-RET"]["criterionIds"],
                "question":"Who owns the customer notification process?",
                "unresolved_fact":"Customer notification process owner",
                "decision_impact":["Establishes the owner for the notification duties."],
                "resolution_attempts":["Reviewed pinned source; operational ownership is not established."]}
        if mode == "reuse":
            args["assessment_rule_id"] = "ER-XREF"
            args["criterion_ids"] = by_id["ER-XREF"]["criterionIds"]
            args["source_request_id"] = request_id
        if mode == "shared":
            args["dependencies"] = [{"assessment_rule_id":"ER-XREF", "criterion_ids":by_id["ER-XREF"]["criterionIds"]}]
        return _call("open_human_request", args, "phase2-human")

    if mode in {"ask", "ask-block", "shared", "reuse"}:
        if mode == "ask-block":
            steps += [lambda m: _call("cite_repository_source", {"path":"README.md", "start_line":1, "end_line":1}, "phase2-initial-evidence")]
        steps += [ask]
    elif mode in {"block", "block-crash"}:
        steps += [
            lambda m: _call("report_existing_human_fact_unresolvable", {
                "request_id":request_id,
                "unavailability_rationale":"Pinned source records permanent destruction of ownership records and no alternate source under this assessment contract.",
                "evidence_ids":[row["evidenceId"] for row in captured["context"]["evidence"] if row["type"] == "REPOSITORY_SOURCE"]}, "phase2-block")]
    elif mode in {"wait", "wait-crash"}:
        steps += [lambda m: _call("wait_for_human_requests", {}, "phase2-wait")]
    elif mode == "review-fail":
        def fail_after_complete_catalog(messages):
            # This marker proves that failure came from the intended scripted
            # model step, after BoundedReadStep consumed every actual tool reply.
            assert "rule_set" in catalog
            captured["scriptedFailure"] = "phase2_review_model_failure"
            raise RuntimeError(captured["scriptedFailure"])

        steps += [fail_after_complete_catalog]
    elif mode not in {"known", "recover"}:
        raise ValueError("unknown phase2 fixture mode")

    # Known-answer continuation deliberately stops before verdicts: the runner must fail rather than
    # invent domain completion. Assertions outside verify accepted facts and independent coverage.
    steps += [lambda m: AIMessage(content="Accepted facts reloaded; rule investigation remains pending.")]
    model = DynamicScriptedModel(responses=[], steps=steps)
    if mode in {"block-crash", "wait-crash"}:
        client.finish = lambda *args, **kwargs: os._exit(73)
    with PostgresSaver.from_conn_string(os.environ["LANGGRAPH_CHECKPOINT_DATABASE_URL"]) as saver:
        saver.setup()
        result = run_assessment_root(client, assessment_id, backend_factory=backend,
                                     model=model, checkpointer=saver, governance=())
        saved = saver.get_tuple({"configurable":{"thread_id":captured["claim"]["checkpointThreadId"]}})
        output = {"result":result, **captured, "pid":os.getpid(), "modelTurns":len(model.prompts), "remainingSteps":len(model.steps),
                  "catalogReads":catalog.get("boundedReads", []),
                  "catalogReadComplete":"rule_set" in catalog,
                  "catalogRuleIds":[row["assessmentRuleId"] for row in catalog.get("rule_set", {}).get("assessmentRules", [])],
                  "checkpoint":saved.config["configurable"]["checkpoint_id"] if saved else None}
        print(json.dumps(output))


if __name__ == "__main__":
    from approved_bundle_fixture import offline_instruction_bundle
    with offline_instruction_bundle():
        main()
