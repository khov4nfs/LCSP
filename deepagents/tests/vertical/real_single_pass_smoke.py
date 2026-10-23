"""Bounded REAL-model smoke test of the single-pass independent review (LCSP-360).

usage: real_single_pass_smoke.py <out.json> [--only case,case,...]

One governed ``legal-semantic-auditor`` invocation per case, through the configured provider route, over small
in-memory source units (no API, no database). Positive controls must come back SUPPORTED with a signed, current
receipt; deliberately incorrect candidates must be rejected, with the expected gap code. A scripted model cannot prove
any of this, so the file refuses to run without a real provider route. Only LLM provider credentials from the
repository .env are loaded (same allow-list as live_preparation.py).
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import sys
import time
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from live_preparation import _load_llm_env  # noqa: E402 - credential allow-list shared with the live evaluation

TEXT = {
    "definition": "1. In this synthetic instrument, “record” means a stored notice and its receipt timestamp.",
    "retention": "1. An operator must retain each record for 7 days.",
    "exception": "1. The retention duty in Article 5 does not apply to a temporary test record.\nThis exception does not remove the in-person duty in Article 6.",
    "in_person": "1. The operator must appoint a person to attend the annual public information session in person.",
    "cease": "1. The operator shall cease processing personal data when consent is withdrawn.",
    "negated": "1. An operator is not required to retain a temporary test record.",
    "two_duties": "1. The operator must keep the notice text and must publish the retention period on its website.",
    "adopts": "1. The operator must retain each record for the period and in the manner required by Article 5.",
    "breach": "1. An operator that breaches Article 5 is liable to the fine set out in Article 12.",
}
NODE = {key: hashlib.sha256(key.encode()).hexdigest() for key in TEXT}


def build_source(frame_fields, canonical_support):
    nodes = {
        NODE[key]: {"nodeId": NODE[key], "parentNodeId": None, "structuralPath": f"/document/smoke/article/{key}/clause/1",
                    "nodeType": "CLAUSE", "content": text, "legalEffectStatus": "EFFECTIVE", "label": None, "title": None}
        for key, text in TEXT.items()
    }
    source = SimpleNamespace(nodes=nodes, graph={"materializationId": "e" * 64, "references": []})

    def reference(number, from_key, to_key, quote):
        content = TEXT[from_key]
        start = content.index(quote)
        return {"referenceId": f"ref-{number}", "fromNodeId": NODE[from_key], "toNodeId": NODE[to_key], "text": quote,
                "charStart": start, "charEnd": start + len(quote), "resolutionState": "RESOLVED", "candidateNodeIds": []}

    source.graph["references"] = [
        reference(1, "exception", "retention", "Article 5"),
        reference(2, "exception", "in_person", "Article 6"),
        reference(3, "adopts", "retention", "Article 5"),
        reference(4, "breach", "retention", "Article 5"),
    ]

    def claim(key, node_key, quote, claim_type, statement, authority, assessability, operative=None):
        start = TEXT[node_key].index(quote)
        support = canonical_support(source, [NODE[node_key]], [{"nodeId": NODE[node_key], "startOffset": start, "endOffset": start + len(quote)}])
        return {"claimId": f"claim-{key}", "sourceNodeIds": [NODE[node_key]], "claimType": claim_type, "statement": statement,
                "operative": operative, "sourceSupport": support, "semanticAuthority": authority, "assessability": assessability,
                "semanticFrame": {k: None for k in frame_fields}, "state": "RELEVANT"}

    return source, claim


def relation(number, kind, origin, target, reference=None):
    return {"relationId": f"rel-{number}", "kind": kind, "fromClaimId": f"claim-{origin}", "toClaimId": f"claim-{target}", "referenceId": reference}


def cases(source, claim):
    """Every case: unit key, owned claims, context claims, relations, expectation. Candidates are authored the way a careful Producer would."""
    duty = lambda actor, action: {"actor": actor, "modality": "DUTY", "action": action}  # noqa: E731
    d_ret = claim("ret", "retention", "An operator must retain each record for 7 days.", "DUTY", "An operator must retain each record for 7 days.", "LEGAL_NORMATIVE", "EXTERNAL_FULFILLMENT", duty("operator", "retain each record for 7 days"))
    d_person = claim("person", "in_person", "The operator must appoint a person to attend the annual public information session in person.", "DUTY",
                     "The operator must appoint a person to attend the annual public information session in person.", "LEGAL_NORMATIVE", "EXTERNAL_FULFILLMENT",
                     duty("operator", "appoint a person to attend the annual public information session in person"))
    d_def = claim("def", "definition", "“record” means a stored notice and its receipt timestamp.", "DEFINITION",
                  "In this synthetic instrument, “record” means a stored notice and its receipt timestamp.", "DEFINITION", "NON_ASSESSABLE")
    exc = claim("exc", "exception", "The retention duty in Article 5 does not apply to a temporary test record.", "EXCEPTION",
                "The retention duty in Article 5 does not apply to a temporary test record.", "LEGAL_NORMATIVE", "NON_ASSESSABLE")
    pres = claim("pres", "exception", "This exception does not remove the in-person duty in Article 6.", "CONTEXT",
                 "This exception does not remove the in-person duty in Article 6.", "LEGAL_NORMATIVE", "NON_ASSESSABLE")
    cease_text = "The operator shall cease processing personal data when consent is withdrawn."
    cease_action = "cease processing personal data when consent is withdrawn"
    ret_with_ref = lambda: deepcopy(d_ret)  # noqa: E731
    return [
        {"id": "definition-positive", "unit": "definition", "owned": [d_def], "context": [], "relations": [], "expect": "SUPPORTED",
         "what": "faithful DEFINITION claim over its source"},
        {"id": "exception-genuine-positive", "unit": "exception", "owned": [exc, pres], "context": [d_ret, d_person],
         "relations": [relation(1, "EXCEPTION_TO", "exc", "ret", "ref-1"), relation(2, "PRESERVES", "pres", "person", "ref-2")], "expect": "SUPPORTED",
         "what": "genuine exclusion (non-operative, LEGAL_NORMATIVE) with source-supported EXCEPTION_TO / PRESERVES targets"},
        {"id": "exception-labelled-as-duty", "unit": "exception", "owned": [
            claim("exc", "exception", "The retention duty in Article 5 does not apply to a temporary test record.", "DUTY",
                  "The retention duty in Article 5 does not apply to a temporary test record.", "LEGAL_NORMATIVE", "REPOSITORY_VERIFIABLE",
                  duty("operator", "exclude a temporary test record from the Article 5 retention duty")), pres], "context": [d_ret, d_person],
         "relations": [relation(1, "EXCEPTION_TO", "exc", "ret", "ref-1"), relation(2, "PRESERVES", "pres", "person", "ref-2")], "expect": "REJECTED", "codes": ["WRONG_MODALITY"],
         "what": "an exclusion presented as an affirmed operative DUTY"},
        {"id": "p0a-concealed-duty-labelled-exception", "unit": "in_person", "owned": [
            claim("person", "in_person", "The operator must appoint a person to attend the annual public information session in person.", "EXCEPTION",
                  "Exception: the operator must appoint a person to attend the annual public information session in person; this does not apply otherwise.",
                  "LEGAL_NORMATIVE", "NON_ASSESSABLE")], "context": [], "relations": [], "expect": "REJECTED", "codes": ["WRONG_MODALITY"],
         "what": "P0-A: a real duty concealed under an EXCEPTION label whose statement carries the old override keywords"},
        {"id": "p0a-cease-duty-faithful-positive", "unit": "cease", "owned": [
            claim("cease", "cease", cease_text, "DUTY", cease_text, "LEGAL_NORMATIVE", "EXTERNAL_FULFILLMENT", duty("operator", cease_action))],
         "context": [], "relations": [], "expect": "SUPPORTED", "what": "P0-A: affirmative duty containing the word 'cease', represented as a DUTY"},
        {"id": "p0a-cease-duty-labelled-exception", "unit": "cease", "owned": [
            claim("cease", "cease", cease_text, "EXCEPTION", "The operator shall cease processing personal data when consent is withdrawn (exception to continued processing).",
                  "LEGAL_NORMATIVE", "NON_ASSESSABLE")], "context": [], "relations": [], "expect": "REJECTED", "codes": ["WRONG_MODALITY"],
         "what": "P0-A: the same affirmative 'cease' duty relabelled EXCEPTION"},
        {"id": "negated-duty-positive", "unit": "negated", "owned": [
            claim("neg", "negated", "An operator is not required to retain a temporary test record.", "EXCEPTION",
                  "An operator is not required to retain a temporary test record.", "LEGAL_NORMATIVE", "NON_ASSESSABLE")],
         "context": [], "relations": [], "expect": "SUPPORTED", "what": "explicitly negated duty represented without an operative block"},
        {"id": "wrong-actor", "unit": "in_person", "owned": [
            claim("person", "in_person", "The operator must appoint a person to attend the annual public information session in person.", "DUTY",
                  "The organizer must appoint a person to attend the annual public information session in person.", "LEGAL_NORMATIVE", "EXTERNAL_FULFILLMENT",
                  duty("organizer", "appoint a person to attend the annual public information session in person"))],
         "context": [], "relations": [], "expect": "REJECTED", "codes": ["WRONG_ACTOR", "CONTRADICTED", "INSUFFICIENT_SUPPORT"], "what": "wrong addressee"},
        {"id": "unsupported-quantity", "unit": "retention", "owned": [
            claim("ret", "retention", "An operator must retain each record for 7 days.", "DUTY", "An operator must retain each record for 30 days.", "LEGAL_NORMATIVE",
                  "EXTERNAL_FULFILLMENT", duty("operator", "retain each record for 30 days"))],
         "context": [], "relations": [], "expect": "REJECTED", "codes": ["WRONG_ACTION", "CONTRADICTED", "INSUFFICIENT_SUPPORT"], "what": "statement contradicts its cited source"},
        {"id": "omission-empty-inventory", "unit": "in_person", "owned": [], "context": [], "relations": [], "expect": "REJECTED", "codes": ["MISSING_ASSERTION"],
         "what": "empty candidate inventory over a unit that states a duty"},
        {"id": "omission-partial-inventory", "unit": "two_duties", "owned": [
            claim("keep", "two_duties", "The operator must keep the notice text", "DUTY", "The operator must keep the notice text.", "LEGAL_NORMATIVE", "REPOSITORY_VERIFIABLE",
                  duty("operator", "keep the notice text"))], "context": [], "relations": [], "expect": "REJECTED", "codes": ["MISSING_ASSERTION"],
         "what": "one of two duties never represented"},
        {"id": "context-unit-text-not-an-omission", "unit": "exception", "owned": [exc, pres], "context": [], "relations": [], "expect": "SUPPORTED",
         "what": "referenced Article 5/6 text is context with no candidate claims; its duties are reviewed as their own units, not omissions of this one"},
        {"id": "relation-wrong-target", "unit": "exception", "owned": [exc, pres], "context": [d_ret, d_person],
         "relations": [relation(1, "EXCEPTION_TO", "exc", "person", "ref-2"), relation(2, "PRESERVES", "pres", "person", "ref-2")], "expect": "REJECTED", "codes": ["WRONG_RELATION", "INSUFFICIENT_SUPPORT"],
         "what": "EXCEPTION_TO aimed at the preserved in-person duty instead of the displaced retention duty"},
        {"id": "relation-wrong-direction", "unit": "exception", "owned": [exc, pres], "context": [d_ret, d_person],
         "relations": [relation(1, "EXCEPTION_TO", "ret", "exc", "ref-1"), relation(2, "PRESERVES", "pres", "person", "ref-2")], "expect": "REJECTED", "codes": ["WRONG_RELATION", "INSUFFICIENT_SUPPORT"],
         "what": "EXCEPTION_TO with its direction reversed"},
        {"id": "defined-by-positive", "unit": "retention", "owned": [ret_with_ref()], "context": [d_def], "relations": [relation(1, "DEFINED_BY", "ret", "def")], "expect": "SUPPORTED",
         "what": "cross-sentence definition of 'record' supplied by the definition claim"},
        {"id": "defined-by-wrong-dependency", "unit": "retention", "owned": [ret_with_ref()], "context": [d_person], "relations": [relation(1, "DEFINED_BY", "ret", "person")], "expect": "REJECTED",
         "codes": ["WRONG_RELATION", "INSUFFICIENT_SUPPORT"], "what": "DEFINED_BY aimed at a duty that defines nothing"},
        {"id": "incorporates-adopted-positive", "unit": "adopts", "owned": [
            claim("adopt", "adopts", "The operator must retain each record for the period and in the manner required by Article 5.", "DUTY",
                  "The operator must retain each record for the period and in the manner required by Article 5.", "LEGAL_NORMATIVE", "EXTERNAL_FULFILLMENT",
                  duty("operator", "retain each record for the period and in the manner required by Article 5"))], "context": [d_ret],
         "relations": [relation(1, "INCORPORATES", "adopt", "ret", "ref-3")], "expect": "SUPPORTED", "what": "INCORPORATES that adopts the target's retention action and period"},
        {"id": "incorporates-breach-reference-negative", "unit": "breach", "owned": [
            claim("fine", "breach", "An operator that breaches Article 5 is liable to the fine set out in Article 12.", "DUTY",
                  "An operator that breaches Article 5 is liable to the fine set out in Article 12.", "LEGAL_NORMATIVE", "EXTERNAL_FULFILLMENT",
                  duty("operator", "pay the fine set out in Article 12 when it breaches Article 5"))], "context": [d_ret],
         "relations": [relation(1, "INCORPORATES", "fine", "ret", "ref-4")], "expect": "REJECTED", "codes": ["WRONG_RELATION"],
         "what": "a breach reference triggering a different consequence labelled INCORPORATES"},
    ]


def main() -> int:
    out = Path(sys.argv[1])
    only = set(sys.argv[sys.argv.index("--only") + 1].split(",")) if "--only" in sys.argv else None
    _load_llm_env()
    os.environ.setdefault("LCSP_SEMANTIC_AUDIT_ATTESTATION_KEY", secrets.token_hex(32))

    from langchain_core.callbacks import BaseCallbackHandler
    from model_policy import resolve_agent_model, resolve_role
    import rule_set_preparation.semantic_audit as audit_module
    from rule_set_preparation.semantic_audit import (FRAME_FIELDS, ROLE, SemanticAuditor, attest_receipt, audit_input, canonical_support, receipt_current,
                                                     receipt_passed, verify_attestation)

    config = resolve_role(ROLE)
    model = resolve_agent_model(ROLE)
    if type(model).__name__.startswith("RuleSetPreparationScripted") or "Scripted" in type(model).__name__:
        raise SystemExit("a scripted model cannot establish real semantic accuracy")

    class Usage(BaseCallbackHandler):
        def __init__(self) -> None:
            self.reset()

        def reset(self) -> None:
            self.calls, self.input_tokens, self.output_tokens, self.models = 0, 0, 0, set()

        def on_llm_end(self, response, **kwargs) -> None:  # noqa: ANN001
            self.calls += 1
            for generations in response.generations:
                for generation in generations:
                    message = getattr(generation, "message", None)
                    usage = getattr(message, "usage_metadata", None) or {}
                    self.input_tokens += int(usage.get("input_tokens", 0))
                    self.output_tokens += int(usage.get("output_tokens", 0))
                    meta = getattr(message, "response_metadata", None) or {}
                    name = meta.get("model_name") or meta.get("model")
                    if name:
                        self.models.add(str(name))

    usage = Usage()
    model.callbacks = [usage]

    readings: list[dict] = []
    original_projection = audit_module.project_source_readings

    def spy(value, response):  # records what the independent reviewer read; the projection itself is untouched
        readings.extend(deepcopy(row["sourceReading"]) | {"id": row["id"]} for row in response.get("assertions", []))
        return original_projection(value, response)

    audit_module.project_source_readings = spy

    source, claim = build_source(FRAME_FIELDS, canonical_support)
    run_id = str(uuid4())
    results = []
    for case in cases(source, claim):
        if only and case["id"] not in only:
            continue
        owned = deepcopy(case["owned"])
        all_claims = {c["claimId"]: c for c in [*owned, *deepcopy(case["context"])]}
        graph = {"claims": list(all_claims.values()), "relations": deepcopy(case["relations"]),
                 "sourceAccounting": [{"sourceNodeId": NODE[case["unit"]], "claimIds": [c["claimId"] for c in owned]}]}
        usage.reset(); readings.clear()
        started = time.time()
        record = {"case": case["id"], "what": case["what"], "expect": case["expect"], "expectedCodes": case.get("codes", [])}
        try:
            value = audit_input(source, graph, NODE[case["unit"]], 1)
            auditor = SemanticAuditor(model=model, single_pass=True)
            receipt = auditor.audit(value)
            sealed = attest_receipt(receipt, run_id)
            codes = sorted({g["code"] for g in receipt["gaps"]} | {c for row in [*receipt["assertions"], *receipt["relations"]] for c in row["gapCodes"]})
            passed = receipt_passed(value, sealed)
            record |= {
                "verdict": receipt["verdict"], "gapCodes": codes, "gaps": [{"code": g["code"], "detail": g["detail"][:300]} for g in receipt["gaps"]],
                "assertionChecks": {r["id"]: {k: v for k, v in r["checks"].items() if v != "SUPPORTED"} for r in receipt["assertions"]},
                "independentReadings": deepcopy(readings), "receiptPassed": passed, "receiptCurrent": receipt_current(value, sealed),
                "attestationVerified": verify_attestation(sealed, run_id), "singlePassShape": receipt["sourceCatalog"] is None and receipt["relationAudits"] == [] and receipt["completenessAudit"] is None,
                "verifierOperationId": receipt["verifierOperationId"], "modelCalls": usage.calls, "inputTokens": usage.input_tokens, "outputTokens": usage.output_tokens,
                "responseModels": sorted(usage.models), "nativeSchemaRepairs": len(auditor.rejected_verdicts), "oneCall": usage.calls == 1, "seconds": round(time.time() - started, 1),
            }
            if case["expect"] == "SUPPORTED":
                ok = receipt["verdict"] == "SUPPORTED" and not receipt["gaps"] and passed
            else:
                ok = receipt["verdict"] != "SUPPORTED" and not passed and (not case.get("codes") or bool(set(case["codes"]) & set(codes)))
            record["result"] = "PASS" if ok and record["attestationVerified"] and record["receiptCurrent"] and record["singlePassShape"] and record["nativeSchemaRepairs"] <= 1 and usage.calls <= 2 else "FAIL"
        except Exception as error:  # noqa: BLE001 - a provider/contract error is evidence, never a pass
            record |= {"result": "ERROR", "error": f"{type(error).__name__}: {str(error)[:600]}", "modelCalls": usage.calls, "seconds": round(time.time() - started, 1)}
        results.append(record)
        print(f"{record['result']:5s} {record['case']:42s} verdict={record.get('verdict')} codes={record.get('gapCodes')} calls={record.get('modelCalls')} in={record.get('inputTokens')} out={record.get('outputTokens')}", flush=True)

    summary = {"generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "role": ROLE, "route": {"provider": config.provider, "model": config.model},
              "cases": len(results), "pass": sum(r["result"] == "PASS" for r in results), "fail": sum(r["result"] == "FAIL" for r in results), "error": sum(r["result"] == "ERROR" for r in results),
              "oneCallCases": sum(bool(r.get("oneCall")) for r in results), "totalModelCalls": sum(r.get("modelCalls", 0) for r in results), "totalInputTokens": sum(r.get("inputTokens", 0) for r in results),
              "totalOutputTokens": sum(r.get("outputTokens", 0) for r in results)}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"summary": summary, "results": results}, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(summary))
    return 0 if summary["fail"] == 0 and summary["error"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
