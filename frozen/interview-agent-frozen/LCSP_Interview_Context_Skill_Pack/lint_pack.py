#!/usr/bin/env python3
import json,re,sys
from pathlib import Path

base=Path(__file__).resolve().parent
errors=[]

def root(lang): return base/lang/"deepagents/skills/interview-context"
def load(lang): return json.loads((root(lang)/"evals/evals.json").read_text())

en,vi=load("en"),load("vi")
for key in ["eval_contract_version","runtime_authority","default_runtime_context","runner_merge_order"]:
    if en.get(key)!=vi.get(key):
        errors.append(f"{key} mismatch")

en_map={e["id"]:e for e in en["evals"]}
vi_map={e["id"]:e for e in vi["evals"]}
if set(en_map)!=set(vi_map):
    errors.append("eval id mismatch")
for eid in sorted(set(en_map)&set(vi_map)):
    for key in ["semantic_mode","runtime_mode","runtime_context","runtime_remove","assertions"]:
        if en_map[eid].get(key)!=vi_map[eid].get(key):
            errors.append(f"{eid}: deterministic bilingual mismatch: {key}")

if set(en.get("semantic_target_definitions",{}))!=set(vi.get("semantic_target_definitions",{})):
    errors.append("semantic target key mismatch")

# File parity
ef={str(p.relative_to(root("en"))) for p in root("en").rglob("*") if p.is_file()}
vf={str(p.relative_to(root("vi"))) for p in root("vi").rglob("*") if p.is_file()}
if ef!=vf:
    errors.append(f"file parity mismatch en-only={sorted(ef-vf)} vi-only={sorted(vf-ef)}")

# Rule ID parity
def ids(lang, fname, prefix):
    s=(root(lang)/"references"/fname).read_text()
    return re.findall(prefix+r'-\d{3}',s)
if ids("en","protected-boundaries.md","PR-IA")!=ids("vi","protected-boundaries.md","PR-IA"):
    errors.append("Protected Rule ID parity mismatch")
if ids("en","adaptive-rules.md","AR-IA")!=ids("vi","adaptive-rules.md","AR-IA"):
    errors.append("Adaptive Rule ID parity mismatch")

# Canonical vocabulary parity
tokens=[
    "INITIAL_INTERVIEW","PRE_PLANNER","INVESTIGATOR_RESOLUTION",
    "WAITING_FOR_CUSTOMER","CONTEXT_READY","CONTEXT_RESOLVED",
    "BLOCKED_OR_UNRESOLVED","FAILED","DOWNSTREAM_IMPACT",
    "TECHNICAL_EVIDENCE","DOCUMENTARY_EVIDENCE","CUSTOMER_STATED","CUSTOMER_CONFIRMED",
    "READY","PARTIAL","UNAVAILABLE","resolutionCriteria",
    "MISSING_RESOLUTION_CRITERIA","Protected Sufficiency Guardrails"
]
for tok in tokens:
    for lang in ("en","vi"):
        merged="\n".join(p.read_text() for p in [root(lang)/"SKILL.md",*sorted((root(lang)/"references").glob("*.md"))])
        if tok not in merged:
            errors.append(f"{lang}: vocabulary token missing {tok}")

# Navigation parity/duplicates.
def nav(lang):
    s=(root(lang)/"SKILL.md").read_text()
    rows=re.findall(r'^\|\s*`([^`]+\.md)`\s*\|',s,re.M)
    if len(rows)!=len(set(rows)):
        errors.append(f"{lang}: duplicate reference navigation")
    return set(rows)
if nav("en")!=nav("vi"):
    errors.append("reference navigation parity mismatch")

if errors:
    print("PACK LINT FAILED")
    for e in errors: print("-",e)
    sys.exit(1)

print(
    f"PACK LINT OK: {len(en_map)} bilingual evals, "
    f"{len(en.get('semantic_target_definitions',{}))} semantic targets, V5.5 deterministic/file/vocabulary parity"
)
