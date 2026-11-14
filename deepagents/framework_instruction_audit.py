"""Read-only fingerprinting of installed model-facing framework defaults.

No dependency modules are imported or patched. Publication must reject pending
adapters; English package defaults are not silently exempt from VI authority.
"""
import ast
from importlib.metadata import distribution
from pathlib import Path

from instruction_source_inventory import source_digest
from runtime_instruction_bundle import RuntimeInstructionBundleError


SURFACES = (
    ("deepagents", "deepagents/middleware/subagents.py", "TASK_TOOL_DESCRIPTION", "ApprovedInstructionMiddleware -> approved_tool_specs(tool.task)"),
    ("deepagents", "deepagents/middleware/subagents.py", "DEFAULT_SUBAGENT_PROMPT", "Explicit subagent system_prompt; disable general-purpose profile"),
    ("deepagents", "deepagents/middleware/subagents.py", "_FORK_TASK_PREAMBLE", "Disable fork mode until a controlled adapter exists"),
    ("deepagents", "deepagents/middleware/subagents.py", "TaskToolSchema", "approved_tool_specs recursively resolves schema guidance and removes unapproved annotation examples"),
    ("deepagents", "deepagents/middleware/summarization.py", "DEEPAGENTS_DEFAULT_SUMMARY_PROMPT", "create_summarization_middleware(summary_prompt=resolved_entry)"),
    ("deepagents", "deepagents/middleware/summarization.py", "_MEDIA_REFERENCE_SUMMARY_PROMPT", "Include media-reference semantics in resolved summary_prompt"),
    ("deepagents", "deepagents/middleware/filesystem.py", "FilesystemMiddleware", "ApprovedInstructionMiddleware projects system/tool/schema instructions; native execution permissions remain intact"),
    ("deepagents", "deepagents/middleware/filesystem.py", "LIST_FILES_TOOL_DESCRIPTION", "approved_tool_specs(tool.ls)"),
    ("deepagents", "deepagents/middleware/filesystem.py", "_READ_FILE_TOOL_DESCRIPTION_TEMPLATE", "approved_tool_specs(tool.read_file)"),
    ("deepagents", "deepagents/middleware/filesystem.py", "EDIT_FILE_TOOL_DESCRIPTION", "approved_tool_specs(tool.edit_file)"),
    ("deepagents", "deepagents/middleware/filesystem.py", "WRITE_FILE_TOOL_DESCRIPTION", "approved_tool_specs(tool.write_file)"),
    ("deepagents", "deepagents/middleware/filesystem.py", "GLOB_TOOL_DESCRIPTION", "approved_tool_specs(tool.glob)"),
    ("deepagents", "deepagents/middleware/filesystem.py", "_GREP_TOOL_DESCRIPTION_TEMPLATE", "approved_tool_specs(tool.grep)"),
    ("deepagents", "deepagents/graph.py", "create_deep_agent", "Final approved request overrides profile additions; uncontrolled extra/excluded middleware is rejected; transport supervisor cannot infer"),
    ("langchain", "langchain/agents/middleware/todo.py", "WRITE_TODOS_SYSTEM_PROMPT", "TodoListMiddleware(system_prompt=resolved_entry)"),
    ("langchain", "langchain/agents/middleware/todo.py", "WRITE_TODOS_TOOL_DESCRIPTION", "TodoListMiddleware(tool_description=resolved_entry)"),
    ("langchain", "langchain/agents/middleware/todo.py", "TodoListMiddleware", "tool_description and system_prompt overrides"),
    ("langchain", "langchain/agents/middleware/summarization.py", "DEFAULT_SUMMARY_PROMPT", "summary_prompt preserving messages marker and data placeholder"),
    ("langchain", "langchain/agents/middleware/model_call_limit.py", "ModelCallLimitMiddleware", "ApprovedModelCallLimitMiddleware replaces terminal text with approved runtime.budget-finalization:HARD_STOP"),
)


