"""Drive the real claim-first Preparation journey with a provider-free model.

Used by tests/compliance-rule-set-vertical.mjs. The model is scripted; everything else is real:
the Deep Agent graph, tool surface, WorkerApiClient HTTP calls, API, validator and PostgreSQL.
Claims are scripted mechanical fixtures; no legal-model quality is established.

usage: scripted_preparation.py <apiBase> <workerKey> <runId> <seedJson> <mode>
modes: valid | stale | orphan | no-submit
"""

from __future__ import annotations

import json
import sys
from contextlib import ExitStack
from typing import Any
from unittest.mock import patch

from langchain_core.messages import AIMessage

from rule_set_preparation import runner as runner_module
from rule_set_preparation.runner import run_rule_set_preparation
from authoring_memory_harness import ViewDrivenModel, last_result
from rule_set_preparation.claim_inventory import FRAME_FIELDS
from tools.common.capabilities.platform.api_client import WorkerApiClient

DOC = "SYNTHETIC-NOTICE-INSTRUMENT"


def _ref(hashes: dict[str, str], locator: str, *, hash_override: str | None = None) -> dict[str, str]:
    return {"documentId": DOC, "locator": locator, "contentSha256": hash_override or hashes[locator]}


def _legal(rule_id: str, locators: list[str], hashes: dict[str, str], *, duty: bool = False) -> dict[str, Any]:
    return {
        "legalRequirementId": rule_id,
        "title": f"Rule {rule_id}",
        "proposition": f"Proposition {rule_id}.",
        "applicabilityConditions": [] if duty else ["Applies to the service that stores notices."],
        "qualifiers": [],
        "exceptions": [],
        "nonRepositoryDuty": duty,
        "sourceRefs": [_ref(hashes, loc) for loc in locators],
        "coverage": (
            {"state": "NON_ASSESSABLE", "nonAssessableReason": "Not establishable from a repository."}
            if duty
            else {"state": "COVERED_BY_ASSESSMENT_RULES", "nonAssessableReason": None}
        ),
    }


def _assessment_rule(rule_id: str, legal_ids: list[str], locators: list[str], hashes: dict[str, str]) -> dict[str, Any]:
    return {
        "assessmentRuleId": rule_id,
        "legalRequirementIds": legal_ids,
        "concept": f"Concept {rule_id}",
        "legalIntent": "Ensure the legal intent is met.",
        "applicabilityGuidance": "Applies when the described condition holds.",
        "criteria": [{"criterionId": "C-1", "statement": "The control exists."}],
        "investigationGoals": ["find the control"],
        "startingNodeTypes": [], "targetNodeTypes": [], "edgeStrategies": [],
        "graphQueries": [], "keywords": [], "commonApis": [], "commonLibraries": [],
        "patterns": [], "requiredEvidence": ["control implementation"],
        "supportingEvidence": [], "negativeEvidence": [], "unresolvedConditions": [],
        "sourceRefs": [_ref(hashes, loc) for loc in locators],
    }


def build_packet(hashes: dict[str, str]) -> dict[str, Any]:
    return {
        "legalRequirements": [
            _legal("LR-DEF", ["art-1::cl-1"], hashes),
            _legal("LR-RET", ["art-5::cl-1::pt-a", "art-5::cl-1::pt-b"], hashes),
            _legal("LR-EXC", ["art-3::cl-1"], hashes),
            _legal("LR-XREF", ["art-4::cl-1::pt-a", "art-2::cl-1"], hashes),
            _legal("LR-PERSON", ["art-6::cl-1"], hashes, duty=True),
        ],
        "assessmentRules": [
            _assessment_rule("ER-DEF", ["LR-DEF"], ["art-1::cl-1"], hashes),
            _assessment_rule("ER-RET", ["LR-RET", "LR-EXC"], ["art-5::cl-1::pt-a", "art-3::cl-1"], hashes),
            _assessment_rule("ER-XREF", ["LR-XREF"], ["art-4::cl-1::pt-a"], hashes),
        ],
        "contextRelations": [
            {"relationId": "REL-EXC", "kind": "CROSS_REFERENCE", "fromLegalRequirementId": "LR-RET",
             "toLegalRequirementId": "LR-EXC", "toSourceRef": None},
            {"relationId": "REL-DEF", "kind": "CROSS_REFERENCE", "fromLegalRequirementId": "LR-XREF",
             "toLegalRequirementId": "LR-DEF", "toSourceRef": None},
        ],
    }


