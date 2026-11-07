"""Provider-free lifecycle source and installed framework integrity checks."""
import copy
import pytest

from framework_instruction_audit import installed_surfaces, validate_framework_surfaces
from instruction_source_inventory import ROOT, validate_inventory, render_enum_template
from runtime_instruction_bundle import RuntimeInstructionBundleError


def test_installed_framework_matches_recorded_injection_surfaces():
    validate_framework_surfaces(validate_inventory()["frameworkInstructions"])


def test_framework_change_cannot_be_hidden_by_version_or_symbol_labels():
    surfaces = copy.deepcopy(installed_surfaces())
    surfaces[0]["expressionSha256"] = "0" * 64
    with pytest.raises(RuntimeInstructionBundleError, match="FRAMEWORK_INSTRUCTION_DRIFT"):
        validate_framework_surfaces(surfaces)


def test_lifecycle_sources_are_registered_without_production_control_claims():
    payload = validate_inventory()
    ids = {row["sourceId"] for row in payload["entries"]}
    assert {"runtime.budget-finalization", "runtime.response-transform", "runtime.structured-transform",
            "runtime.response-language", "runtime.context-identifiers", "preparation.authoring-state",
            "preparation.observation-errors", "framework.injected-policy"} <= ids
    assert all(row["controlStatus"] == "ADAPTER_REQUIRED" for row in payload["frameworkInstructions"])


@pytest.mark.parametrize("locale,language", [("en", "English"), ("vi", "Vietnamese")])
def test_transform_source_accepts_only_trusted_locale_parameters(locale, language):
    payload = validate_inventory()
    row = next(row for row in payload["entries"] if row["sourceId"] == "runtime.response-transform")
    text = (ROOT / row["vietnameseSourcePath"]).read_text(encoding="utf-8")
    assert row["placeholderSchema"] == {}
    assert render_enum_template(text, {}, {}) == text
    with pytest.raises(RuntimeInstructionBundleError, match="FIELDS_MISMATCH"):
        render_enum_template(text, {}, {"target_locale": locale, "target_language": language})
