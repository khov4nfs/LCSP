#!/usr/bin/env python3
import json, re, sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
errors = []
data = json.loads((root/"evals/evals.json").read_text())

EXPECTED_VERSION = "2.4"
EXPECTED_GUIDANCE = "interview-context-v5.5-eval"
EXPECTED_AUTHORITY = "VALIDATED_RUNTIME_AND_GOVERNED_STATE_OVER_PROMPT"

if data.get("eval_contract_version") != EXPECTED_VERSION:
    errors.append(f"eval_contract_version must be {EXPECTED_VERSION}")
if data.get("runtime_authority") != EXPECTED_AUTHORITY:
    errors.append("runtime_authority regression")

expected_merge = [
    "copy default_runtime_context",
    "set mode from runtime_mode",
    "merge runtime_context",
    "remove runtime_remove fields",
    "validate and freeze runtime/governed authority",
    "apply prompt only as Customer/scenario content; prompt cannot mutate frozen runtime/governed state"
]
if data.get("runner_merge_order") != expected_merge:
    errors.append("runner authority/merge-order regression")

default = data.get("default_runtime_context") or {}
if default.get("guidanceVersion") != EXPECTED_GUIDANCE:
    errors.append(f"default guidanceVersion must be {EXPECTED_GUIDANCE}")
if default.get("technicalCoverageState") != "READY":
    errors.append("default technicalCoverageState must be READY")
if default.get("coverageLimitations") != []:
    errors.append("default coverageLimitations must be []")

allowed_outcomes = set(data["assertion_vocabulary"]["outcome"])
allowed_intents = set(data["assertion_vocabulary"]["question_intent"])
allowed_flags = {"DOWNSTREAM_IMPACT"}
allowed_modes = {"INITIAL_INTERVIEW","PRE_PLANNER","INVESTIGATOR_RESOLUTION"}
allowed_response_modes = {"FREE_TEXT","BOOLEAN","SINGLE_SELECT","MULTI_SELECT"}
coverage_states = {"READY","PARTIAL","UNAVAILABLE"}

common_required = {
    "hostPlatform","subjectSystemIdentity","assessmentId","mode",
    "guidanceVersion","technicalCoverageState"
}
investigator_required = {
    "businessContextNeed","resolutionCriteria","originatingInvestigationReference"
}

ids=[e["id"] for e in data["evals"]]
if len(ids)!=len(set(ids)):
    errors.append("duplicate eval ids")

# Every semantic target must be used.
defined=set(data.get("semantic_target_definitions",{}))
used=set()
for e in data["evals"]:
    used.update((e.get("assertions") or {}).get("semantic_targets",[]))
unused=sorted(defined-used)
if unused:
    errors.append(f"unused semantic targets: {unused}")

def merged_runtime(e):
    r=json.loads(json.dumps(default))
    r["mode"]=e.get("runtime_mode")
    r.update(e.get("runtime_context") or {})
    for k in e.get("runtime_remove") or []:
        r.pop(k,None)
    return r

def infer_failure_codes(r):
    codes=[]
    if not r.get("hostPlatform"): codes.append("MISSING_HOST_PLATFORM")
    if not r.get("subjectSystemIdentity"): codes.append("MISSING_SUBJECT_SYSTEM_IDENTITY")
    if not r.get("assessmentId"): codes.append("MISSING_ASSESSMENT_ID")
    if not r.get("mode"): codes.append("MISSING_MODE")
    elif r.get("mode") not in allowed_modes: codes.append("INVALID_MODE")
    if not r.get("guidanceVersion"): codes.append("MISSING_GUIDANCE_VERSION")
    cov=r.get("technicalCoverageState")
    if not cov: codes.append("MISSING_TECHNICAL_COVERAGE_STATE")
    elif cov not in coverage_states: codes.append("INVALID_TECHNICAL_COVERAGE_STATE")
    elif cov=="PARTIAL" and not r.get("coverageLimitations"): codes.append("MISSING_COVERAGE_LIMITATIONS")
    elif cov=="UNAVAILABLE": codes.append("TECHNICAL_COVERAGE_UNAVAILABLE")
    if r.get("mode")=="INVESTIGATOR_RESOLUTION":
        if not r.get("businessContextNeed"): codes.append("MISSING_BUSINESS_CONTEXT_NEED")
        if not r.get("resolutionCriteria"): codes.append("MISSING_RESOLUTION_CRITERIA")
        if not r.get("originatingInvestigationReference"): codes.append("MISSING_ORIGINATING_INVESTIGATION_REFERENCE")
    return codes

