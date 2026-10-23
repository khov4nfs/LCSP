"""Reproduce reporting defects against the previous source using copies of recorded evidence."""
import ast
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

from langchain_core.callbacks import BaseCallbackHandler
from vertical.live_preparation import LiveTrace, recover_usage

here = Path(__file__).resolve().parent
old_sha = "640d183f5101f5d1cfc38784777f59a02459a3c3"
relative = "deepagents/tests/vertical/live_preparation.py"
old_source = subprocess.check_output(["git", "show", f"{old_sha}:{relative}"], text=True)
namespace = {"__file__": str(Path(relative).resolve()), "__name__": "frozen_live_preparation"}
exec(compile(old_source, relative, "exec"), namespace)
original = here.parent / "authorized-real-model-20261023/original-journal-snapshot.sqlite3"
before_hash = hashlib.sha256(original.read_bytes()).hexdigest()
summaries = []
with tempfile.TemporaryDirectory(prefix="lcsp360-recorded-recovery-") as directory:
    for name, recover in [("old", namespace["recover_usage"]), ("fixed", recover_usage)]:
        out = str(Path(directory) / f"{name}.json")
        shutil.copyfile(original, out + ".sqlite3")
        value = recover(out, "4ae336f3-35b4-4393-ba42-cb4eeb4d500f")
        summaries.append({k: value[k] for k in ["physicalAttempts", "successfulResponses", "unresolvedAttempts",
            "inputTokensIncludingCache", "outputTokens", "knownInputTokensIncludingCache", "knownOutputTokens"]})
assert summaries[0]["inputTokensIncludingCache"] == 391223 and summaries[1]["inputTokensIncludingCache"] is None
assert summaries[0]["outputTokens"] == 3272 and summaries[1]["outputTokens"] is None
assert summaries[1]["knownInputTokensIncludingCache"] == 391223 and summaries[1]["knownOutputTokens"] == 3272
main = next(n for n in ast.parse(old_source).body if isinstance(n, ast.FunctionDef) and n.name == "main")
trace_class = next(n for n in main.body if isinstance(n, ast.ClassDef) and n.name == "Trace")
events = []
globals_ = {"BaseCallbackHandler": BaseCallbackHandler, "trace": lambda event, **fields: events.append({"event": event, **fields})}
exec(compile(ast.fix_missing_locations(ast.Module(body=[trace_class], type_ignores=[])), relative, "exec"), globals_)
results = []
for callback in [globals_["Trace"](), LiveTrace(globals_["trace"])]:
    events.clear()
    callback.on_tool_start({"name": "get_next_review_unit"}, "{}", run_id="one")
    callback.on_tool_start({"name": "get_review_progress"}, "{}", run_id="two")
    for call_id in ["one", "two"]:
        callback.on_tool_end('{"outcome":"PASSED"}', run_id=call_id)
    results.append([r["tool"] for r in events if r["event"] == "tool_end"])
assert results == [["get_review_progress", "get_review_progress"], ["get_next_review_unit", "get_review_progress"]]
assert hashlib.sha256(original.read_bytes()).hexdigest() == before_hash
proof = {"status": "PASS_OLD_FAILURE_REPRODUCED_FIXED_REPLAY_PASSES", "oldSource": old_sha,
         "recordedJournalSha256": before_hash, "old": summaries[0], "fixed": summaries[1],
         "parallelToolAttribution": {"old": results[0], "fixed": results[1]},
         "originalUnchanged": True, "providerDispatches": 0,
         "semanticVerdictsGenerated": 0, "legalAcceptance": "NOT_EVALUATED"}
(here / "before-after-replay.json").write_text(json.dumps(proof, indent=2) + "\n")
print(json.dumps({"status": proof["status"], "originalUnchanged": True, "providerDispatches": 0}))
