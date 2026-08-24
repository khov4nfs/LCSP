---
task_id: MW-scan-py-006
module: python-workers/scanner
runtime: deepagents
priority: P0
status: DONE
epic_story: 3.5
depends_on:
  - python-workers/scanner/01-scanner-workspace-setup.md
  - python-workers/scanner/05-knip-deptry-dependency-tool.md
---

# Python AST/CST Analyzer (Bounded L0–L3)

## Outcome

Analyze Python source files in the scanner workspace using stdlib `ast` and `libcst` to extract structured signals about AI library usage, model invocations, prompt patterns, input/output flows, and human-review steps. Obeys analysis-level boundaries L0–L3. Emits `UNSUPPORTED_DYNAMIC_FLOW` at L4 boundary. Never retains raw source — all output is structural metadata only.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/graph/scanner/parsers/python_ast_parser.py` | Create | stdlib `ast` module parser: imports, function defs, call graph |
| `deepagents/tools/graph/scanner/parsers/python_cst_parser.py` | Create | `libcst` CST parser: precise API pattern detection (argument names, kwargs, chained calls) |
| `deepagents/tools/graph/scanner/analyzers/python_analyzer.py` | Create | Orchestrate AST + CST → produce `PythonAnalysisResult` |
| `deepagents/tools/graph/scanner/analyzers/ai_pattern_rules.py` | Create | All AI library pattern rules (AI_RULE_TABLE) |
| `deepagents/tools/graph/scanner/analyzers/level_guard.py` | Create | L0–L3 boundary enforcement; emits UNSUPPORTED_DYNAMIC_FLOW at L4 |

## Analysis Levels Enforced

| Level | Scope | Allowed |
|---|---|---|
| L0 | Repository inventory | File list, language breakdown, manifest analysis |
| L1 | Single function | Import detection, direct call detection |
| L2 | Same module | Call graph within one `.py` file |
| L3 | Controlled cross-module | Direct import chains between files, no dynamic dispatch |
| L4 | Dynamic/unsupported | Emits `UNSUPPORTED_DYNAMIC_FLOW` — never guesses |

## Output Schema

```python
@dataclass
class AiCallSite:
    file_path: str               # Relative path only
    line_number: int
    function_name: str           # Called function name (e.g. 'create', 'generate_content')
    module_alias: str            # Import alias used (e.g. 'openai', 'client')
    matched_rule_id: str         # Rule from AI_RULE_TABLE
    finding_type: str            # One of 20 canonical finding types
    analysis_level: str          # 'L0' | 'L1' | 'L2' | 'L3'
    call_args_schema: list[str]  # Argument NAMES only — no values, no content
    has_dynamic_call: bool       # True → emit UNSUPPORTED_DYNAMIC_FLOW
    kwarg_names: list[str]       # kwarg NAMES only (e.g. ['model', 'messages', 'temperature'])

@dataclass
class PythonAnalysisResult:
    files_analyzed: int
    files_skipped: int
    ai_call_sites: list[AiCallSite]
    import_map: dict[str, str]   # {alias: package} — package names only, no versions
    unsupported_dynamic_flows: list[dict]   # {file, line, reason}
    coverage_limitation: bool    # True if any file exceeded size or parsing failed