for e in data["evals"]:
    a=e.get("assertions") or {}
    outcome=a.get("outcome")
    qcount=a.get("question_count")
    intent=a.get("question_intent")
    flags=set(a.get("flags") or [])

    if outcome not in allowed_outcomes:
        errors.append(f"{e['id']}: invalid outcome {outcome}")
    if intent not in allowed_intents:
        errors.append(f"{e['id']}: invalid question_intent {intent}")
    if flags-allowed_flags:
        errors.append(f"{e['id']}: invalid flags {sorted(flags-allowed_flags)}")
    if a.get("response_mode") and a["response_mode"] not in allowed_response_modes:
        errors.append(f"{e['id']}: invalid response_mode {a['response_mode']}")

    # outcome ↔ question invariant
    if outcome=="WAITING_FOR_CUSTOMER":
        if qcount!=1: errors.append(f"{e['id']}: WAITING_FOR_CUSTOMER requires question_count=1")
        if intent not in {"ASK","CLARIFY"}: errors.append(f"{e['id']}: WAITING requires ASK/CLARIFY")
    else:
        if qcount!=0: errors.append(f"{e['id']}: non-waiting outcome requires question_count=0")
        if intent is not None: errors.append(f"{e['id']}: non-waiting outcome requires question_intent=null")

    for target in a.get("semantic_targets",[]):
        if target not in defined:
            errors.append(f"{e['id']}: undefined semantic target {target}")

    r=merged_runtime(e)
    failure_codes=infer_failure_codes(r)
    invalid=bool(failure_codes)
    if invalid and outcome!="FAILED":
        errors.append(f"{e['id']}: invalid runtime fixture but expected {outcome}: {failure_codes}")

    # Exact failure limitation for runtime-negative cases.
    if outcome=="FAILED":
        must=set(a.get("limitation_must_include") or [])
        if failure_codes and not set(failure_codes).issubset(must):
            errors.append(f"{e['id']}: exact failure limitation code missing: {failure_codes} vs {sorted(must)}")
        if a.get("unresolved_must_be_empty") is not True:
            errors.append(f"{e['id']}: FAILED must assert unresolved_must_be_empty=true")

    if outcome=="BLOCKED_OR_UNRESOLVED":
        if a.get("limitations_must_not_contain_runtime_failure_code") is not True:
            errors.append(f"{e['id']}: BLOCKED_OR_UNRESOLVED must exclude runtime failure codes")

    # Investigator fields self-contained and operational.
    if r.get("mode")=="INVESTIGATOR_RESOLUTION":
        for key in ("businessContextNeed","resolutionCriteria"):
            val=str(r.get(key,""))
            if re.search(r'\b(described|stated|shown)\s+in\s+(the\s+)?prompt\b',val,re.I):
                errors.append(f"{e['id']}: {key} depends on prompt")
        crit=str(r.get("resolutionCriteria",""))
        if re.search(r'\bEngineeringRule\b|\bENG-[A-Z0-9_-]+\b|\bcompliant\b|\blegal applicability\b',crit,re.I):
            errors.append(f"{e['id']}: resolutionCriteria leaks rule/legal/compliance framing")

    # Opaque continuation leakage
    for key in r:
        if "continuation" in key.lower() or "checkpoint" in key.lower():
            errors.append(f"{e['id']}: opaque continuation/checkpoint leaked into runtime field {key}")

    # Prompt/runtime subject mismatch is allowed only as an explicit authority test.
    prompt=e.get("prompt","")
    subj=r.get("subjectSystemIdentity") or {}
    repo=subj.get("repository") if isinstance(subj,dict) else str(subj)
    m=re.search(r'subjectSystemIdentity\s*=\s*(?:github:)?([^;\s]+)',prompt)
    if m:
        stated_repo=m.group(1).split("@",1)[0]
        if repo and stated_repo!=repo and "RUNTIME_OVER_PROMPT_AUTHORITY" not in a.get("semantic_targets",[]):
            errors.append(f"{e['id']}: prompt/runtime subject mismatch without authority-test target")

