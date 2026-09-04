#!/usr/bin/env python3
import json, shutil, subprocess, sys, tempfile
from pathlib import Path

src=Path(__file__).resolve().parents[1]
lint_rel=Path("evals/lint_contract.py")

def mutate_and_expect_fail(name, mutator):
    with tempfile.TemporaryDirectory() as td:
        dst=Path(td)/"skill"
        shutil.copytree(src,dst)
        mutator(dst)
        p=subprocess.run([sys.executable,"-S",str(dst/lint_rel)],capture_output=True,text=True)
        if p.returncode==0:
            print(f"MUTATION SURVIVED: {name}")
            return False
        return True

def load(dst):
    p=dst/"evals/evals.json"
    return p,json.loads(p.read_text())

mutations=[]

def m_runner(dst):
    p,d=load(dst); d["runtime_authority"]="PROMPT_OVER_RUNTIME"; p.write_text(json.dumps(d,indent=2))
mutations.append(("runner authority",m_runner))

def m_guidance(dst):
    p,d=load(dst); d["default_runtime_context"]["guidanceVersion"]="wrong"; p.write_text(json.dumps(d,indent=2))
mutations.append(("guidance pin",m_guidance))

def m_unused_target(dst):
    p,d=load(dst); d["semantic_target_definitions"]["UNUSED_MUTATION"]="unused"; p.write_text(json.dumps(d,indent=2))
mutations.append(("unused semantic target",m_unused_target))

def m_question(dst):
    p,d=load(dst)
    for e in d["evals"]:
        if e["assertions"].get("outcome")=="WAITING_FOR_CUSTOMER":
            e["assertions"]["question_count"]=0; break
    p.write_text(json.dumps(d,indent=2))
mutations.append(("question/outcome invariant",m_question))

def m_response(dst):
    p,d=load(dst)
    for e in d["evals"]:
        e["assertions"]["response_mode"]="RADIO_MAGIC"; break
    p.write_text(json.dumps(d,indent=2))
mutations.append(("response-mode vocabulary",m_response))

def m_material(dst):
    p=dst/"references/context-sufficiency.md"
    s=p.read_text()
    if "handoff-relevant normalized business fact" in s:
        s=s.replace("handoff-relevant normalized business fact","stored business meaning")
    else:
        s=s.replace("handoff-relevant normalized business fact","stored business meaning")
    p.write_text(s)
mutations.append(("materiality",m_material))

def m_ctx_source(dst):
    p=dst/"references/agent-runtime-contract.md"
    s=p.read_text().replace(
        '"source": "CUSTOMER_STATED | CUSTOMER_CONFIRMED"',
        '"source": "CUSTOMER_STATED | CUSTOMER_CONFIRMED | TECHNICAL_EVIDENCE"'
    )
    p.write_text(s)
mutations.append(("contextUpdates source authority",m_ctx_source))

def m_resolution(dst):
    p,d=load(dst)
    for e in d["evals"]:
        if e.get("runtime_mode")=="INVESTIGATOR_RESOLUTION" and "resolutionCriteria" in e.get("runtime_context",{}):
            del e["runtime_context"]["resolutionCriteria"]; break
    p.write_text(json.dumps(d,indent=2))
mutations.append(("resolutionCriteria required",m_resolution))

def m_guard(dst):
    p=dst/"references/protected-boundaries.md"
    s=p.read_text().replace("PR-IA-018 — Protected Sufficiency Guardrails","PR-IA-018 — Removed Guard")
    p.write_text(s)
mutations.append(("protected sufficiency guard",m_guard))

def m_safe(dst):
    p=dst/"references/evidence-reasoning.md"
    s=p.read_text().replace("## Customer-safe evidence explanation","## Evidence explanation")
    p.write_text(s)
mutations.append(("customer-safe evidence boundary",m_safe))

ok=0
for name,fn in mutations:
    if mutate_and_expect_fail(name,fn):
        ok+=1

if ok!=len(mutations):
    print(f"LINT GUARD MUTATION TESTS FAILED: {ok}/{len(mutations)} rejected")
    sys.exit(1)

print(f"LINT GUARD MUTATION TESTS OK: {ok} regressions rejected")
