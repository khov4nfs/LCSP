"""Explicit migration ledger generation; review its diff before committing.

This is not a CI autofix. CI validates the committed ledger without refreshing
it. Source candidates remain drafts and no runtime or approval is generated.
"""
from collections import Counter
import ast
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from instruction_source_inventory import ROOT, INVENTORY, discover, source_digest


def classify(site):
    """Business purpose: Describe the authority and migration role of a discovered construction site.

    Business rules:
    - Classification records evidence and must not grant runtime or legal authority.
    Execution flow:
    1. Inspect source location and expression patterns, then return the ledger classification.
    Failure cases:
    - Unmapped maintained instructions remain visible for reconciliation.
    Side effects:
    - None: creates a migration site record.
    """
    path, symbol, text = site["filePath"], site["symbolName"], site["evidence"]
    role = "assessment-root" if path.startswith("assessment_root/") else "rule-set-preparation" if path.startswith("rule_set_preparation/") else "shared-runtime"
    category = "DUPLICATE_REFERENCE"
    authority = "LCSP_MAINTAINED"
    if "argparse.ArgumentParser" in text or path.endswith(("tracing.py", "repository_scanner.py")) or symbol == "_prompt_overhead_tokens" or "MANIFEST_MISSING" in text:
        category, authority = "NON_MODEL_FACING", "IMPLEMENTATION"
    elif "HumanMessage(content=text)" in text or "HumanMessage(content=json_payload)" in text or "description=t.get" in text:
        category, authority = "RUNTIME_DATA", "RUNTIME_DATA"
    elif "Field(" in text or "description=" in text and path.endswith(("tools.py", "code.py", "source_graph.py", "claim_tools.py")):
        category = "MAINTAINED_TOOL_DESCRIPTION"
    elif "SKILL" in text:
        category = "MAINTAINED_SKILL" if "filename =" in text else "DUPLICATE_REFERENCE"
    elif "after_model" == symbol:
        category = "MAINTAINED_CONTINUATION"
    elif "HumanMessage(content=" in text and ("draft_history" in path or "authoring_recorder" in path):
        category = "MAINTAINED_COMPACTION"
    elif "HumanMessage(content=self._finalize_instruction" in text:
        category = "MAINTAINED_CONTINUATION"
    elif path.endswith("model_governance.py"):
        category = "DUPLICATE_REFERENCE"
    elif path.endswith("localization.py"):
        category = "MAINTAINED_SYSTEM_INSTRUCTION" if "TEMPLATE =" in text or "def get_language_prompt" in text else "DUPLICATE_REFERENCE"
    elif "read_text" in text or "system_prompt=" in text:
        category = "DUPLICATE_REFERENCE"
    site.update(constructionType=category, modelFacingConsumer=f"{path}::{symbol}", runtimeRole=role,
                runtimePhase="SHARED" if role == "shared-runtime" else "ASSESSMENT" if role == "assessment-root" else "PREPARATION",
                contentAuthority=authority, migrationDecision="RETAIN_RUNTIME_DATA" if category == "RUNTIME_DATA" else "EXCLUDE_IMPLEMENTATION" if category == "NON_MODEL_FACING" else "MIGRATE_OR_BIND_VI_SOURCE",
                viSourceId=None, existingSourcePath=path, placeholderSchema={},
                migrationStatus="NOT_APPLICABLE" if category in {"RUNTIME_DATA", "NON_MODEL_FACING"} else "PENDING_SOURCE_MAPPING")
    return site


def vietnamese_tool_maps():
    """Business purpose: Read existing Vietnamese tool guidance for source migration.

    Business rules:
    - Only literal maintained mappings are accepted; no model translation is performed.
    Execution flow:
    1. Parse canonical guidance dictionaries and collect Vietnamese entries.
    Failure cases:
    - Unreadable source or unsupported literals fail migration preparation.
    Side effects:
    - Read maintained source code only.
    """
    tree = ast.parse((ROOT / "assessment_root/tool_contracts.py").read_text(encoding="utf-8"))
    maps = {key: {} for key in ("CONTRACTS_VI", "GRAPH_CONTRACTS_VI", "TOOL_PLAYBOOKS_VI")}
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in maps:
                    maps[target.id].update(ast.literal_eval(node.value))
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            call = node.value
            if isinstance(call.func, ast.Attribute) and isinstance(call.func.value, ast.Name) and call.func.value.id in maps and call.func.attr == "update":
                maps[call.func.value.id].update(ast.literal_eval(call.args[0]))
    return maps


