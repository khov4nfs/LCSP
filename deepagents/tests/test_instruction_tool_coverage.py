"""Compare VI descriptions with actual decorators, factory specs and fields."""
import ast
import json
from instruction_source_inventory import ROOT, validate_inventory


def read_source(name):
    return json.loads((ROOT / "instructions/vi" / name).read_text(encoding="utf-8"))


def test_all_pydantic_tool_field_descriptions_have_vi_text():
    translations = read_source("tool-schema-guidance.json")
    for filename in ("assessment_root/tools.py", "rule_set_preparation/source_graph.py", "tools/common/codebase_memory_graph/code.py"):
        tree = ast.parse((ROOT / filename).read_text(encoding="utf-8"))
        for cls in [n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]:
            for field in cls.body:
                if isinstance(field, ast.AnnAssign) and isinstance(field.value, ast.Call) and any(k.arg == "description" for k in field.value.keywords):
                    key = cls.name + "." + field.target.id
                    assert key in translations, key
                    assert translations[key].strip()


def test_actual_promoted_docstrings_have_vi_descriptions():
    payload = validate_inventory()
    root = read_source("root-tool-descriptions.json")
    preparation = read_source("preparation-tool-guidance.json")
    for site in payload["constructionSites"]:
        if site.get("astKind") == "PROMOTED_TOOL_DOCSTRING":
            table = root if site["viSourceId"] == "assessment-tools.descriptions" else preparation
            assert site["symbolName"] in table, site["modelFacingConsumer"]


def test_factory_and_mode_overrides_have_vi_descriptions():
    table = read_source("preparation-tool-guidance.json")
    tree = ast.parse((ROOT / "rule_set_preparation/claim_tools.py").read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Tuple) and len(node.elts) == 4 and isinstance(node.elts[0], ast.Constant) and isinstance(node.elts[1], ast.Constant):
            assert node.elts[0].value in table
    for tool in ("validate_compliance_rule_set", "submit_compliance_rule_set"):
        for mode in ("legacy", "authoring", "direct"):
            assert f"{tool}.{mode}" in table