def _call(name: str, args: dict[str, Any], call_id: str) -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": call_id}])


def main() -> int:
    base, key, run_id, seed_path, mode = sys.argv[1:6]
    seed = json.loads(open(seed_path, encoding="utf-8").read())
    hashes: dict[str, str] = seed["hashes"]
    api = WorkerApiClient(base, key)

    packet = seed.get("packet") or build_packet(hashes)
    calls = []
    context = None

    def direct_journey():
        source = context.source_graph
        rules = {r["legalRequirementIds"][0]: r for r in packet["assessmentRules"]}
        values = []
        for row in packet["legalRequirements"]:
            support = []
            for ref in row["sourceRefs"]:
                nid = source.resolve_locator(ref["documentId"], ref["locator"])
                assert nid, ref
                support.append({"nodeId": nid, "quote": source.nodes[nid]["content"]})
            rule = rules.get(row["legalRequirementId"])
            conditions = [{"statement": text, "support": support} for text in row["applicabilityConditions"]]
            values.append({
                "candidateId": row["legalRequirementId"], "title": row["title"],
                "obligations": [{"statement": row["proposition"], "actor": "Synthetic fixture operator", "modality": "DUTY", "action": row["proposition"], "support": support}],
                "applicability": {"mode": "CONDITIONAL" if conditions else "UNCONDITIONAL", "conditions": conditions},
                "qualifiers": [{"statement": text, "support": support} for text in row["qualifiers"]],
                "exceptions": [{"statement": text, "support": support} for text in row["exceptions"]], "definitions": [],
                "repositoryAssessability": "REPOSITORY_VERIFIABLE" if rule else "EXTERNAL_FULFILLMENT",
                "nonAssessableReason": None if rule else "Synthetic duty outside the repository-verifiable fixture assertions.",
                "assessmentRule": {"assessmentRuleId": rule["assessmentRuleId"], "concept": rule["concept"], "investigationFocus": rule["legalIntent"]} if rule else None,
            })
        if mode == "stale":
            values[0]["obligations"][0]["support"][0]["quote"] = "An absent source quotation"
        if mode == "orphan":
            # Direct candidates own their rule; reusing another candidate's identity must fail.
            governed = [candidate for candidate in values if candidate["assessmentRule"]]
            governed[1]["assessmentRule"]["assessmentRuleId"] = governed[0]["assessmentRule"]["assessmentRuleId"]
        package = yield "get_next_legal_analysis_package", {}
        while not package.get("complete"):
            assert package.get("outcome") == "PASSED", package
            ids = {unit["nodeId"] for unit in package["sourceUnits"]}
            candidates = [candidate for candidate in values if candidate["candidateId"] not in context.draft["legalRequirements"]
                          and any(ref["nodeId"] in ids for fact in candidate["obligations"] for ref in fact["support"])]
            payload = {"packageId": package["packageId"], "candidates": candidates, "removeCandidateIds": [], "legalEffects": [],
                       "references": [{"referenceId": ref["referenceId"], "material": False, "reason": "Synthetic fixture states its duties locally; no incorporated duty.", "kind": None, "fromCandidateId": None, "targetNodeId": None} for ref in package["references"]],
                       "sourceUnits": [{"sourceNodeId": nid, "disposition": "ANALYZED" if any(ref["nodeId"] == nid for candidate in candidates for fact in candidate["obligations"] for ref in fact["support"]) else "NO_REQUIREMENT", "reason": "Fixture context has no separate operative duty."} for nid in ids]}
            result = yield "submit_rule_set_draft_candidates", payload
            if result.get("outcome") != "PASSED":
                yield "submit_compliance_rule_set", {}
                raise AssertionError(json.dumps(result))
            package = result["nextPackage"]
        validation = yield "validate_compliance_rule_set", {}
        assert validation["outcome"] == "PASSED", validation
        yield "submit_compliance_rule_set", {}

    def journey():
        # The coordinating parent has no file tools: the claim-author children read and write the files.
        if mode == "no-submit":
            yield "report_rule_set_source_blocked", {
                "reason": "SOURCE_PINS_INCONSISTENT", "path": "/legal-source/INDEX.md"}
            return
        if context.direct_draft:
            yield from direct_journey()
            return
        from rule_set_preparation.claim_files import claim_path
        from rule_set_preparation.claim_inventory import identity_key
        source = context.source_graph
        files = {}
        locations = {}
        for path, ids in source.source_files.items():
            for row in packet["legalRequirements"]:
                wanted = {r["locator"] for r in row["sourceRefs"]}
                anchors = [nid for nid in ids if any(source.chunks[c]["locator"] in wanted for c in source.chunk_ids.get(nid, []))]
                if anchors:
                    locations.setdefault(row["legalRequirementId"], []).append((path, anchors))
        for path, ids in source.source_files.items():
            claims = []
            for row in packet["legalRequirements"]:
                key = row["legalRequirementId"]
                anchors = next((nodes for owner, nodes in locations.get(key, []) if owner == path), [])
                if not anchors:
                    continue
                support = [{"locator": source.locators[nid], "quote": source.nodes[nid]["content"]} for nid in anchors]
                if mode == "stale":
                    support[0]["quote"] = "An absent source quotation"
                # One claim file per Article: a requirement spanning Articles has one DUTY per Article, tied together by a single
                # SCOPE (kept in the last Article) whose CONDITION_OF relations reach every Article's DUTY, so their closures agree.
                owners = [owner for owner, _ in locations[key]]
                scope = {"key": key + "-scope", "type": "SCOPE", "statement": " ".join(row["applicabilityConditions"]) or "Applies to the synthetic notice service.",
                    "authority": "LEGAL_NORMATIVE", "assessability": "NON_ASSESSABLE", "support": support,
                    "relations": [{"kind": "CONDITION_OF", "to": key + "-duty"}, *[
                        {"kind": "CONDITION_OF", "to": claim_path(earlier).removeprefix('/work/claims/') + "#" + key + "-duty"} for earlier in owners[:-1]]]}
                duty = {"key": key + "-duty", "type": "DUTY", "statement": row["proposition"], "actor": "Synthetic notice operator", "action": row["proposition"],
                    "authority": "LEGAL_NORMATIVE", "frame": seed.get("semanticFrames", {}).get(key, {}),
                    "assessability": seed.get("assessability", {}).get(key, "EXTERNAL_FULFILLMENT" if row["nonRepositoryDuty"] else "REPOSITORY_VERIFIABLE"), "support": support}
                claims += ([scope] if owners[-1] == path else []) + [duty]
            covered = {span["locator"] for claim in claims for span in claim["support"]}
            files[path] = {"article": source.file_articles[path], "claims": claims,
                "noClaims": {source.locators[nid]: "Structural fixture outside the scripted assertions." for nid in ids if source.locators[nid] not in covered},
                "references": {rid: {"material": False, "reason": "Mechanical fixture defines assertions locally; no incorporation is scripted."}
                    for rid, owner in source.reference_owners().items() if owner in ids}}
        for edge in packet["contextRelations"]:
            targets = locations.get(edge["toLegalRequirementId"], [])
            if not targets:
                continue
            target_path = claim_path(targets[0][0]).removeprefix('/work/claims/') + '#' + edge['toLegalRequirementId'] + '-duty'
            for path, _ in locations.get(edge["fromLegalRequirementId"], []):
                next(c for c in files[path]['claims'] if c['key'] == edge['fromLegalRequirementId'] + '-duty').setdefault('relations', []).append({'kind': edge['kind'], 'to': target_path})
        status = yield "discovery_status", {}
        while status.get("assignments"):
            completed_before = len(context.draft['sourceAccounting'])
            for assignment in status['assignments']:
                assigned[0] = (assignment['sourceFiles'][0], files[assignment['sourceFiles'][0]])
                yield 'task', {'subagent_type': 'claim-author', 'description': json.dumps(assignment)}
            status = yield 'discovery_status', {}
            if len(context.draft['sourceAccounting']) == completed_before:
                break
        operands = {key: [] for key in locations}
        scopes = {key: [] for key in locations}
        for key, owners in locations.items():
            for path, _ in owners:
                prefix = claim_path(path).removeprefix('/work/claims/') + '#'
                for suffix, dest in [('-duty', operands), ('-scope', scopes)]:
                    dest[key].extend(cid for cid, identity in context.inventory.identities.items() if identity == identity_key(prefix + key + suffix))
        frozen = yield "finalize_semantic_claim_inventory", {}
        assert frozen["outcome"] == "PASSED", frozen
        started = yield "start_rule_authoring", {}
        assert started["outcome"] == "PASSED", started
        for row in packet["legalRequirements"]:
            key = row["legalRequirementId"]
            result = yield "author_legal_requirement", {
                "requirement_key": key, "title": row["title"],
                "operative_claim_ids": operands[key], "applicability_claim_ids": scopes[key],
                "non_repository_duty": row["nonRepositoryDuty"]}
            assert result["outcome"] == "PASSED", result
        for row in packet["assessmentRules"]:
            result = yield "author_assessment_rule", {
                "assessment_rule_id": row["assessmentRuleId"], "concept": row["concept"],
                "legal_requirement_ids": ["LR-MISSING"] if mode == "orphan" else row["legalRequirementIds"]}
            if mode != "orphan":
                assert result["outcome"] == "PASSED", result
        validation = yield "validate_compliance_rule_set", {}
        if mode == "valid":
            assert validation["outcome"] == "PASSED", validation
        yield "submit_compliance_rule_set", {}

    assigned = [None]
    child_rejections = []
    script = journey()
    child_script = None
    def child_journey():
        from rule_set_preparation.claim_files import claim_path
        path, value = assigned[0]
        yield 'read_file', {'file_path': path}
        yield 'write_file', {'file_path': claim_path(path), 'content': json.dumps(value)}
        yield 'commit_claims', {'paths': [claim_path(path)]}
    first = True
    def policy(messages, model):
        nonlocal first, child_script
        from middleware.usage_metering import active_agent_role
        if active_agent_role() == 'claim-author':
            rejected = last_result(messages)
            if isinstance(rejected, dict) and rejected.get("errors"):
                child_rejections.append(rejected["errors"])
            if child_script is None:
                child_script = child_journey()
            try:
                name, args = next(child_script)
                return _call(name, args, 'child-' + name)
            except StopIteration:
                child_script = None
                return AIMessage(content='done: 1 Article')
        result = last_result(messages)
        if result is None and context.direct_draft:
            # Direct compaction retains its receipt in the model-visible package message.
            for message in reversed(messages):
                content = getattr(message, "content", None)
                if isinstance(content, str) and content.startswith("Accepted candidates are persisted."):
                    result = json.loads(content.split("\n", 1)[1])
                    break
        if calls and result is not None:
            calls[-1]["result"] = {k: result[k] for k in ("outcome", "gaps", "fingerprint", "failures", "errors", "detail") if k in result}
        try:
            name, args = next(script) if first else script.send(result)
        except StopIteration as error:
            raise AssertionError("Scripted Preparation exhausted without an API terminal") from error
        first = False
        calls.append({"tool": name})
        return _call(name, args, f"script-{len(calls)}")

    model = ViewDrivenModel(policy=policy)
    real_create = runner_module.create_rule_set_preparation_agent
    def create(**kwargs):
        nonlocal context
        context = kwargs["context"]
        return real_create(**kwargs)
    # The offline model has no provider route; routing is covered by the SDK-backed governance tests.
    with ExitStack() as stack:
        stack.enter_context(patch("rule_set_preparation.agent.MODEL_GOVERNANCE_MIDDLEWARE", ()))
        stack.enter_context(patch.object(runner_module, "create_rule_set_preparation_agent", create))
        if mode == "no-submit":
            # A source-blocking claim is only honored when the pinned source really is inconsistent, so
            # the scripted block is made true: one chunk file stops matching its INDEX pin.
            real_materialize = runner_module.materialize_legal_source

            def tampered(bundle: dict[str, Any], root: Any) -> list[str]:
                paths = real_materialize(bundle, root)
                chunk = root / paths[1].lstrip("/")
                chunk.write_text(chunk.read_text(encoding="utf-8") + "\nTampered fixture content", encoding="utf-8")
                return paths

            stack.enter_context(patch.object(runner_module, "materialize_legal_source", tampered))
        result = run_rule_set_preparation(api, run_id, model=model)
    if mode != "no-submit":
        result["scriptedCalls"] = calls
        result["scriptedChildRejections"] = child_rejections
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
