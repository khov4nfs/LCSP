"""Opt-in live Root semantic evaluation on captured cases, never production domain writes.

The native Root, tools, model routing, usage journal and atomic token admission are real.
The API is a fixture port; its decisions use the actual API validator. Fixture reports are
not production artifacts. No prompt, hidden reasoning or credential is written to evidence.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import shutil
import uuid

from langchain_core.callbacks import BaseCallbackHandler


class ProbeTrace(BaseCallbackHandler):
    """Record tool names and scalar rejection codes, never prompts, reasoning or source bodies."""

    def __init__(self, path):
        self.path = path
        self.names = {}

    def on_tool_start(self, serialized, input_str, *, run_id, **kwargs):
        self.names[str(run_id)] = (serialized or {}).get("name") or kwargs.get("name")

    def on_tool_end(self, output, *, run_id, **kwargs):
        try:
            payload = json.loads(getattr(output, "content", output))
        except (TypeError, ValueError):
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        row = {"at":time.time(), "tool":self.names.pop(str(run_id), None),
               **{key:payload[key] for key in ["ok", "code", "failures"] if key in payload}}
        with self.path.open("a") as stream:
            stream.write(json.dumps(row)+"\n")

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "deepagents"))
sys.path.insert(0, str(ROOT / "deepagents/tests"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Authorize actual metered provider calls for this fixture evaluation")
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--sources", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--repository", type=Path, required=True, help="Read-only public checkout at the captured repository commit")
    parser.add_argument("--mode", choices=["unknown", "confirmed"], required=True)
    parser.add_argument("--case", default="all")
    args = parser.parse_args()
    if not args.live:
        parser.error("--live is required; this evaluator makes real provider calls")
    args.out.mkdir(parents=True, exist_ok=False)
    from dotenv import dotenv_values
    for key, value in dotenv_values(ROOT / ".env").items():
        if value and key.startswith(("INCEPTION_", "MIRAI_", "APX_", "GOOGLE_API_KEY", "GEMINI_API_KEY")):
            os.environ.setdefault(key, value)
    from assessment_root.agent import create_assessment_root_agent
    from assessment_root.client import AssessmentApiError
    from assessment_root.tools import RootRun
    from langgraph.checkpoint.memory import InMemorySaver
    from middleware.paid_admission import TokenPolicy, UnrestrictedRunBudget, fingerprint, request_identity
    from middleware.usage_metering import activate_agent_run_state
    from model_policy import load_model_routes, resolve_agent_model, build_model, DEFAULT_ROUTES_FILE, ROUTES_FILE_ENV
    from provider_credentials import provider_token_source
    from middleware.token_fallback import model_with_token
    from test_operational_applicability import OperativeClient, CASES
    from test_assessment_root_agent import ASSESSMENT, THREAD, EXECUTION
    from deepagents.backends import FilesystemBackend
    from vertical.live_preparation import LiveUsage, recover_usage

    data = json.loads(args.data.read_text())
    source_data = json.loads(args.sources.read_text())
    sources = source_data["linked"]
    corpus = source_data["corpus"]
    candidate = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    route_file = Path(os.getenv(ROUTES_FILE_ENV) or DEFAULT_ROUTES_FILE)
    routes = load_model_routes()
    salt = os.urandom(32).hex()
    now = int(time.time())
    policies = {}
    for route in routes.routes:
        config = routes.config(route)
        for token in (provider_token_source(config.provider) or (None, ()))[1]:
            model = model_with_token(build_model(config), config.provider, token)
            identity = request_identity(model, salt)
            policies[(identity["route_id"], identity["credential_fingerprint"])] = TokenPolicy(
                **identity, valid_from=now - 1, expires_at=now + 7200,
                input_upper_bound=1_000_000, output_upper_bound=max(32768, int(config.options.get("max_output_tokens", 32768))),
            )

    results = []
    for row in CASES:
        if args.case not in ["all", row["assessmentRuleId"]]:
            continue
        name = row["assessmentRuleId"]
        directory = args.out / name
        directory.mkdir()

        class Client(OperativeClient):
            def __init__(self):
                super().__init__(row)
                self.accepted = []
                self.new_evidence = []
                self.new_facts = []
                self.rejections = []
                self.case_revision = 8
                self.rule_set_override["ruleSetVersionId"] = row["decision"]["ruleSetVersionId"]
                self.rule_set_override["assessmentRules"][0]["concept"] = name
                self.rule_set_override["legalRequirements"][0].update(
                    proposition=next(r["proposition"] for r in data["rules"] if r["assessmentRuleId"] == name),
                    applicabilityMode="UNCONDITIONAL",
                    sources=[{k: source[k] for k in ["documentId", "locator", "contentSha256", "legalEffectStatus", "legalStatusSourceRef"]}
                             for source in sources if source["legalRequirementId"] == row["legalRequirementId"]],
                )
                if args.mode == "confirmed":
                    self.statement = (
                        "A verified company established and operating in Vietnam runs this service live for real adult Vietnamese customers. "
                        "It decides purposes and means and directly processes their personal data, including names, addresses and financial records. "
                        "It relies on consent for this processing; verified data-subject consent, correction, withdrawal and restriction requests exist and apply after the law took effect. The customer confirms that the six evaluated consent, correction and withdrawal "
                        "safeguards have not been implemented in any external system or policy. The operator confirms it provides no consent information or consent records, "
                        "does not honor the verified correction/withdrawal requests, bundles unrelated marketing purposes without separate choice, "
                        "and treats silence as consent. These facts are supplied by the authorized operator."
                    )

            def context(self):
                context = super().context()
                for record in data["facts"]:
                    if record["authority"] == "EVIDENCE_CITED":
                        context["facts"].append({**record, "evidenceIds":[e["evidenceId"] for e in data["evidence"] if e["type"] == "REPOSITORY_SOURCE"]})
                context.update({k:row["decision"][k] for k in ["repositoryCommit", "repositorySnapshotId", "ruleSetVersionId"]})
                # The positive scenario replaces historical unknown-operation answers with explicit
                # synthetic operation facts. Retaining both would create a contradictory control.
                context["evidence"] = [e for e in data["evidence"] if args.mode == "unknown" or e["type"] != "HUMAN_ANSWER"] + self.new_evidence
                context["facts"].extend(self.new_facts)
                current = [packet for packet in self.accepted if packet["caseRevision"] == self.case_revision]
                if current:
                    context["coverage"][0].update(resolutionState="RESOLVED", currentDecisionId="fixture-accepted", decisionRevision=len(self.accepted))
                return context

            def post_evidence(self, body):
                evidence_id = str(uuid.uuid5(uuid.NAMESPACE_URL, json.dumps(body, sort_keys=True)))
                if not any(e["evidenceId"] == evidence_id for e in self.new_evidence):
                    self.new_evidence.append({"evidenceId":evidence_id,"state":"ACCEPTED", "type":body["type"],
                                              "repositoryCommit":body["repositoryCommit"],"payload":body})
                return {"evidenceId":evidence_id,"state":"ACCEPTED","replayed":False}

            def post_fact(self, body):
                self.case_revision += 1
                fact_id = str(uuid.uuid4())
                self.new_facts.append({"factId":fact_id,"caseRevision":self.case_revision,"kind":body["kind"],
                                       "authority":"EVIDENCE_CITED","state":"ACCEPTED","statement":body["statement"],"evidenceIds":body["evidenceIds"]})
                return {"factId":fact_id,"caseRevision":self.case_revision}

            def legal_source_text(self, document_id, locator):
                source = next((s for s in corpus if s["documentId"] == document_id and s["locator"] == locator), None)
                if source is None:
                    raise AssessmentApiError(404, "LEGAL_SOURCE_PROVISION_NOT_FOUND")
                return source

            def legal_source_search(self, query):
                words = query.lower().split()
                return {"matches":[{**{k:s[k] for k in ["documentId", "locator", "contentSha256"]}, "snippet":s["content"][:300]}
                                   for s in corpus if all(w in s["content"].lower() for w in words)], "truncated":False}

            def rule_decisions(self, rule_id, revision=None):
                records = [{"decisionId":"historical-fixture", "decisionRevision":1,
                            "state":"INVALIDATED", "decision":row["decision"]}]
                records.extend({"decisionId":f"fixture-{index}", "decisionRevision":index + 2,
                                "state":"ACCEPTED" if packet["caseRevision"] == self.case_revision else "INVALIDATED",
                                "decision":packet} for index, packet in enumerate(self.accepted))
                return {"records":records}

            def post_decision(self, body):
                context = self.context()
                packet = body["decision"]
                validation = {
                    "caseRevision":context["caseRevision"], "pins":context,
                    "rule":{"assessmentRuleId":name, "assessmentRuleVersion":"v1",
                            "criterionIds":[c["criterionId"] for c in row["criteria"]], "legalContextIds":[row["legalRequirementId"]],
                            "declaredElements":[[row["legalRequirementId"], {"applicabilityConditions":len(row["applicabilityConditions"]),
                             "qualifiers":len(row["qualifiers"]), "exceptions":len(row["exceptions"]), "operativeScopes":len(row["operativePropositions"])}]]},
                    "evidence":[[e["evidenceId"], {**e, "repositoryCommit":context["repositoryCommit"]}] for e in context["evidence"]],
                    "facts":[[f["factId"], f] for f in context["facts"]],
                }
                check = subprocess.run(["pnpm", "exec", "tsx", "apps/api/test/support/validate-operational-probe.ts"], cwd=ROOT,
                                       input=json.dumps({"decision":packet,"context":validation}), capture_output=True, text=True)
                if check.returncode:
                    raise RuntimeError("Actual API decision validator adapter failed")
                failures = json.loads(check.stdout)
                if failures:
                    self.rejections.extend(failures)
                    raise AssessmentApiError(422, "DECISION_VALIDATION_FAILED", {"failures":",".join(f["code"]+":"+f["ref"] for f in failures)})
                if packet in self.accepted:
                    return {"decisionId":"fixture-accepted", "decisionRevision":len(self.accepted), "replayed":True}
                self.accepted.append(packet)
                return super().post_decision(body)

            def request_finalization(self):
                if not self.accepted or self.open_requests:
                    raise AssessmentApiError(422, "ASSESSMENT_COMPLETION_BLOCKED")
                return super().request_finalization()

        client = Client()
        public_commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=args.repository, text=True).strip()
        if public_commit != row["decision"]["repositoryCommit"]:
            raise ValueError("Public repository differs from captured evidence pin")
        source_root = directory / "repository"
        shutil.copytree(args.repository, source_root, ignore=shutil.ignore_patterns(".git"))
        run = RootRun(client=client,assessment_id=ASSESSMENT,thread_id=THREAD,execution_id=EXECUTION,
                      backend=FilesystemBackend(root_dir=source_root,virtual_mode=True))
        run.adopt_context(client.context())
        # Pinned public capability evidence is already accepted in this captured fixture.
        run_id = "lcsp346-semantic-fixture-" + uuid.uuid4().hex
        budget = UnrestrictedRunBudget(schema_version=4, mode="UNRESTRICTED", paid_inference_approved=True,
            approval_reference="User-authorized LCSP-346 semantic acceptance recovery; six captured fixtures only",
            run_id=run_id, candidate_sha=candidate,
            model_routes_sha256=hashlib.sha256(route_file.read_bytes()).hexdigest(), credential_salt=salt,
            valid_from=now - 1, policies=tuple(policies.values()))
        usage_path = str(directory / "usage.json")
        state = LiveUsage(run_id, usage_path, budget=budget, budget_fingerprint=fingerprint(budget.model_dump(mode="json")), bounded=True)
        state.agent_role = "assessment-root"
        graph = create_assessment_root_agent(run=run, model=resolve_agent_model("assessment-root"), checkpointer=InMemorySaver(), graph_tools=[])
        failure = None
        output = {}
        try:
            with activate_agent_run_state(state):
                output = graph.invoke({"messages":[{"role":"user", "content":"Investigate this assessment using the current pinned rule, source and accepted facts. Reconsider historical decisions at the current revision."}]},
                    {"configurable":{"thread_id":run.thread_id}, "callbacks":[ProbeTrace(directory / "tool-outcomes.jsonl")]}, durability="sync")
        except (Exception, KeyboardInterrupt) as error:
            failure = {"type":type(error).__name__, "admissionReason":getattr(error, "reason", None)}
        usage = recover_usage(usage_path, run_id)
        result = {"case":name,"mode":args.mode,"candidateSha":candidate,"fixtureApiOnly":True,
                  "syntheticOperationalFacts":args.mode == "confirmed",
                  "acceptedDecisions":client.accepted,"newEvidence":client.new_evidence,"newFacts":client.new_facts,"validationRejections":client.rejections,
                  "nativeInterrupted":bool(output.get("__interrupt__")), "openRequestIds":client.open_requests,
                  "requests":[body for kind, body in client.calls if kind == "human"],
                  "fixtureLifecycle":client.lifecycle_state,"failure":failure,"usage":usage}
        result["expectedBehaviorObserved"] = (not failure and not client.accepted and bool(output.get("__interrupt__"))) if args.mode == "unknown" else (
            not failure and bool(client.accepted) and all(d["applicability"] == "APPLICABLE" for d in client.accepted)
        )
        (directory / "result.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
        results.append(result)
        print(json.dumps({"case":name,"mode":args.mode,"expectedBehaviorObserved":result["expectedBehaviorObserved"],"physicalAttempts":usage.get("admission",{}).get("admittedAttempts"),"failure":failure}),flush=True)
        if failure and failure["type"] == "KeyboardInterrupt":
            break
    summary = {"candidateSha":candidate,"fixtureApiOnly":True,"mode":args.mode,"cases":results,
               "allExpectedBehaviorObserved":bool(results) and all(r["expectedBehaviorObserved"] for r in results)}
    (args.out / "summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n")
    return 0 if summary["allExpectedBehaviorObserved"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
