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
    ("deepagents", "deepagents/middleware/subagents.py", "TASK_TOOL_DESCRIPTION", "HarnessProfile.tool_description_overrides[task]"),
    ("deepagents", "deepagents/middleware/subagents.py", "DEFAULT_SUBAGENT_PROMPT", "Explicit subagent system_prompt; disable general-purpose profile"),
    ("deepagents", "deepagents/middleware/subagents.py", "_FORK_TASK_PREAMBLE", "Disable fork mode until a controlled adapter exists"),
    ("deepagents", "deepagents/middleware/subagents.py", "TaskToolSchema", "Task schema description adapter required"),
    ("deepagents", "deepagents/middleware/summarization.py", "DEEPAGENTS_DEFAULT_SUMMARY_PROMPT", "create_summarization_middleware(summary_prompt=resolved_entry)"),
    ("deepagents", "deepagents/middleware/summarization.py", "_MEDIA_REFERENCE_SUMMARY_PROMPT", "Include media-reference semantics in resolved summary_prompt"),
    ("deepagents", "deepagents/middleware/filesystem.py", "FilesystemMiddleware", "system_prompt and custom_tool_descriptions; field schema adapter still required"),
    ("deepagents", "deepagents/middleware/filesystem.py", "LIST_FILES_TOOL_DESCRIPTION", "FilesystemMiddleware.custom_tool_descriptions[ls]"),
    ("deepagents", "deepagents/middleware/filesystem.py", "_READ_FILE_TOOL_DESCRIPTION_TEMPLATE", "FilesystemMiddleware.custom_tool_descriptions[read_file]"),
    ("deepagents", "deepagents/middleware/filesystem.py", "EDIT_FILE_TOOL_DESCRIPTION", "FilesystemMiddleware.custom_tool_descriptions[edit_file]"),
    ("deepagents", "deepagents/middleware/filesystem.py", "WRITE_FILE_TOOL_DESCRIPTION", "FilesystemMiddleware.custom_tool_descriptions[write_file]"),
    ("deepagents", "deepagents/middleware/filesystem.py", "GLOB_TOOL_DESCRIPTION", "FilesystemMiddleware.custom_tool_descriptions[glob]"),
    ("deepagents", "deepagents/middleware/filesystem.py", "_GREP_TOOL_DESCRIPTION_TEMPLATE", "FilesystemMiddleware.custom_tool_descriptions[grep]"),
    ("deepagents", "deepagents/graph.py", "create_deep_agent", "HarnessProfile base_system_prompt/system_prompt_suffix and middleware slots"),
    ("langchain", "langchain/agents/middleware/todo.py", "WRITE_TODOS_SYSTEM_PROMPT", "TodoListMiddleware(system_prompt=resolved_entry)"),
    ("langchain", "langchain/agents/middleware/todo.py", "WRITE_TODOS_TOOL_DESCRIPTION", "TodoListMiddleware(tool_description=resolved_entry)"),
    ("langchain", "langchain/agents/middleware/todo.py", "TodoListMiddleware", "tool_description and system_prompt overrides"),
    ("langchain", "langchain/agents/middleware/summarization.py", "DEFAULT_SUMMARY_PROMPT", "summary_prompt preserving messages marker and data placeholder"),
    ("langchain", "langchain/agents/middleware/model_call_limit.py", "ModelCallLimitMiddleware", "Model-limit termination messages require adapter review"),
)


def installed_surfaces():
    """Business purpose: Fingerprint the installed framework injection surfaces.

    Business rules:
    - Each declared symbol must exist; dependency defaults remain unapproved until adapted.
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
        result.append({"package": package, "version": dist.version, "filePath": filename,
                       "symbolName": symbol, "lineNumber": match.lineno,
                       "expressionSha256": source_digest(ast.dump(match, include_attributes=False).encode("utf-8")),
                       "viSourceId": "framework.injected-policy", "overridePlan": override,
                       "controlStatus": "ADAPTER_REQUIRED", "reachesModel": not inactive,
                       "activationEvidence": "General-purpose profile disabled and configured delegates are isolated; guard required against later activation." if inactive else "Active injection/default-capable construction boundary; adapter must verify actual resolved instructions."})
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
    if declared != installed_surfaces():
        raise RuntimeInstructionBundleError("FRAMEWORK_INSTRUCTION_DRIFT")
