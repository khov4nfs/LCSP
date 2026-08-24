---
task_id: MW-scan-py-007
module: python-workers/scanner
runtime: deepagents
priority: P0
status: DONE
epic_story: 3.5
depends_on:
  - python-workers/scanner/01-scanner-workspace-setup.md
  - python-workers/scanner/05-knip-deptry-dependency-tool.md
---

# TS/JS Subprocess Bridge (ts-morph)

## Outcome

Invoke the TS/JS analyzer subprocess from the Python scanner worker. The subprocess is a versioned Node.js script using `ts-morph` that runs on workspace TS/JS files and emits structured JSON to stdout. The bridge: spawns the process, reads stdout, validates schema, strips stderr secrets, handles timeouts and failures. No raw source escapes — only structural metadata.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/graph/scanner/ts_js_bridge/bridge.py` | Create | `asyncio.create_subprocess_exec` runner, stdout capture, stderr redaction |
| `deepagents/tools/graph/scanner/ts_js_bridge/schema_validator.py` | Create | JSON schema validation for subprocess output |
| `deepagents/tools/graph/scanner/ts_js_bridge/bridge_types.py` | Create | `TsJsBridgeResult` dataclass, `TsJsFinding` dataclass |
| `deepagents/tools/graph/scanner/ts_js_bridge/ts-js-analyzer/cli.ts` | Create | ts-morph TS/JS analyzer CLI entry point (compiled to `dist/tools/ts-js-analyzer/cli.js`) |
| `deepagents/tools/graph/scanner/ts_js_bridge/ts-js-analyzer/package.json` | Create | Pinned `ts-morph` version |
| `deepagents/tools/graph/scanner/ts_js_bridge/ts-js-analyzer/tsconfig.json` | Create | Strict TypeScript config |

## Subprocess Contract

### Invocation

Canonical invocation per `scanner-worker-implementation.md`:

```text
node dist/tools/ts-js-analyzer/cli.js --workspace <workspace> --request <request-json>
```

```python
import json

request_json = json.dumps({
    "schema_version": "1.0",
    "workspace_path": workspace_path,  # Absolute path
    "max_analysis_depth": 3,
    "output_format": "json",
})

