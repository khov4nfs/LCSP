"""Strict completion must not confuse classified expressions with governed defaults."""
import copy
import json
from pathlib import Path
import pytest

from instruction_source_inventory import ROOT, INVENTORY, discover, validate_inventory
from runtime_instruction_bundle import RuntimeInstructionBundleError
from scripts.verify_instruction_inventory import verification_report


def test_verification_report_reconciles_sites_without_hiding_framework_blockers():
    report = verification_report()
    assert report["DISCOVERED_SITES_TOTAL"] == report["ORIGINAL_SITES_ACCOUNTED"] + report["NEW_SITES_DISCOVERED"]
    assert report["PENDING_SOURCE_MAPPINGS"] == 0
    assert report["STRICT_INVENTORY_RESULT"] == "BLOCKED"
    assert report["UNRESOLVED_INSTRUCTION_PATHS"]
    assert all(row["controlStatus"] == "ADAPTER_REQUIRED" for row in report["UNRESOLVED_INSTRUCTION_PATHS"])


def test_unregistered_multiline_schema_and_tool_decorator_are_discovered(tmp_path):
    folder = tmp_path / "assessment_root"
    folder.mkdir()
    (folder / "new.py").write_text('''@tool\ndef example():\n    """New model instruction."""\n    return None\n\nclass Args:\n    value = Field(\n        description=("new "\n                     "schema guidance")\n    )\n''', encoding="utf-8")
    kinds = {site.get("astKind") for site in discover(tmp_path)}
    assert {"PROMOTED_TOOL_DOCSTRING", "KEYWORD_DESCRIPTION"} <= kinds


def test_unknown_disposition_is_rejected_before_framework_control(tmp_path):
    payload = copy.deepcopy(validate_inventory())
    payload["constructionSites"][0]["migrationDecision"] = "EXPLICITLY_UNRESOLVED"
    path = tmp_path / "inventory.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(RuntimeInstructionBundleError, match="MIGRATION_INCOMPLETE"):
        validate_inventory(ROOT, path, require_complete=True)


def test_source_consumer_cannot_be_faked_with_a_comment_or_docstring(tmp_path):
    payload = copy.deepcopy(validate_inventory())
    payload["entries"][0]["consumers"][0]["symbolName"] = "Business purpose"
    path = tmp_path / "inventory.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(RuntimeInstructionBundleError, match="CONSUMER_MISSING"):
        validate_inventory(ROOT, path)
