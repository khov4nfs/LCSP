"""Generate AUTHORING_TOOL_CONTRACT.{json,md} from the live tool definitions plus hand-annotated semantics.

The machine part (names, argument schemas, required fields) is read from the real tools, so it cannot drift; a test regenerates it and
compares. The semantic part (constraints, rejection codes, idempotency, persistence) is annotated here and checked by the matrix tests.
Run from deepagents/:  PYTHONPATH=.:tests .venv/bin/python ../reports/lcsp360-source-semantic-fidelity-20261018/build-tool-contract.py
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "deepagents/tests"))
import retained_rule_authoring_harness as H  # noqa: E402
from authoring_memory_harness import FIXTURE48  # noqa: E402

AUTHORING_TOOLS = ["start_rule_authoring", "get_claim_inventory", "get_rule_authoring_context", "get_semantic_closure", "get_source_support", "get_rule_authoring_status", "author_legal_requirement",
                   "author_assessment_rule", "remove_rule_candidate", "reopen_semantic_claim_inventory", "validate_compliance_rule_set", "submit_compliance_rule_set"]

LAYERS = {
    "A": {"name": "TOOL_SCHEMA", "meaning": "The tool-argument contract refused the call; the mutation body never ran.",
          "sources": {"TOOL_PREFLIGHT": "the tool wrapper's JSON-schema check (missing/mistyped/unknown/duplicate/out-of-enum arguments)",
                      "FRAMEWORK_UNKNOWN_TOOL": "the model named a tool that does not exist; ToolNode answers, no LCSP code ran before this change",
                      "FRAMEWORK_UNPARSEABLE_ARGUMENTS": "the model's tool-call arguments were not valid JSON; the call never executes and the model receives no tool answer",
                      "FRAMEWORK_TOOL_ERROR": "any other ToolNode error message (status=error) not produced by the tool itself"}},
    "B": {"name": "AUTHORING_PRECONDITION", "meaning": "The body ran and refused a semantic precondition before touching the draft."},
    "C": {"name": "REAL_RULE_VALIDATION", "meaning": "The authored draft exists and the Compliance Rule Set validator executes. A different event family (RULE_VALIDATION_STARTED/PASSED/FAILED); never an authoring rejection."},
}

SEMANTICS = {
    "get_semantic_closure": {"kind": "READ", "constraints": ["typed projection around compatible verified normative operative anchors; exact authoringArguments retain every reachable modifier and context"], "idempotencyKey": "frozen inventory plus anchor IDs", "mutation": "none", "rejections": {}},
    "get_source_support": {"kind": "READ", "constraints": ["exact unique quotation resolves against pinned AST UTF-16 coordinates and content hash; no law interpretation"], "idempotencyKey": "pinned node plus exact quotation", "mutation": "none", "rejections": {}},
    "author_legal_requirement": {
        "kind": "MUTATION",
        "constraints": [
            "every claim ID must exist in the frozen V3 inventory and be RELEVANT (INTENTIONALLY_NON_OPERATIVE claims cannot be bound)",
            "begin with compatible LEGAL_NORMATIVE operative anchors; every binding must belong to their verified typed semantic closures; guidance is never an operative anchor",
            "a claim's accounting role is projected from its verified semantic closure and must match the argument it is supplied in: operative_claim_ids=DUTY|PROHIBITION|PERMISSION; "
            "applicability_claim_ids=SCOPE|CONDITION only; qualifier_claim_ids=QUALIFIER|TEMPORAL_RULE|TRANSITION_RULE; exception_claim_ids=EXCEPTION; "
            "context_claim_ids=CONTEXT|CROSS_REFERENCE|DEFINITION",
            "operative_claim_ids must be non-empty (declared minItems 1; the body returns the richer OPERATIVE_PROPOSITION_REQUIRED with candidates)",
            "an assessable Requirement needs at least one applicability claim unless non_assessable_reason is given",
            "the assembled Requirement row must satisfy the packet schema",
        ],
        "idempotencyKey": "requirement_key; an identical resend leaves the draft fingerprint and revision unchanged, different content under the same key replaces the row (+1 draft revision)",
        "mutation": "adds or replaces context.draft.legalRequirements[requirement_key]; re-derives contextRelations; invalidates any cached validation",
        "rejections": {
            "TOOL_SCHEMA": {"CLAIM_SCHEMA_INVALID": ["MISSING_ARGUMENT", "WRONG_TYPE", "UNKNOWN_ARGUMENT", "INVALID_ENUM", "DUPLICATE_ITEMS", "INVALID_VALUE"]},
            "AUTHORING_PRECONDITION": {"CLAIM_REQUIREMENT_MISMATCH": ["UNKNOWN_CLAIM", "ROLE_MISMATCH", "NON_RELEVANT_CLAIM"], "OPERATIVE_PROPOSITION_REQUIRED": ["OPERATIVE_REQUIRED"],
                                       "SEMANTIC_CLOSURE_INVALID": ["BINDING_OUTSIDE_SEMANTIC_CLOSURE", "INCOMPATIBLE_OPERATIVE_AGGREGATION"], "APPLICABILITY_SCOPE_MISSING": ["APPLICABILITY_REQUIRED"], "CLAIM_SCHEMA_INVALID": ["ROW_INVALID"]},
        },
    },
    "author_assessment_rule": {
        "kind": "MUTATION",
        "constraints": ["legal_requirement_ids must name existing ASSESSABLE Requirements (COVERED_BY_ASSESSMENT_RULES); a non-assessable or unknown parent is ORPHAN_ASSESSMENT_RULE",
                        "criteria, applicability and evidence are derived by the API from the parents; investigation_focus is a non-normative suggestion"],
        "idempotencyKey": "assessment_rule_id", "mutation": "adds or replaces context.draft.assessmentRules[assessment_rule_id]",
        "rejections": {"TOOL_SCHEMA": {"CLAIM_SCHEMA_INVALID": ["MISSING_ARGUMENT", "WRONG_TYPE", "EMPTY_REQUIRED_LIST", "UNKNOWN_ARGUMENT", "DUPLICATE_ITEMS", "INVALID_VALUE"]},
                       "AUTHORING_PRECONDITION": {"ORPHAN_ASSESSMENT_RULE": ["UNKNOWN_REQUIREMENT"], "CLAIM_SCHEMA_INVALID": ["ROW_INVALID"]}},
    },
    "remove_rule_candidate": {
        "kind": "MUTATION",
        "constraints": ["candidate_id must exist in the draft section selected by kind; removing a Requirement also removes AssessmentRules that cite it"],
        "idempotencyKey": "candidate_id (a second removal of the same id is rejected: UNKNOWN_CANDIDATE)", "mutation": "the only operation that can lower the Requirement count",
        "rejections": {"TOOL_SCHEMA": {"CLAIM_SCHEMA_INVALID": ["MISSING_ARGUMENT", "INVALID_ENUM", "WRONG_TYPE"]}, "AUTHORING_PRECONDITION": {"CLAIM_SCHEMA_INVALID": ["UNKNOWN_CANDIDATE"]}},
    },
    "reopen_semantic_claim_inventory": {"kind": "MUTATION", "constraints": ["requires a frozen inventory and a reason; increments the inventory revision and clears the whole draft"], "idempotencyKey": "none",
                                        "mutation": "resets context.draft and every unresolved authoring rejection (phase change)", "rejections": {}},
    "start_rule_authoring": {"kind": "PHASE_TRANSITION", "constraints": ["READY -> RULE_AUTHORING via the API AUTHOR_RULES operation; idempotent afterwards"], "idempotencyKey": "inventory revision", "mutation": "phase only", "rejections": {}},
    "get_claim_inventory": {"kind": "READ", "constraints": ["limit<1 or missing -> 20, >20 capped to 20, negative offset -> 0; reported as requestedLimit/appliedLimit; never rejected for size"], "idempotencyKey": "n/a", "mutation": "none", "rejections": {"TOOL_SCHEMA": {"CLAIM_SCHEMA_INVALID": ["INVALID_ENUM", "WRONG_TYPE", "UNKNOWN_ARGUMENT"]}}},
    "get_rule_authoring_context": {"kind": "READ", "constraints": ["normal path exposes only verified operative anchors; retrieve their closure before authoring; pages of at most 40"], "idempotencyKey": "n/a", "mutation": "none", "rejections": {}},
    "get_rule_authoring_status": {"kind": "READ", "constraints": ["projection of Requirements, AssessmentRules, unbound claims, unresolved rejections and next valid actions; not a second authority"], "idempotencyKey": "n/a", "mutation": "none", "rejections": {}},
    "validate_compliance_rule_set": {"kind": "REAL_VALIDATION", "constraints": ["runs the real Rule validator on the exact draft; the ONLY operation that increments rule_validation_attempt"], "idempotencyKey": "draft fingerprint", "mutation": "last_validation; phase SUBMISSION_READY on PASS else RULE_AUTHORING", "rejections": {}},
    "submit_compliance_rule_set": {"kind": "SUBMISSION", "constraints": ["only after validation PASSED for the exact draft; idempotent per run"], "idempotencyKey": "run id", "mutation": "persists the Rule Set through the API", "rejections": {}},
}

PERSISTENCE = {
    "draft": "in-process run context (context.draft); not persisted API-side before submission",
    "frozenInventory": "persisted API-side per revision (RuleSetPreparationClaimInventory); immutable",
    "rejections": "published as durable stream events (RULE_AUTHORING_TOOL_REJECTED with a sanitized envelope; RULE_AUTHORING_REJECTION_RESOLVED when it ends) and kept in context.rejection_log (last 200)",
    "checkpointing": "the Preparation graph is built with checkpointer=False and is claim-once: nothing resumes an in-flight run after a process restart. 'Restart' in tests means a rebuilt graph over live run state.",
}


def build() -> dict:
    from semantic_pipeline_harness import authoring_fixture
    fx = authoring_fixture()
    _, ctx, tools, _ = H.restore(fx)
    by_name = tools if isinstance(tools, dict) else {tool.name: tool for tool in tools}
    entries = []
    for name in AUTHORING_TOOLS:
        tool = by_name[name]
        schema = tool.args_schema if isinstance(tool.args_schema, dict) else tool.args_schema.model_json_schema()
        entries.append({"name": name, "description": " ".join(tool.description.split())[:400], "arguments": schema.get("properties", {}), "required": schema.get("required", []),
                        "additionalProperties": schema.get("additionalProperties"), **SEMANTICS.get(name, {})})
    return {"layers": LAYERS, "tools": entries, "persistence": PERSISTENCE}


if __name__ == "__main__":
    contract = build()
    (HERE / "AUTHORING_TOOL_CONTRACT.json").write_text(json.dumps(contract, indent=1, ensure_ascii=False, sort_keys=True) + "\n")
    lines = ["# Rule Authoring tool contract", "", "Generated by `build-tool-contract.py` from the live tool definitions; `test_authoring_tool_contract_document_matches_runtime` fails on drift.", "",
             "## Rejection layers", ""]
    for key, layer in LAYERS.items():
        lines.append(f"- **Layer {key} - {layer['name']}**: {layer['meaning']}")
        for source, text in layer.get("sources", {}).items():
            lines.append(f"  - `{source}`: {text}")
    lines += ["", "## Persistence and restart", ""] + [f"- **{k}**: {v}" for k, v in PERSISTENCE.items()] + ["", "## Tools", ""]
    for tool in contract["tools"]:
        lines += [f"### `{tool['name']}` ({tool.get('kind', '')})", "", tool["description"], "",
                  "| argument | schema | required |", "|---|---|---|"]
        for arg, schema in tool["arguments"].items():
            shown = {k: v for k, v in schema.items() if k in ("type", "enum", "minItems", "maxItems", "uniqueItems", "minLength", "maxLength", "items")}
            lines.append(f"| `{arg}` | `{json.dumps(shown, ensure_ascii=False)}` | {'yes' if arg in tool['required'] else 'no'} |")
        lines += ["", f"- unknown arguments rejected: {tool['additionalProperties'] is False}", f"- idempotency: {tool.get('idempotencyKey', 'n/a')}", f"- mutation: {tool.get('mutation', 'n/a')}"]
        lines += [f"- constraint: {c}" for c in tool.get("constraints", [])]
        for layer, codes in tool.get("rejections", {}).items():
            lines += [f"- rejection {layer}: " + "; ".join(f"`{code}` ({', '.join(keys)})" for code, keys in codes.items())]
        lines.append("")
    (HERE / "AUTHORING_TOOL_CONTRACT.md").write_text("\n".join(lines).rstrip() + "\n")
    print(f"{len(contract['tools'])} tools documented")