def installed_surfaces():
    """Business purpose: Fingerprint the installed framework injection surfaces.

    Business rules:
    - Each dependency symbol and the local adapter implementation are fingerprinted; technical control grants no translation approval.
    Execution flow:
    1. Read distribution versions, parse each installed module and hash the exact symbol AST.
    Failure cases:
    - Missing distributions, modules or symbols reject the inventory.
    Side effects:
    - Read installed package files without importing or patching their behavior.
    """
    result = []
    for package, filename, symbol, override in SURFACES:
        dist = distribution(package)
        path = Path(dist.locate_file(filename))
        tree = ast.parse(path.read_text(encoding="utf-8"))
        match = None
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name == symbol:
                match = node
            elif isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == symbol for t in node.targets):
                match = node.value
        if match is None:
            raise RuntimeInstructionBundleError("FRAMEWORK_INSTRUCTION_SURFACE_MISSING:" + symbol)
        inactive = symbol in {"DEFAULT_SUBAGENT_PROMPT", "_FORK_TASK_PREAMBLE"}
        summary = symbol in {"DEEPAGENTS_DEFAULT_SUMMARY_PROMPT", "_MEDIA_REFERENCE_SUMMARY_PROMPT", "DEFAULT_SUMMARY_PROMPT"}
        limit = symbol == "ModelCallLimitMiddleware"
        adapter_files = ["middleware/approved_instructions.py"]
        if inactive or symbol == "create_deep_agent":
            adapter_files += ["rule_set_preparation/agent.py", "assessment_root/researcher.py"]
        if symbol == "create_deep_agent":
            adapter_files += ["agent.py", "middleware/system_event_dispatch.py"]
        if summary:
            adapter_files += ["middleware/model_governance.py"]
        local_root = Path(__file__).resolve().parent
        evidence = (
            "Explicit isolated mode and system_prompt on both delegates; general-purpose disabled under the shared profile lock. Unreviewed profile middleware or guard exclusion rejects graph construction."
            if inactive else
            "Explicit bundle summary_prompt replaces both framework defaults, including media-reference semantics. ApprovedSummaryInstructions verifies the exact role system composition and history-template boundary before synchronous/asynchronous inference; operation receipts pin actual template bytes."
            if summary else
            "ApprovedModelCallLimitMiddleware preserves native counters/routing and replaces generated terminal content with runtime.budget-finalization:HARD_STOP."
            if limit else
            "ApprovedInstructionMiddleware is the final model boundary: system composition and tool/schema guidance resolve from the verified bundle; unexpected system messages and unknown tools reject inference. Profile middleware cannot exclude or follow the guard; schemas preserve validation constraints."
        )
        result.append({"package": package, "version": dist.version, "filePath": filename,
                       "symbolName": symbol, "lineNumber": match.lineno,
                       "expressionSha256": source_digest(ast.dump(match, include_attributes=False).encode("utf-8")),
                       "viSourceId": "runtime.budget-finalization" if limit else "framework.injected-policy", "overridePlan": override,
                       "controlStatus": "CONTROLLED", "reachesModel": not inactive,
                       "controlMode": "DISABLED_GUARDED" if inactive else "EXPLICIT_SUMMARY_TEMPLATE" if summary else "APPROVED_LIMIT_TERMINAL" if limit else "FINAL_REQUEST_PROJECTION",
                       "adapterFingerprintKind": "PYTHON_AST_NO_SOURCE_LOCATIONS",
                       "adapterSourceSha256": {name: source_digest(ast.dump(ast.parse((local_root / name).read_text(encoding="utf-8")), include_attributes=False).encode("utf-8")) for name in adapter_files},
                       "activationEvidence": evidence})
    return result


def validate_framework_surfaces(declared):
    """Business purpose: Reject an installation that differs from the recorded framework contract.

    Business rules:
    - Version, symbol fingerprint and control metadata must match exactly.
    Execution flow:
    1. Recompute installed surfaces and compare against the declared list.
    Failure cases:
    - FRAMEWORK_INSTRUCTION_DRIFT blocks publication on any discrepancy.
    Side effects:
    - Read installed framework metadata; change no runtime instructions.
    """
    installed = installed_surfaces()
    if len(declared) != len(installed):
        raise RuntimeInstructionBundleError("FRAMEWORK_INSTRUCTION_DRIFT")
    for d, ins in zip(declared, installed):
        for k, v in d.items():
            if ins.get(k) != v:
                raise RuntimeInstructionBundleError("FRAMEWORK_INSTRUCTION_DRIFT")