```

## AI Library Pattern Rules (AI_RULE_TABLE)

Each rule: `{rule_id, package, pattern, finding_type, base_confidence}`.

```python
AI_RULE_TABLE = [
    # OpenAI
    {"rule_id": "py-openai-chat-completions", "package": "openai",
     "pattern": ["ChatCompletion.create", "client.chat.completions.create", "openai.chat.completions.create"],
     "finding_type": "AI_PROVIDER_USAGE", "base_confidence": 0.90},
    {"rule_id": "py-openai-embeddings", "package": "openai",
     "pattern": ["Embedding.create", "client.embeddings.create"],
     "finding_type": "AI_PROVIDER_USAGE", "base_confidence": 0.90},
    {"rule_id": "py-openai-responses", "package": "openai",
     "pattern": ["client.responses.create"],
     "finding_type": "AI_PROVIDER_USAGE", "base_confidence": 0.90},
    {"rule_id": "py-openai-model-kwarg", "package": "openai",
     "pattern": ["model="],
     "finding_type": "AI_MODEL_INVOCATION", "base_confidence": 0.75},

    # Anthropic
    {"rule_id": "py-anthropic-messages", "package": "anthropic",
     "pattern": ["client.messages.create", "anthropic.Anthropic().messages.create"],
     "finding_type": "AI_PROVIDER_USAGE", "base_confidence": 0.90},
    {"rule_id": "py-anthropic-model-kwarg", "package": "anthropic",
     "pattern": ["model=claude"],
     "finding_type": "AI_MODEL_INVOCATION", "base_confidence": 0.85},

    # Google Generative AI / Vertex AI
    {"rule_id": "py-google-genai-generate", "package": "google.generativeai",
     "pattern": ["model.generate_content", "GenerativeModel", "genai.GenerativeModel"],
     "finding_type": "AI_PROVIDER_USAGE", "base_confidence": 0.90},
    {"rule_id": "py-vertexai-predict", "package": "vertexai",
     "pattern": ["model.predict", "endpoint.predict", "vertexai.preview"],
     "finding_type": "AI_PROVIDER_USAGE", "base_confidence": 0.85},

    # Hugging Face
    {"rule_id": "py-hf-pipeline", "package": "transformers",
     "pattern": ["pipeline(", "AutoModelFor", "AutoTokenizer", "Trainer("],
     "finding_type": "AI_FRAMEWORK_USAGE", "base_confidence": 0.80},
    {"rule_id": "py-hf-inference", "package": "huggingface_hub",
     "pattern": ["InferenceClient", "HfApi", "inference_api"],
     "finding_type": "AI_PROVIDER_USAGE", "base_confidence": 0.80},

    # LangChain
    {"rule_id": "py-langchain-llm", "package": "langchain",
     "pattern": ["ChatOpenAI", "ChatAnthropic", "ChatGoogleGenerativeAI", "LLMChain", "LCEL",
                 "chain.invoke", "chain.run", "chain.stream"],
     "finding_type": "AI_FRAMEWORK_USAGE", "base_confidence": 0.85},
    {"rule_id": "py-langchain-agent", "package": "langchain",
     "pattern": ["AgentExecutor", "create_react_agent", "create_openai_functions_agent",
                 "agent.run", "agent.invoke"],
     "finding_type": "AI_DECISION_FLOW_SIGNAL", "base_confidence": 0.75},
    {"rule_id": "py-langchain-prompt", "package": "langchain",
     "pattern": ["PromptTemplate", "ChatPromptTemplate", "SystemMessagePromptTemplate",
                 "HumanMessagePromptTemplate"],
     "finding_type": "SYSTEM_PROMPT_DETECTED", "base_confidence": 0.80},
    {"rule_id": "py-langchain-rag", "package": "langchain",
     "pattern": ["VectorStoreRetriever", "RetrievalQA", "RAGChain", "retriever.invoke"],
     "finding_type": "RAG_USAGE_SIGNAL", "base_confidence": 0.85},
    {"rule_id": "py-langchain-output-parser", "package": "langchain",
     "pattern": ["PydanticOutputParser", "JsonOutputParser", "StrOutputParser",
                 "CommaSeparatedListOutputParser"],
     "finding_type": "MODEL_OUTPUT_PARSER_SIGNAL", "base_confidence": 0.80},

    # LlamaIndex
    {"rule_id": "py-llamaindex-query", "package": "llama_index",
     "pattern": ["QueryEngine", "VectorStoreIndex", "index.as_query_engine", "query_engine.query"],
     "finding_type": "RAG_USAGE_SIGNAL", "base_confidence": 0.85},
    {"rule_id": "py-llamaindex-llm", "package": "llama_index",
     "pattern": ["OpenAI(", "Anthropic(", "llm.complete", "llm.chat", "llm.stream_chat"],
     "finding_type": "AI_PROVIDER_USAGE", "base_confidence": 0.80},

    # scikit-learn
    {"rule_id": "py-sklearn-predict", "package": "sklearn",
     "pattern": ["model.predict(", "clf.predict(", "estimator.predict("],
     "finding_type": "AI_PROVIDER_USAGE", "base_confidence": 0.65},
    {"rule_id": "py-sklearn-decision", "package": "sklearn",
     "pattern": ["model.predict_proba(", "model.decision_function("],
     "finding_type": "AUTOMATED_DECISION_SIGNAL", "base_confidence": 0.60},

    # TensorFlow / Keras
    {"rule_id": "py-tf-predict", "package": "tensorflow",
     "pattern": ["model.predict(", "model(inputs", "model.call("],
     "finding_type": "AI_PROVIDER_USAGE", "base_confidence": 0.70},
    {"rule_id": "py-keras-model", "package": "keras",
     "pattern": ["Sequential(", "Model(", "model.fit(", "model.predict("],
     "finding_type": "AI_FRAMEWORK_USAGE", "base_confidence": 0.70},

    # PyTorch
    {"rule_id": "py-torch-forward", "package": "torch",
     "pattern": ["model(input", "model.forward(", "with torch.no_grad():"],
     "finding_type": "AI_PROVIDER_USAGE", "base_confidence": 0.65},

    # Local HTTP Inference Endpoints
    {"rule_id": "py-local-http-inference", "package": "requests",
     "pattern": ["http://localhost:11434", "http://localhost:8080/v1", "/v1/chat/completions",
                 "/api/generate", "ollama", "vllm", "llama.cpp"],
     "finding_type": "AI_PROVIDER_USAGE", "base_confidence": 0.75},

    # Generic patterns (lower confidence)
    {"rule_id": "py-generic-predict", "package": "*",
     "pattern": [".predict(", ".generate(", ".infer(", ".classify(", ".score("],
     "finding_type": "AI_PROVIDER_USAGE", "base_confidence": 0.40},

    # System prompt patterns
    {"rule_id": "py-system-prompt-variable", "package": "*",
     "pattern": ["system_prompt", "SYSTEM_PROMPT", "system_message", "SystemMessage"],
     "finding_type": "SYSTEM_PROMPT_DETECTED", "base_confidence": 0.70},
    {"rule_id": "py-dynamic-prompt-ref", "package": "*",
     "pattern": ["f\"{system", "format_map(", "Template(", ".render("],
     "finding_type": "DYNAMIC_SYSTEM_PROMPT_REFERENCE", "base_confidence": 0.65},

    # Sensitive data
    {"rule_id": "py-pii-param", "package": "*",
     "pattern": ["user_data=", "personal_data=", "pii=", "ssn=", "dob="],
     "finding_type": "SENSITIVE_DATA_SIGNAL", "base_confidence": 0.55},
]
```

## Business Rules

1. Never read file content into Python strings longer than 50 KB — skip and record `coverage_limitation`.
2. Run `ast.parse()` on each `.py` file. On `SyntaxError` → skip file, record `coverage_limitation`.
3. For each import detected: map alias → package name using import visitor.
4. Match call sites against `AI_RULE_TABLE` by package + pattern substring.
5. Extract argument NAMES only — never extract argument values (content, prompts, keys).
6. Level guard: if call site uses `getattr(obj, method_name)`, `**kwargs` forwarding, or dynamic dispatch → `has_dynamic_call = True` → emit `UNSUPPORTED_DYNAMIC_FLOW`.
7. L2 scope: trace call graph within same `.py` module only.
8. L3 scope: follow direct `from x import y` chains to one additional file — stop there.
9. Never recurse into `venv/`, `.tox/`, `node_modules/`, `__pycache__/`, `dist/`, `build/`.
10. CST pass (libcst): run only on files where AST pass found AI call sites — extract kwarg names for model/prompt/temperature patterns.
11. `call_args_schema` contains argument NAMES only (position 0, position 1, etc.), never values.

## Error / Skip Rules

| Condition | Action |
|---|---|
| File > 50 KB | Skip, `coverage_limitation = True` |
| `SyntaxError` | Skip, `coverage_limitation = True` |
| libcst parse failure | Continue with AST result only |
| Dynamic dispatch detected | Emit `UNSUPPORTED_DYNAMIC_FLOW` |

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | `import openai; client.chat.completions.create(model=..., messages=...)` | `AI_PROVIDER_USAGE`, rule `py-openai-chat-completions`, level L1 |
| T02 | `from langchain.prompts import ChatPromptTemplate; ChatPromptTemplate.from_template(...)` | `SYSTEM_PROMPT_DETECTED`, rule `py-langchain-prompt` |
| T03 | `getattr(model, method)()` | `has_dynamic_call=True`, `UNSUPPORTED_DYNAMIC_FLOW` emitted |
| T04 | `f"system: {SYSTEM_PROMPT}"` | `DYNAMIC_SYSTEM_PROMPT_REFERENCE` |
| T05 | File 200 KB | Skipped, `coverage_limitation=True` |
| T06 | `call_args_schema` | Contains argument names only, no values |
| T07 | `venv/` folder | Never traversed |
| T08 | L3 cross-file | Follow one direct import chain, stop |
| T09 | `model.predict(X)` (sklearn) | `AI_PROVIDER_USAGE`, base_confidence 0.65 |
| T10 | `index.as_query_engine().query(question)` | `RAG_USAGE_SIGNAL` |

## Definition of Done

- All AI library groups in `AI_RULE_TABLE` (OpenAI, Anthropic, Google, Hugging Face, LangChain, LlamaIndex, sklearn, TF/Keras, PyTorch, local HTTP, generic).
- L0–L3 boundary enforced; L4 emits `UNSUPPORTED_DYNAMIC_FLOW`.
- No argument values extracted — names only.
- No raw source content in `PythonAnalysisResult`.
- `venv/`, `node_modules/`, `__pycache__` excluded.

## Implementation Evidence

- Added bounded parser/analyzer modules: `parsers/python_ast_parser.py`, `parsers/python_cst_parser.py`, `analyzers/python_analyzer.py`, `analyzers/ai_pattern_rules.py`, and `analyzers/level_guard.py`.
- Added compatibility wrapper `analyzers/python_ast.py` for existing scanner analyzer tests.
- Implemented metadata-only `AiCallSite`, `PythonAnalysisResult`, and compatibility `TechnicalFinding` projection; no raw source or argument values are retained.
- Implemented AI rule matching for OpenAI, Anthropic, Google/Vertex, Hugging Face, LangChain, LlamaIndex, sklearn, TensorFlow/Keras, PyTorch, local HTTP inference, generic predict/generate patterns, prompt references, and sensitive parameter names.
- Enforced bounded behavior: 50 KB file cap, syntax-error skip, excluded runtime/build/cache directories, dynamic dispatch/`**kwargs` as `UNSUPPORTED_DYNAMIC_FLOW`, L1 direct calls, same-module parsing, and one-hop direct-import L3 propagation.
- Wired `ScanConsumer` to run the Python analyzer and include `python_analysis` in `TechnicalEvidenceReport` callback evidence payload.
- Validation: Python compile checks passed for changed analyzer/parser/evidence/consumer files and tests. Targeted pytest passed: `test_scanner_analyzer.py`, `test_evidence_assembler.py`, `test_scanner_workspace.py` — 30 passed, 1 skipped, 1 warning. Full `deepagents/tests` collection is blocked in the temporary Python 3.14 validation environment by missing `tiktoken`; installing full worker deps remains blocked because `tiktoken==0.8.0` has no compatible wheel here and requires a Rust compiler.
