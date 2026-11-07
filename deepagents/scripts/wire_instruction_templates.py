"""Mechanical migration of legacy literal templates to mandatory bundle reads.

Run only during the LCSP-347 source migration; no production approvals emitted.
"""
import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_expressions(path, replacements):
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
    for method in ast.walk(tree):
        if isinstance(method, (ast.FunctionDef, ast.AsyncFunctionDef)) and method.name == "after_model":
            for call in ast.walk(method):
                if isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == "HumanMessage":
                    for keyword in call.keywords:
                        if keyword.arg == "content":
                            yield keyword.value, f'runtime_instruction("{source}")'


def main():
    replace_expressions(ROOT / "assessment_root/agent.py", lambda tree: continuation(tree, "assessment-root.continuation"))
    replace_expressions(ROOT / "rule_set_preparation/agent.py", lambda tree: continuation(tree, "preparation.continuation"))
    def child(tree):
        for function in ast.walk(tree):
            if isinstance(function, ast.FunctionDef) and function.name == "claim_author_subagent":
                for node in ast.walk(function):
                    if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "child_prompt" for t in node.targets):
                        yield node.value, 'phase_instructions(context) + "\\n" + runtime_instruction("claim-author.system")'
                    if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "child_assignment" for t in node.targets):
                        yield node.value, '""'
    replace_expressions(ROOT / "rule_set_preparation/agent.py", child)
    def transforms(tree):
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name) and node.func.value.id in {"TRANSFORM_SYSTEM_PROMPT_TEMPLATE", "STRUCTURED_SYSTEM_PROMPT_TEMPLATE"} and node.func.attr == "format":
                source = "runtime.structured-transform" if node.func.value.id.startswith("STRUCTURED") else "runtime.response-transform"
                yield node.func.value, f'runtime_instruction("{source}")'
    replace_expressions(ROOT / "orchestration/localization.py", transforms)


if __name__ == "__main__":
    main()