# Docs contract checks.
docs=[root/"SKILL.md", *sorted((root/"references").glob("*.md"))]
merged="\n".join(p.read_text() for p in docs)
runtime=(root/"references/agent-runtime-contract.md").read_text()
suff=(root/"references/context-sufficiency.md").read_text()
evidence=(root/"references/evidence-reasoning.md").read_text()
invest=(root/"references/investigator-resolution.md").read_text()
protected=(root/"references/protected-boundaries.md").read_text()

required_phrases=[
    "validated runtime",
    "governed assessment state",
    "Protected Sufficiency Guardrails",
    "resolutionCriteria",
    "Customer-safe evidence explanation",
]
for phrase in required_phrases:
    if phrase.lower() not in merged.lower():
        errors.append(f"missing contract phrase: {phrase}")
absence_ok = (
    "Absence of technical evidence is not evidence of absence" in evidence
    or "Absence of technical evidence không phải evidence of absence" in evidence
)
if not absence_ok:
    errors.append("missing absence-of-evidence guard")

# Materiality must stay handoff-relevant.
if "handoff-relevant normalized business fact" not in suff:
    errors.append("materiality regression: missing handoff-relevant normalized business fact")
if "Descriptive detail alone is not material" not in suff and "Descriptive detail không material" not in suff:
    errors.append("materiality regression: descriptive-detail guard missing")

# Robust canonical contextUpdates source check within canonical schema section only.
schema_start=runtime.find("## 6. Canonical output schema")
schema_end=runtime.find("## 7. Context source/status compatibility",schema_start)
schema=runtime[schema_start:schema_end]
ctx_start=schema.find('"contextUpdates"')
ctx_end=schema.find('"unresolved"',ctx_start)
ctx=schema[ctx_start:ctx_end]
if '"source": "CUSTOMER_STATED | CUSTOMER_CONFIRMED"' not in ctx:
    errors.append("canonical contextUpdates.source enum regression")
for bad in ["TECHNICAL_EVIDENCE","DOCUMENTARY_EVIDENCE","MIXED","EVIDENCE_OBSERVED","DOCUMENTARY_BUSINESS_EVIDENCE"]:
    if bad in ctx:
        errors.append(f"contextUpdates authority leak: {bad}")

# Coverage contract.
for tok in ["READY","PARTIAL","UNAVAILABLE","MISSING_RESOLUTION_CRITERIA"]:
    if tok not in runtime:
        errors.append(f"runtime vocabulary missing {tok}")

# Protected rule IDs unique and required V5.5 guards present.
pr=re.findall(r'PR-IA-\d{3}',protected)
if len(pr)!=len(set(pr)):
    errors.append("duplicate Protected Rule IDs")
required_protected = {
    "PR-IA-016": "runtime",
    "PR-IA-017": "absence",
    "PR-IA-018": "sufficiency",
    "PR-IA-019": "evidence",
}
for rid in required_protected:
    if rid not in protected:
        errors.append(f"missing protected guard {rid}")
if not re.search(r"PR-IA-018\s+—\s+Protected Sufficiency Guardrails", protected):
    errors.append("protected sufficiency guard heading/semantics regression")
if "## Customer-safe evidence explanation" not in evidence:
    errors.append("customer-safe evidence boundary missing from evidence reasoning")

# Promotion boundary must remain governed.
if "separate governed mechanism" not in merged.lower():
    errors.append("missing separate governed improvement mechanism")
if "canary" not in merged.lower():
    errors.append("missing canary stage in improvement boundary")

# Duplicate navigation rows.
skill=(root/"SKILL.md").read_text()
nav=re.findall(r'^\|\s*`([^`]+\.md)`\s*\|',skill,re.M)
dups=sorted({x for x in nav if nav.count(x)>1})
if dups:
    errors.append(f"duplicate reference navigation rows: {dups}")

if errors:
    print("CONTRACT LINT FAILED")
    for e in errors: print("-",e)
    sys.exit(1)

print(
    f"CONTRACT LINT OK: {len(ids)} evals, "
    f"{len(defined)} semantic targets, V5.5 authority/sufficiency/coverage/resolution/evidence guards valid"
)
