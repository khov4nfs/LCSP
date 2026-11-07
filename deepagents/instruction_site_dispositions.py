"""Evidence-based dispositions for known construction families.

Unknown expressions remain explicitly unresolved. This table never creates VI
content and does not declare third-party defaults controlled.
"""


def reconcile_site(site):
    path, symbol, text = site["filePath"], site["symbolName"], site["evidence"]
    identity = site.get("viSourceId")
    disposition = "BOUND_TO_VI_SOURCE" if identity else "EXPLICITLY_UNRESOLVED"
    reason = "Registered VI draft describes this consumer; runtime cutover and equivalence review remain pending."
    if site.get("constructionType") == "NON_MODEL_FACING" or "scripts/" in path or path.endswith("eval_cli.py"):
        disposition, identity = "NON_MODEL_FACING", None
        reason = "CLI help, accounting or implementation sentinel; this expression is not a message/template injection."
    elif path.endswith("tracing.py") or path.endswith("usage_metering.py") or symbol == "_prompt_overhead_tokens":
        disposition, identity = "NON_MODEL_FACING", None
        reason = "Tracing/token estimation reads prompt metadata for telemetry; this expression is not injected into model messages."
    elif path == "assessment_root/agent.py":
        identity = "assessment-tools.descriptions" if symbol == "_graph_tools" else "assessment-root.continuation" if symbol == "after_model" else "repository-researcher.system" if "researcher_prompt" in text else "assessment-root.system"
    elif path == "assessment_root/researcher.py":
        identity = "repository-researcher.system"
    elif path == "assessment_root/tools.py" and symbol == "DecisionReference":
        identity = "tools.schema-guidance"
    elif path == "assessment_root/tools.py" and symbol == "tool":
        identity = "assessment-tools.descriptions"
    elif path == "middleware/model_governance.py":
        identity, disposition = "framework.injected-policy", "THIRD_PARTY_CONTROLLED"
        reason = "Governed internal runnable forwards framework-generated summary prompt and caller system prompt; twelve pinned framework surfaces require adapters."
    elif path == "middleware/approved_instructions.py":
        identity = "framework.injected-policy"
    elif path == "middleware/agent_run_budget.py":
        identity = "runtime.budget-finalization"
    elif path == "middleware/runtime_context.py":
        identity = "runtime.context-identifiers"
    elif path == "middleware/localization.py":
        identity = "runtime.response-language"
    elif path == "orchestration/localization.py":
        if (site.get("astKind") == "MESSAGE_HUMANMESSAGE" and text in {"text", "json_payload"}) or "HumanMessage(content=text)" in text or "HumanMessage(content=json_payload)" in text:
            disposition, identity = "RUNTIME_DATA", None
            reason = "Final authored response/JSON payload supplied as human-message data to the transform, preserving original provenance."
        else:
            identity = "runtime.response-language" if symbol == "get_language_prompt_instruction" or site.get("astKind") == "KEYWORD_INSTRUCTION" else "runtime.structured-transform" if "structured" in symbol or "STRUCTURED_SYSTEM" in text else "runtime.response-transform"
    elif path == "rule_set_preparation/agent.py":
        if symbol == "preparation_filesystem":
            identity = "framework.injected-policy"
        elif symbol == "claim_author_subagent":
            identity = "claim-author.system"
        elif symbol in {"_observe", "_with_observation_feedback"}:
            identity = "preparation.observation-errors"
        elif symbol == "after_model":
            identity = "preparation.continuation"
        elif symbol in {"_request", "phase_instructions", "create_rule_set_preparation_agent"}:
            identity = "preparation.direct" if "instructions-direct" in text else "preparation.common"
    elif path == "rule_set_preparation/authoring_recorder.py" or path == "rule_set_preparation/authoring_state.py":
        identity = "preparation.authoring-state"
    elif path == "rule_set_preparation/legal_source_files.py":
        identity = "preparation.materialized-source-guidance"
    elif path == "rule_set_preparation/draft_history.py":
        identity = "preparation.history-counts" if "ledger.draft_version" in text else "preparation.authoring-state" if text == "digest" else "preparation.history"
    elif path == "rule_set_preparation/claim_tools.py" and not identity:
        identity = "preparation-tools.descriptions"
    elif path == "rule_set_preparation/preparation_skills.py" and not identity:
        identity = "preparation.presentation" if symbol == "preparation_locale_overlay" else "preparation.development-overlay" if symbol == "development_scope_overlay" else "preparation.observation-errors" if "_SKILL_TOOL_ERRORS" in text or symbol == "_skill_tool_error" else "runtime.skill-catalogs"
    elif path == "assessment_root/skills.py" or path.endswith("agent_runtime/skill_loader.py"):
        identity = "runtime.skill-catalogs"
    if disposition not in {"NON_MODEL_FACING", "RUNTIME_DATA", "THIRD_PARTY_CONTROLLED"}:
        disposition = "SHARED_SOURCE_CONSUMER" if identity else "EXPLICITLY_UNRESOLVED"
    site.update(viSourceId=identity, migrationDecision=disposition, dispositionEvidence=reason,
                migrationStatus="EXPLICITLY_UNRESOLVED" if disposition == "EXPLICITLY_UNRESOLVED" else disposition)
    return site
