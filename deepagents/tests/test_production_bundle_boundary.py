"""Direct runtime loader loads instructions directly without manifest/sha guards."""
from pathlib import Path
import pytest

from runtime_instruction_bundle import production_runtime_bundle, runtime_instruction, clear_runtime_bundle_cache


def test_production_runtime_bundle_loads_directly():
    clear_runtime_bundle_cache()
    bundle = production_runtime_bundle()
    assert len(bundle.entries) >= 59
    assert bundle.instruction("preparation.direct")
    assert bundle.instruction("claim-author.system")
    assert bundle.instruction("assessment-root.system")


def test_runtime_instruction_resolves_directly():
    clear_runtime_bundle_cache()
    assert "Rule Set Preparation" in runtime_instruction("preparation.direct")
    assert "whole Article" in runtime_instruction("claim-author.system")
    assert "Assessment Root" in runtime_instruction("assessment-root.system")
