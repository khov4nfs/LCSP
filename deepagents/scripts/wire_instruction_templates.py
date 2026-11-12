"""Mechanical migration of legacy literal templates to mandatory bundle reads.

Run only during the LCSP-347 source migration; no production approvals emitted.
"""
import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_expressions(path, replacements):
    """Business purpose: Replace identified instruction expressions while preserving surrounding Python code.

    Business rules:
    - Only explicit AST expression spans are edited; the result remains subject to inventory and review gates.
    Execution flow:
    1. Order replacements from the end of the source and apply the requested edits.
    Failure cases:
    - Invalid source offsets or replacement content surface as migration failures.
    Side effects:
    - Return transformed source text in memory.
    """
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)
    starts = [0]
    for line in lines:
        starts.append(starts[-1] + len(line))
    edits = []
    for node, value in replacements(ast.parse(text)):
        # AST columns are UTF-8 byte offsets, unlike Python string slicing.
        begin = starts[node.lineno - 1] + len(lines[node.lineno - 1].encode("utf-8")[:node.col_offset].decode("utf-8"))
        end = starts[node.end_lineno - 1] + len(lines[node.end_lineno - 1].encode("utf-8")[:node.end_col_offset].decode("utf-8"))
        edits.append((begin, end, value))
    for begin, end, value in sorted(edits, reverse=True):
        text = text[:begin] + value + text[end:]
    if "from runtime_instruction_bundle import runtime_instruction" not in text:
        text = text.replace("from __future__ import annotations", "from __future__ import annotations\n\nfrom runtime_instruction_bundle import runtime_instruction", 1)
    path.write_text(text, encoding="utf-8", newline="\n")


def continuation(tree, source):
    """Business purpose: Identify maintained continuation message expressions for bundle migration.

    Business rules:
    - Runtime evidence and user message content must not be treated as maintained policies.
    Execution flow:
    1. Inspect message construction and select its registered instruction replacement.
    Failure cases:
    - Unrecognized expressions remain unmigrated for coverage review.
    Side effects:
    - None: returns migration replacement metadata.
    """
    for method in ast.walk(tree):
        if isinstance(method, (ast.FunctionDef, ast.AsyncFunctionDef)) and method.name == "after_model":
            for call in ast.walk(method):
                if isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == "HumanMessage":
                    for keyword in call.keywords:
                        if keyword.arg == "content":
                            yield keyword.value, f'runtime_instruction("{source}")'


def main():
    """Business purpose: Apply the explicit instruction-template migration to known runtime modules.

    Business rules:
    - This operator tool does not compile approvals or change domain tool permissions.
    Execution flow:
    1. Parse targeted modules, replace maintained templates and save the edited source.
    Failure cases:
    - Unreadable or malformed Python prevents migration.
    Side effects:
    - Rewrite targeted runtime Python files for later review and compilation.
    """
    replace_expressions(ROOT / "assessment_root/agent.py", lambda tree: continuation(tree, "assessment-root.continuation"))
    replace_expressions(ROOT / "rule_set_preparation/agent.py", lambda tree: continuation(tree, "preparation.continuation"))
    def child(tree):
        """Business purpose: Select the Claim Author system instruction composition for migration.

        Business rules:
        - The child retains its existing restricted tool boundary and parent phase authority.
        Execution flow:
        1. Replace the identified child prompt expression with the registered bundle composition.
        Failure cases:
        - Unsupported expression shapes remain outside the codemod.
        Side effects:
        - None: returns replacement instruction source text.
        """
        for function in ast.walk(tree):
            if isinstance(function, ast.FunctionDef) and function.name == "claim_author_subagent":
                for node in ast.walk(function):
                    if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "child_prompt" for t in node.targets):
                        yield node.value, 'phase_instructions(context) + "\\n" + runtime_instruction("claim-author.system")'
                    if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "child_assignment" for t in node.targets):
                        yield node.value, '""'
    replace_expressions(ROOT / "rule_set_preparation/agent.py", child)
    def transforms(tree):
        """Business purpose: Bind maintained response-transform templates to approved runtime entry IDs.

        Business rules:
        - Runtime payloads and selected output-language data retain their existing provenance.
        Execution flow:
        1. Identify text or structured transform expressions and replace the maintained template reference.
        Failure cases:
        - Unrecognized expressions are not silently relabelled as migrated.
        Side effects:
        - None: returns source-expression replacements.
        """
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name) and node.func.value.id in {"TRANSFORM_SYSTEM_PROMPT_TEMPLATE", "STRUCTURED_SYSTEM_PROMPT_TEMPLATE"} and node.func.attr == "format":
                source = "runtime.structured-transform" if node.func.value.id.startswith("STRUCTURED") else "runtime.response-transform"
                yield node.func.value, f'runtime_instruction("{source}")'
    replace_expressions(ROOT / "orchestration/localization.py", transforms)


if __name__ == "__main__":
    main()