def main():
    """Business purpose: Refresh the explicit migration ledger after intentional source changes.

    Business rules:
    - Writing requires an explicit operator flag; source drafts and pending framework adapters do not become approvals.
    Execution flow:
    1. Discover construction sites, bind maintained entries, hash bytes and snapshot installed framework surfaces.
    Failure cases:
    - Invalid source files or unsupported dependency surfaces stop the snapshot.
    Side effects:
    - Write the source inventory and missing Vietnamese migration drafts; preserve approval status.
    """
    if sys.argv[1:] != ["--write"]:
        raise SystemExit("Explicit --write is required; inspect the resulting migration diff.")
    payload = json.loads(INVENTORY.read_text(encoding="utf-8")) if INVENTORY.exists() else {
        "schemaVersion": "LCSP_EN_RUNTIME_BUNDLE_V1", "bundleId": "lcsp-347-vi-draft-r1", "entries": []}
    core = [
        ("preparation.materialized-source-guidance", "rule-set-preparation", "SOURCE_WRAPPER", "instructions/vi/materialized-source-guidance.md", "rule_set_preparation/legal_source_files.py", "materialize_legal_source", "rule_set_preparation/legal_source_files.py"),
        ("preparation.presentation", "rule-set-preparation", "PRESENTATION", "instructions/vi/preparation-presentation.md", "rule_set_preparation/preparation_skills.py", "preparation_locale_overlay", "rule_set_preparation/instructions-localization.vi.md"),
        ("runtime.context-identifiers", "shared-runtime", "SYSTEM", "instructions/vi/runtime-context.md", "middleware/runtime_context.py", "_project_lcsp_runtime_context", "middleware/runtime_context.py"),
        ("preparation.authoring-state", "rule-set-preparation", "COMPACTION", "instructions/vi/authoring-state-guidance.md", "rule_set_preparation/authoring_state.py", "digest", "rule_set_preparation/authoring_state.py"),
        ("runtime.skill-catalogs", "shared-runtime", "SKILL_CATALOG", "instructions/vi/skill-catalogs.json", "assessment_root/skills.py", "list_skills", "rule_set_preparation/preparation_skills.py"),
        ("runtime.budget-finalization", "shared-runtime", "CONTINUATION", "instructions/vi/budget-finalization.json", "middleware/agent_run_budget.py", "_finalize_instruction", "middleware/agent_run_budget.py"),
        ("runtime.response-transform", "response-transform", "SYSTEM_TEMPLATE", "instructions/vi/response-transform.md", "orchestration/localization.py", "TRANSFORM_SYSTEM_PROMPT_TEMPLATE", "orchestration/localization.py"),
        ("runtime.structured-transform", "response-transform", "SYSTEM_TEMPLATE", "instructions/vi/structured-transform.md", "orchestration/localization.py", "STRUCTURED_SYSTEM_PROMPT_TEMPLATE", "orchestration/localization.py"),
        ("runtime.response-language", "shared-runtime", "SYSTEM", "instructions/vi/response-language.md", "orchestration/localization.py", "get_language_prompt_instruction", "orchestration/localization.py"),
        ("framework.injected-policy", "shared-runtime", "FRAMEWORK_OVERRIDE", "instructions/vi/framework-guidance.md", "middleware/model_governance.py", "governed_summarization_middleware", "deepagents 0.7.17 / langchain 1.4.2"),
        ("tools.schema-guidance", "shared-runtime", "TOOL_SCHEMA", "instructions/vi/tool-schema-guidance.json", "assessment_root/tools.py", "CiteRepositorySourceArgs", "assessment_root/tools.py"),
        ("assessment-tools.descriptions", "assessment-root", "TOOL_DESCRIPTION", "instructions/vi/root-tool-descriptions.json", "assessment_root/tools.py", "build_root_tools", "assessment_root/tools.py"),
        ("preparation-tools.descriptions", "rule-set-preparation", "TOOL_DESCRIPTION", "instructions/vi/preparation-tool-guidance.json", "rule_set_preparation/claim_tools.py", "build_claim_tools", "rule_set_preparation/claim_tools.py"),
        ("preparation.observation-errors", "rule-set-preparation", "ERROR_GUIDANCE", "instructions/vi/observation-error-guidance.md", "rule_set_preparation/agent.py", "PreparationObservationMiddleware", "rule_set_preparation/preparation_skills.py"),
        ("assessment-root.system", "assessment-root", "SYSTEM", "assessment_root/instructions.vi.md", "assessment_root/agent.py", "create_assessment_root_agent", "assessment_root/instructions.md"),
        ("repository-researcher.system", "repository-researcher", "SYSTEM", "assessment_root/researcher.vi.md", "assessment_root/researcher.py", "researcher_prompt_for_locale", "assessment_root/researcher.en.md"),
        *[(f"preparation.{phase}", "rule-set-preparation", "PHASE", f"instructions/vi/preparation-{phase}.md", "rule_set_preparation/agent.py", "phase_instructions", f"rule_set_preparation/instructions-{phase}.md") for phase in ("common", "discovery", "authoring", "direct")],
        ("preparation.development-overlay", "rule-set-preparation", "SCOPE", "instructions/vi/preparation-development.md", "rule_set_preparation/preparation_skills.py", "development_scope_overlay", "rule_set_preparation/instructions-development.md"),
        ("claim-author.system", "claim-author", "DELEGATION", "instructions/vi/claim-author.md", "rule_set_preparation/agent.py", "claim_author_subagent", "rule_set_preparation/agent.py"),
        ("assessment-root.continuation", "assessment-root", "CONTINUATION", "instructions/vi/assessment-continuation.md", "assessment_root/agent.py", "after_model", "assessment_root/agent.py"),
        ("assessment-root.resume", "assessment-root", "RESUME", "instructions/vi/assessment-resume.md", "assessment_root/runner.py", "_START_MESSAGE", "assessment_root/runner.py"),
        ("preparation.continuation", "rule-set-preparation", "CONTINUATION", "instructions/vi/preparation-continuation.md", "rule_set_preparation/agent.py", "PreparationCompletionMiddleware", "rule_set_preparation/agent.py"),
        ("preparation.history", "rule-set-preparation", "COMPACTION", "instructions/vi/preparation-history.md", "rule_set_preparation/draft_history.py", "compact_draft_history", "rule_set_preparation/draft_history.py"),
        ("preparation.history-counts", "rule-set-preparation", "TASK_TEMPLATE", "instructions/vi/preparation-history-counts.md", "rule_set_preparation/draft_history.py", "_view", "rule_set_preparation/draft_history.py"),
    ]
    for skill in sorted((ROOT / "skills").glob("*/SKILL.vi.md")):
        assessment = skill.parent.name.startswith("assessment-")
        core.append((f"skill.{skill.parent.name}", "assessment-root" if assessment else "rule-set-preparation", "SKILL", skill.relative_to(ROOT).as_posix(), "assessment_root/skills.py" if assessment else "rule_set_preparation/preparation_skills.py", "load_skill" if assessment else "read_preparation_skill", (skill.parent / "SKILL.md").relative_to(ROOT).as_posix()))
    maps = vietnamese_tool_maps()
    names = sorted(set().union(*(set(values) for values in maps.values())))
    for name in names:
        source = ROOT / f"instructions/vi/assessment-tools/{name}.md"
        if not source.exists():
            source.parent.mkdir(parents=True, exist_ok=True)
            paragraphs = [values[name] for values in maps.values() if name in values]
            source.write_text("\n\n".join(paragraphs) + "\n", encoding="utf-8")
        core.append((f"assessment-tool.{name}.guidance", "assessment-root", "TOOL_PLAYBOOK", source.relative_to(ROOT).as_posix(), "assessment_root/tool_contracts.py", "describe_tool", "assessment_root/tool_contracts.py"))
    existing = {row["sourceId"]: row for row in payload["entries"]}
    for identity, role, kind, path, consumer, symbol, legacy in core:
        if identity not in existing:
            existing[identity] = {"sourceId": identity, "runtimeRole": role, "instructionKind": kind,
                "vietnameseSourcePath": path, "vietnameseSourceRevision": "lcsp-347-draft-r1", "runtimeEntryId": identity,
                "required": True, "reviewStatus": "PENDING_INDEPENDENT_REVIEW", "englishCandidatePath": None,
                "migrationReferences": [legacy], "placeholderSchema": {},
                "consumers": [{"filePath": consumer, "symbolName": symbol, "integrationStatus": "PENDING_RUNTIME_CUTOVER"}]}
    payload["entries"] = sorted(existing.values(), key=lambda row: row["sourceId"])
    payload["requiredSourceIds"] = sorted(existing)
    existing["preparation.history-counts"]["placeholderSchema"] = {key: "NONNEGATIVE_INTEGER" for key in ("draft_version", "requirement_count", "rule_count")}
    existing["preparation.history-counts"]["runtimeInputAuthority"] = "PERSISTED_DRAFT_METADATA"
    existing["preparation.history-counts"]["templateSyntax"] = "FORMAT"
    existing["preparation.history-counts"]["renderingPolicy"] = "NUMERIC_PARAMETERS_ONLY"
    for identity in ("runtime.response-transform", "runtime.structured-transform"):
        existing[identity]["templateSyntax"] = "FORMAT"
        existing[identity]["placeholderSchema"] = {
            "target_language": {"type": "ENUM", "values": ["English", "Vietnamese", "Tiếng Việt"]},
            "target_locale": {"type": "ENUM", "values": ["en", "vi"]}}
        from string import Formatter
        fields = {field for _, field, _, _ in Formatter().parse((ROOT / existing[identity]["vietnameseSourcePath"]).read_text(encoding="utf-8")) if field is not None}
        existing[identity]["placeholderSchema"] = {key: value for key, value in existing[identity]["placeholderSchema"].items() if key in fields}
        existing[identity]["runtimeInputAuthority"] = "SERVER_RESPONSE_LANGUAGE_POLICY"
    for row in payload["entries"]:
        path = ROOT / row["vietnameseSourcePath"]
        # Mechanical LF normalization matches .gitattributes, including Windows.
        data = path.read_bytes().replace(b"\r\n", b"\n")
        if data != path.read_bytes():
            path.write_bytes(data)
        row["sourceSha256"] = source_digest(data)
    payload["constructionSites"] = [classify(site) for site in discover()]
    bindings = {
        ("assessment_root/agent.py", "after_model"): "assessment-root.continuation",
        ("assessment_root/researcher.py", "researcher_prompt_for_locale"): "repository-researcher.system",
        ("rule_set_preparation/draft_history.py", "compact_draft_history"): "preparation.history",
        ("rule_set_preparation/draft_history.py", "_view"): "preparation.history",
        ("rule_set_preparation/agent.py", "after_model"): "preparation.continuation",
    }
    for site in payload["constructionSites"]:
        identity = bindings.get((site["filePath"], site["symbolName"]))
        path, kind = site["filePath"], site.get("astKind")
        if kind == "PROMOTED_TOOL_DOCSTRING":
            identity = "assessment-tools.descriptions" if path.startswith(("assessment_root/", "tools/common/codebase_memory_graph/")) else "preparation-tools.descriptions"
            site["constructionType"] = "MAINTAINED_TOOL_DESCRIPTION"
        elif kind == "FACTORY_TOOL_DESCRIPTION" and path.endswith("claim_tools.py"):
            identity = "preparation-tools.descriptions"
            site["constructionType"] = "MAINTAINED_TOOL_DESCRIPTION"
        elif kind == "DESCRIPTION_OVERRIDE":
            identity = "preparation-tools.descriptions"
        elif kind in {"KEYWORD_DESCRIPTION", "SCHEMA_DESCRIPTION"} and (
            site["symbolName"].endswith(("Args", "Request")) or
            path in {"rule_set_preparation/claim_tools.py", "rule_set_preparation/tools.py"} and site["symbolName"] != "build_claim_tools" and kind == "SCHEMA_DESCRIPTION"):
            identity = "tools.schema-guidance"
        elif kind == "SCHEMA_DESCRIPTION" and path.endswith("claim_tools.py"):
            identity = "tools.schema-guidance"
        elif site["constructionType"] == "MAINTAINED_TOOL_DESCRIPTION" and site["symbolName"].endswith(("Args", "Request", "DecisionReference")):
            identity = "tools.schema-guidance"
        if identity:
            site["viSourceId"] = identity
            site["migrationStatus"] = "DRAFT_SOURCE_REGISTERED_RUNTIME_CUTOVER_PENDING"
    from framework_instruction_audit import installed_surfaces
    payload["frameworkInstructions"] = installed_surfaces()
    from instruction_site_dispositions import reconcile_site
    payload["constructionSites"] = [reconcile_site(site) for site in payload["constructionSites"]]
    # Store all actual consumer symbols, not only the first migration reference.
    for site in payload["constructionSites"]:
        if site.get("viSourceId"):
            row = existing[site["viSourceId"]]
            consumer = {"filePath": site["filePath"], "symbolName": site["symbolName"], "integrationStatus": "PENDING_RUNTIME_CUTOVER"}
            if consumer not in row["consumers"]:
                row["consumers"].append(consumer)
    INVENTORY.parent.mkdir(parents=True, exist_ok=True)
    INVENTORY.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"sites": len(payload["constructionSites"]), "classifications": Counter(row["constructionType"] for row in payload["constructionSites"])}, indent=2))


if __name__ == "__main__":
    main()