proc = await asyncio.create_subprocess_exec(
    NODE_EXECUTABLE,          # From env var TS_JS_NODE_PATH or which('node')
    TS_ANALYZER_SCRIPT_PATH,  # Absolute path to dist/tools/ts-js-analyzer/cli.js
    "--workspace", workspace_path,
    "--request", request_json,
    stdout=asyncio.subprocess.PIPE,
    stderr=asyncio.subprocess.PIPE,
    env=sanitized_env,        # PATH only — no secrets, no API keys
    cwd=None,                 # NOT workspace — prevent accidental execution
)
```

### Subprocess Output Contract (stdout, JSON)

```json
{
  "schema_version": "1.0",
  "analyzer_version": "1.0.0",
  "files_analyzed": 12,
  "files_skipped": 3,
  "findings": [
    {
      "file_path": "src/agents/chat.ts",
      "line_number": 42,
      "finding_type": "AI_PROVIDER_USAGE",
      "rule_id": "ts-openai-chat-completions",
      "import_source": "openai",
      "call_expression": "client.chat.completions.create",
      "kwarg_names": ["model", "messages", "temperature"],
      "analysis_level": "L1",
      "has_dynamic_call": false
    }
  ],
  "unsupported_dynamic_flows": [
    {
      "file_path": "src/dynamic.ts",
      "line_number": 99,
      "reason": "dynamic property access on AI client object"
    }
  ],
  "coverage_limitations": []
}
```

### Stderr Handling

- Stderr captured separately, NEVER merged with stdout.
- Redact before logging: apply `SENSITIVE_KEY_PATTERN` (`password|token|secret|key|nonce|code|hash|credential|auth|api_key`).
- Redact GitHub token pattern: `ghp_[A-Za-z0-9]{36}` → `[REDACTED:GITHUB_TOKEN]`.
- Log first 500 chars of redacted stderr at DEBUG level only.

## TS/JS Analyzer Rules (in analyzer.ts)

| Rule ID | Package | Pattern | Finding Type | Base Confidence |
|---|---|---|---|---|
| `ts-openai-chat-completions` | `openai` | `client.chat.completions.create(`, `openai.chat.completions.create(` | `AI_PROVIDER_USAGE` | 0.90 |
| `ts-openai-embeddings` | `openai` | `client.embeddings.create(` | `AI_PROVIDER_USAGE` | 0.90 |
| `ts-anthropic-messages` | `@anthropic-ai/sdk` | `client.messages.create(` | `AI_PROVIDER_USAGE` | 0.90 |
| `ts-google-genai` | `@google/generative-ai` | `model.generateContent(`, `genAI.getGenerativeModel(` | `AI_PROVIDER_USAGE` | 0.90 |
| `ts-langchain-llm` | `langchain` | `ChatOpenAI(`, `ChatAnthropic(`, `chain.invoke(`, `chain.stream(` | `AI_FRAMEWORK_USAGE` | 0.85 |
| `ts-langchain-prompt` | `langchain` | `ChatPromptTemplate.fromMessages(`, `PromptTemplate.fromTemplate(` | `SYSTEM_PROMPT_DETECTED` | 0.80 |
| `ts-langchain-rag` | `langchain` | `createRetrievalChain(`, `VectorStoreRetriever` | `RAG_USAGE_SIGNAL` | 0.85 |
| `ts-llamaindex-query` | `llamaindex` | `VectorStoreIndex.fromDocuments(`, `index.asQueryEngine(`, `queryEngine.query(` | `RAG_USAGE_SIGNAL` | 0.85 |
| `ts-hf-inference` | `@huggingface/inference` | `new HfInference(`, `hf.textGeneration(`, `hf.questionAnswering(` | `AI_PROVIDER_USAGE` | 0.80 |
| `ts-generic-predict` | `*` | `.predict(`, `.generate(`, `.infer(`, `.classify(` | `AI_PROVIDER_USAGE` | 0.40 |
| `ts-system-prompt-var` | `*` | `systemPrompt`, `SYSTEM_PROMPT`, `SystemMessage` | `SYSTEM_PROMPT_DETECTED` | 0.70 |
| `ts-dynamic-prompt` | `*` | `` `${systemPrompt}` ``, `template.format(` | `DYNAMIC_SYSTEM_PROMPT_REFERENCE` | 0.65 |
| `ts-output-parser` | `langchain` | `JsonOutputParser(`, `PydanticOutputParser(`, `StructuredOutputParser` | `MODEL_OUTPUT_PARSER_SIGNAL` | 0.80 |
| `ts-local-http-inference` | `*` | `localhost:11434`, `/v1/chat/completions`, `ollama.chat(`, `generateText(` | `AI_PROVIDER_USAGE` | 0.75 |

## Bridge Business Rules

1. Run only when JS/TS files present in workspace (`.js`, `.ts`, `.mjs`, `.cjs`, `.jsx`, `.tsx`).
2. Spawn `NODE_EXECUTABLE` from whitelist — never shell=True, never interpolate workspace path into command string.
3. Timeout: 150s. On timeout: `asyncio.create_subprocess_exec` process killed (`proc.kill()`), result = `TS_JS_ANALYZER_FAILED` coverage limitation.
4. Exit code non-zero: record `TS_JS_ANALYZER_FAILED`, continue (non-blocking).
5. Schema validation: parse stdout as JSON, validate `schema_version` field present. Invalid JSON → `TS_JS_ANALYZER_FAILED`.
6. `cwd` of subprocess is NOT workspace — prevent accidental directory traversal.
7. Subprocess `env` contains only `PATH` — no `GITHUB_TOKEN`, no `OPENAI_API_KEY`, no LCSP secrets.
8. `file_path` in findings MUST be relative to workspace root — validate and strip absolute prefix if present.
9. Bridge never logs raw stdout — only schema-validated structured output.

## Error Table

| Error | Severity | Action |
|---|---|---|
| Timeout (>150s) | `ACCEPTED_WITH_LIMITATION` | Kill process, record limitation |
| Non-zero exit | `ACCEPTED_WITH_LIMITATION` | Record limitation, continue |
| JSON parse failure | `ACCEPTED_WITH_LIMITATION` | Record limitation, continue |
| Schema version mismatch | `ACCEPTED_WITH_LIMITATION` | Record limitation, continue |
| Absolute path in finding | — | Strip to relative automatically |
| Secrets in stderr | — | Redact before logging |

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | TS project with `openai` import and `client.chat.completions.create` | Finding `ts-openai-chat-completions`, `AI_PROVIDER_USAGE`, L1 |
| T02 | `@anthropic-ai/sdk` with `client.messages.create` | Finding `ts-anthropic-messages` |
| T03 | `langchain` chain + `ChatPromptTemplate.fromMessages` | `SYSTEM_PROMPT_DETECTED` |
| T04 | Dynamic property access `client[method]()` | `UNSUPPORTED_DYNAMIC_FLOW` |
| T05 | Process timeout | Process killed, `TS_JS_ANALYZER_FAILED` recorded |
| T06 | Invalid JSON stdout | `TS_JS_ANALYZER_FAILED`, continues |
| T07 | `GITHUB_TOKEN` in subprocess env | Assertion error — not allowed |
| T08 | Absolute path in finding `file_path` | Stripped to relative |
| T09 | Secret in stderr | Redacted before logging |
| T10 | No JS/TS files in workspace | Bridge not invoked |

## Definition of Done

- `asyncio.create_subprocess_exec` used — no `shell=True`.
- Subprocess `env` contains `PATH` only.
- 150s timeout enforced with process kill.
- Schema validation on every stdout.
- Stderr redacted before logging.
- All TS/JS AI library patterns in `analyzer.ts` cover OpenAI, Anthropic, Google, Hugging Face, LangChain, LlamaIndex.
- Bridge failure is non-blocking (`ACCEPTED_WITH_LIMITATION`).

## Implementation Evidence

- Added `TsJsBridge` async subprocess runner using `asyncio.create_subprocess_exec` with no shell interpolation.
- Bridge invokes the canonical Node analyzer command shape with `--workspace` and versioned `--request` JSON.
- Bridge runs only when routed JS/TS files are present, and skips safely when no `.js`, `.ts`, `.mjs`, `.cjs`, `.jsx`, or `.tsx` files exist.
- Bridge passes a sanitized subprocess environment containing only `PATH`; explicit env safety assertions reject secret-bearing keys.
- Bridge enforces a 150s default timeout, kills the process on timeout, and records `TS_JS_ANALYZER_FAILED` as a non-blocking coverage limitation.
- Bridge captures stdout/stderr separately, never logs raw stdout, and redacts stderr before debug logging/result messages.
- Added schema validation for analyzer stdout and normalization of absolute `file_path` values to workspace-relative paths.
- Integrated TS/JS analysis into `ScanConsumer`, tool provenance, coverage notes, and evidence payload as `ts_js_analysis`.
- Added nested TypeScript analyzer package with pinned `ts-morph@26.0.0`, strict `tsconfig.json`, `cli.ts`, and rule-backed `analyzer.ts`.
- Added test coverage for T01-T10 plus worker-level invocation and evidence assembler provenance.

## File List

- `deepagents/tools/graph/scanner/evidence_assembler.py`
- `deepagents/tools/graph/scanner/scan_consumer.py`
- `deepagents/tools/graph/scanner/ts_js_bridge/__init__.py`
- `deepagents/tools/graph/scanner/ts_js_bridge/bridge.py`
- `deepagents/tools/graph/scanner/ts_js_bridge/bridge_types.py`
- `deepagents/tools/graph/scanner/ts_js_bridge/schema_validator.py`
- `deepagents/tools/graph/scanner/ts_js_bridge/ts-js-analyzer/analyzer.ts`
- `deepagents/tools/graph/scanner/ts_js_bridge/ts-js-analyzer/cli.ts`
- `deepagents/tools/graph/scanner/ts_js_bridge/ts-js-analyzer/package.json`
- `deepagents/tools/graph/scanner/ts_js_bridge/ts-js-analyzer/tsconfig.json`
- `deepagents/tests/test_evidence_assembler.py`
- `deepagents/tests/test_scanner_workspace.py`
- `deepagents/tests/test_ts_js_bridge.py`

## Validation

- `./.venv/bin/pytest tests/test_ts_js_bridge.py`
  - Result: passed, 11 tests.
- `./.venv/bin/pytest tests/test_ts_js_bridge.py tests/test_evidence_assembler.py tests/test_scanner_workspace.py`
  - Result: passed, 31 tests.
- `./.venv/bin/pytest tests/test_worker_health.py`
  - Result: passed, 5 tests, run outside filesystem sandbox because tests bind a local HTTP socket.
- `pnpm run lint`
  - Result: passed.
- `./.venv/bin/python -m compileall src tests`
  - Result: passed.
- `pnpm --dir deepagents/tools/graph/scanner/ts_js_bridge/ts-js-analyzer exec tsc -p tsconfig.json`
  - Result: blocked by local dependency install state: nested package pins `ts-morph@26.0.0`, but `ts-morph` is not installed/resolvable from that package directory.
- `./.venv/bin/pytest`
  - Result: blocked by local venv dependency state: `tiktoken` missing during `tests/test_llm_gateway.py` collection.
- Non-LLM explicit Python suite run
  - Result: 151 passed / 8 skipped; remaining environment blockers were missing `boto3` for audit export consumer and sandboxed health socket binding. Health socket tests passed when rerun outside sandbox.
