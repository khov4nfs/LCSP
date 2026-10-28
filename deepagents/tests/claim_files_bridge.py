"""Provider-free native-tool harness backed by real transactional API handlers."""
import json
import os
import subprocess
from copy import deepcopy
from pathlib import Path

from rule_set_preparation.source_graph import PinnedSourceGraph
from rule_set_preparation.tools import RuleSetPreparationContext, build_rule_set_tools

ROOT=Path(__file__).resolve().parents[2]

_process = None

def bridge(payload):
    global _process
    if _process is None:
        _process=subprocess.Popen(["pnpm","exec","tsx","apps/api/test/support/review-frontier-bridge.ts"],cwd=ROOT,
            env={**os.environ,"REVIEW_FRONTIER_BRIDGE_STREAM":"true","DATABASE_URL":os.environ.get("REVIEW_FRONTIER_DATABASE_URL",os.environ.get("DATABASE_URL",""))},stdin=subprocess.PIPE,stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,text=True,bufsize=1)
        import atexit
        def close():
            _process.stdin.close()
            try: _process.wait(timeout=10)
            except subprocess.TimeoutExpired: _process.terminate()
        atexit.register(close)
    _process.stdin.write(json.dumps(payload)+"\n");_process.stdin.flush()
    while True:
        line=_process.stdout.readline()
        if not line: raise RuntimeError("Frontier bridge exited before returning a result")
        try: result=json.loads(line)
        except json.JSONDecodeError: continue
        if "error" in result: raise RuntimeError(result["error"])
        return result["result"]

def reclaim(run_id):
    """A new worker process takes the run over: production's claim handler resets the run's review operation and
    expires the previous process's leases before the new process starts."""
    return bridge({"action":"RECLAIM","request":{"preparationRunId":run_id}})

class DatabaseFrontierApi:
    def source_review_operation(self,run_id,revision,action,**fields):
        return bridge({"action":"REVIEW","request":{"preparationRunId":run_id,"inventoryRevision":revision,"action":action,**fields}})
    def claim_inventory_operation(self,run_id,action,revision,**fields):
        return bridge({"action":"INVENTORY","request":{"preparationRunId":run_id,"action":action,"revision":revision,**fields}})
    def validate_compliance_rule_set(self,*args):
        raise AssertionError("Discovery-only harness cannot validate Rules")
    def submit_compliance_rule_set(self,*args):
        raise AssertionError("Discovery-only harness cannot submit")

class ToolRecorder:
    """Callback that keeps every result of the named tools: the history middleware releases completed units' messages."""
    def __init__(self, *names):
        from langchain_core.callbacks import BaseCallbackHandler
        recorder=self
        class Handler(BaseCallbackHandler):
            run_inline=True
            def on_tool_start(self,serialized,input_str,*,run_id,**kwargs): recorder._names[str(run_id)]=(serialized or {}).get("name")
            def on_tool_end(self,output,*,run_id,**kwargs):
                name=recorder._names.pop(str(run_id),None)
                if name in recorder.names:
                    content=getattr(output,"content",output)
                    recorder.results.setdefault(name,[]).append(json.loads(content) if isinstance(content,str) else content)
        self.names, self._names, self.results = set(names), {}, {}
        self.handler=Handler()
    def config(self): return {"callbacks":[self.handler]}
