"""Exercise the native selected graph against real worker HTTP with a provider-free model."""
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

import instruction_source_inventory
import runtime_instruction_bundle as instructions
from rule_set_preparation import selected_rule
from test_selected_rule_preparation import SelectedFixtureModel
from tools.common.capabilities.platform.api_client import WorkerApiClient


def main():
    base, key, run_id, revision, outcome = sys.argv[1:6]
    api = WorkerApiClient(base, key)
    model = SelectedFixtureModel()
    # Only provider governance and event transport are faked. Claims, receipts and completions use real HTTP.
    selected_rule.MODEL_GOVERNANCE_MIDDLEWARE = []
    selected_rule.publish_agent_stream_event = lambda *args, **kwargs: None
    if outcome == "FAILED":
        def fail(*args, **kwargs):
            model.calls.append("scripted failure")
            raise RuntimeError("Provider-free partial failure fixture")
        model._generate = fail
    with TemporaryDirectory(prefix="lcsp369-instructions-") as directory:
        instruction_source_inventory.ROOT = Path(directory)
        asset = Path(directory, "instructions/candidates/r1/preparation.selected.txt")
        asset.parent.mkdir(parents=True)
        asset.write_text("Stale process-cached instruction", encoding="utf-8")
        vi_source = Path(directory, "instructions/vi/preparation-selected.md")
        vi_source.parent.mkdir(parents=True, exist_ok=True)
        vi_source.write_text("Nguồn hướng dẫn tiếng Việt", encoding="utf-8")
        (Path(directory) / "instructions/inventory.json").write_text(json.dumps({
            "schemaVersion": "LCSP_EN_RUNTIME_BUNDLE_V1",
            "bundleId": "selected-vertical-fixture",
            "requiredSourceIds": ["preparation.selected"],
            "entries": [{
                "sourceId": "preparation.selected",
                "vietnameseSourcePath": "instructions/vi/preparation-selected.md",
                "englishCandidatePath": "instructions/candidates/r1/preparation.selected.txt",
            }],
        }), encoding="utf-8")
        instructions.clear_runtime_bundle_cache()
        stale = instructions.production_runtime_bundle()
        asset.write_text(f"Selected preparation instruction {revision}", encoding="utf-8")
        result = selected_rule.run_selected_rule_preparation(api, run_id, model=model)
        assert result["state"] == outcome, result
        assert len(model.calls) == 1
        duplicate = selected_rule.run_selected_rule_preparation(api, run_id, model=model)
        assert duplicate["state"] == "ALREADY_CLAIMED", duplicate
        assert len(model.calls) == 1, "Duplicate delivery must not invoke the model"
        assert instructions.production_runtime_bundle() is stale
        print(json.dumps({"state": result["state"], "calls": len(model.calls), "duplicate": duplicate["state"]}))


if __name__ == "__main__":
    main()
