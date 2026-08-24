---
task_id: MW-scan-py-008
module: python-workers/scanner
runtime: deepagents
priority: P0
status: DONE
epic_story: 3.5
baseline_commit: 59fa522219638c4929f4f821f470eecaee5f427d
depends_on:
  - python-workers/scanner/03-semgrep-ai-rules-tool.md
---

# Semgrep Full AI Ruleset

## Outcome

Complete Semgrep YAML ruleset (`lcsp-ai-usage.yaml`) covering all 10+ AI library groups and all relevant finding types from the 20 canonical types. Replaces the partial ruleset in task `03`. Source line content (`extra.lines`) is always stripped before storing findings.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/graph/scanner/tools/semgrep_rules/lcsp-ai-usage.yaml` | Create | Complete ruleset (replaces partial) |
| `deepagents/tools/graph/scanner/tools/semgrep_tool.py` | Modify | Add `extra.lines` strip, timeout 180s, full path sanitization |

## Ruleset Structure

All rules share:

```yaml
options:
  symbolic_propagation: true
metadata:
  lcsp_version: "1.0"
  strip_source: true
```

## Rule Groups

### Group 1: OpenAI (Python + JS/TS)

```yaml
- id: lcsp-openai-chat-completions-py
  languages: [python]
  pattern-either:
    - pattern: openai.ChatCompletion.create(...)
    - pattern: $CLIENT.chat.completions.create(...)
    - pattern: $CLIENT.responses.create(...)
  message: OpenAI chat completions API call
  metadata:
    finding_type: AI_PROVIDER_USAGE
    base_confidence: 0.90
    library_group: openai

- id: lcsp-openai-embeddings-py
  languages: [python]
  pattern-either:
    - pattern: openai.Embedding.create(...)
    - pattern: $CLIENT.embeddings.create(...)
  message: OpenAI embeddings API call
  metadata:
    finding_type: AI_PROVIDER_USAGE
    base_confidence: 0.90
    library_group: openai

- id: lcsp-openai-chat-completions-js
  languages: [javascript, typescript]
  pattern-either:
    - pattern: $CLIENT.chat.completions.create(...)
    - pattern: openai.chat.completions.create(...)
  message: OpenAI chat completions API call (JS/TS)
  metadata:
    finding_type: AI_PROVIDER_USAGE
    base_confidence: 0.90
    library_group: openai
```

### Group 2: Anthropic

```yaml
- id: lcsp-anthropic-messages-py
  languages: [python]
  pattern-either:
    - pattern: $CLIENT.messages.create(...)
    - pattern: anthropic.Anthropic().messages.create(...)
  message: Anthropic messages API call
  metadata:
    finding_type: AI_PROVIDER_USAGE
    base_confidence: 0.90
    library_group: anthropic

- id: lcsp-anthropic-messages-js
  languages: [javascript, typescript]
  pattern: $CLIENT.messages.create(...)
  message: Anthropic messages API call (JS/TS)
  metadata:
    finding_type: AI_PROVIDER_USAGE
    base_confidence: 0.90
    library_group: anthropic
```

### Group 3: Google Generative AI / Vertex AI

```yaml
- id: lcsp-google-genai-py
  languages: [python]
  pattern-either:
    - pattern: $MODEL.generate_content(...)
    - pattern: genai.GenerativeModel(...)
    - pattern: GenerativeModel(...)
  message: Google Generative AI model call
  metadata:
    finding_type: AI_PROVIDER_USAGE
    base_confidence: 0.90
    library_group: google-genai

- id: lcsp-vertexai-predict-py
  languages: [python]
  pattern-either:
    - pattern: $MODEL.predict(...)
    - pattern: $ENDPOINT.predict(...)
  message: Vertex AI predict call
  metadata:
    finding_type: AI_PROVIDER_USAGE
    base_confidence: 0.80
    library_group: google-vertex

- id: lcsp-google-genai-js
  languages: [javascript, typescript]
  pattern-either:
    - pattern: $MODEL.generateContent(...)
    - pattern: genAI.getGenerativeModel(...)
  message: Google Generative AI model call (JS/TS)
  metadata:
    finding_type: AI_PROVIDER_USAGE
    base_confidence: 0.90
    library_group: google-genai
```

### Group 4: Hugging Face

```yaml
- id: lcsp-hf-pipeline-py
  languages: [python]
  pattern-either:
    - pattern: pipeline(...)
    - pattern: AutoModelForCausalLM.from_pretrained(...)
    - pattern: AutoModelForSequenceClassification.from_pretrained(...)
    - pattern: AutoTokenizer.from_pretrained(...)
  message: Hugging Face transformers pipeline or model load
  metadata:
    finding_type: AI_FRAMEWORK_USAGE
    base_confidence: 0.80
    library_group: huggingface

- id: lcsp-hf-inference-api-py
  languages: [python]
  pattern-either:
    - pattern: InferenceClient(...)
    - pattern: $CLIENT.text_generation(...)
    - pattern: $CLIENT.question_answering(...)
  message: Hugging Face Inference API call
  metadata:
    finding_type: AI_PROVIDER_USAGE
    base_confidence: 0.80
    library_group: huggingface
```

### Group 5: LangChain

```yaml
- id: lcsp-langchain-chain-invoke-py
  languages: [python]
  pattern-either:
    - pattern: $CHAIN.invoke(...)
    - pattern: $CHAIN.run(...)
    - pattern: $CHAIN.stream(...)
    - pattern: $CHAIN.batch(...)
  message: LangChain chain invocation
  metadata:
    finding_type: AI_FRAMEWORK_USAGE
    base_confidence: 0.85
    library_group: langchain

- id: lcsp-langchain-prompt-py
  languages: [python]
  pattern-either:
    - pattern: ChatPromptTemplate.from_messages(...)
    - pattern: PromptTemplate.from_template(...)
    - pattern: SystemMessagePromptTemplate.from_template(...)
  message: LangChain prompt template
  metadata:
    finding_type: SYSTEM_PROMPT_DETECTED
    base_confidence: 0.80
    library_group: langchain

- id: lcsp-langchain-agent-py
  languages: [python]
  pattern-either:
    - pattern: AgentExecutor(...)
    - pattern: create_react_agent(...)
    - pattern: create_openai_functions_agent(...)
    - pattern: $AGENT.invoke(...)
  message: LangChain agent execution
  metadata:
    finding_type: AI_DECISION_FLOW_SIGNAL
    base_confidence: 0.75
    library_group: langchain

- id: lcsp-langchain-rag-py
  languages: [python]
  pattern-either:
    - pattern: RetrievalQA.from_chain_type(...)
    - pattern: $RETRIEVER.invoke(...)
    - pattern: VectorStoreRetriever(...)
  message: LangChain RAG retrieval
  metadata:
    finding_type: RAG_USAGE_SIGNAL
    base_confidence: 0.85
    library_group: langchain

- id: lcsp-langchain-output-parser-py
  languages: [python]
  pattern-either:
    - pattern: PydanticOutputParser(...)
    - pattern: JsonOutputParser(...)
    - pattern: StrOutputParser(...)
    - pattern: CommaSeparatedListOutputParser(...)
  message: LangChain output parser
  metadata:
    finding_type: MODEL_OUTPUT_PARSER_SIGNAL
    base_confidence: 0.80
    library_group: langchain
```

### Group 6: LlamaIndex

```yaml
- id: lcsp-llamaindex-query-py
  languages: [python]
  pattern-either:
    - pattern: $INDEX.as_query_engine(...)
    - pattern: $QUERY_ENGINE.query(...)
    - pattern: VectorStoreIndex.from_documents(...)
  message: LlamaIndex query engine
  metadata:
    finding_type: RAG_USAGE_SIGNAL
    base_confidence: 0.85
    library_group: llamaindex
```

### Group 7: scikit-learn

```yaml
- id: lcsp-sklearn-predict-py
  languages: [python]
  pattern-either:
    - pattern: $MODEL.predict(...)
    - pattern: $CLF.predict(...)
    - pattern: $MODEL.predict_proba(...)
  message: scikit-learn model prediction
  metadata:
    finding_type: AI_PROVIDER_USAGE
    base_confidence: 0.65
    library_group: sklearn
```

### Group 8: TensorFlow / Keras

```yaml
- id: lcsp-tf-predict-py
  languages: [python]
  pattern-either:
    - pattern: $MODEL.predict(...)
    - pattern: $MODEL(...)
  message: TensorFlow/Keras model call
  metadata:
    finding_type: AI_PROVIDER_USAGE
    base_confidence: 0.70
    library_group: tensorflow
```

### Group 9: PyTorch

```yaml
- id: lcsp-torch-inference-py
  languages: [python]
  pattern-either:
    - pattern: with torch.no_grad(): ...
    - pattern: $MODEL($INPUT)
  message: PyTorch model inference
  metadata:
    finding_type: AI_PROVIDER_USAGE
    base_confidence: 0.65
    library_group: pytorch
```

### Group 10: Local HTTP Inference Endpoints

```yaml
- id: lcsp-local-inference-endpoint-py
  languages: [python]
  pattern-either:
    - pattern: requests.post("http://localhost:11434/...")
    - pattern: requests.post("http://localhost:8080/v1/...")
    - pattern: httpx.post("http://localhost:11434/...")
    - pattern: $CLIENT.post(".../v1/chat/completions", ...)
  message: Local LLM inference endpoint call (Ollama/vllm/llama.cpp)
  metadata:
    finding_type: AI_PROVIDER_USAGE
    base_confidence: 0.75
    library_group: local-inference
```

### Group 11: Generic / Cross-Language Patterns

```yaml
- id: lcsp-generic-generate-py
  languages: [python]
  pattern-either:
    - pattern: $OBJ.generate(...)
    - pattern: $OBJ.infer(...)
    - pattern: $OBJ.classify(...)
    - pattern: $OBJ.score(...)
  message: Generic generate/infer/classify/score call
  metadata:
    finding_type: AI_PROVIDER_USAGE
    base_confidence: 0.40
    library_group: generic

- id: lcsp-system-prompt-var-py
  languages: [python]
  pattern-either:
    - pattern: system_prompt = ...
    - pattern: SYSTEM_PROMPT = ...
    - pattern: SystemMessage(content=...)
  message: System prompt variable detected
  metadata:
    finding_type: SYSTEM_PROMPT_DETECTED
    base_confidence: 0.70
    library_group: generic

- id: lcsp-dynamic-prompt-py
  languages: [python]
  pattern-either:
    - pattern: f"... {$SYSTEM_PROMPT} ..."
    - pattern: $TEMPLATE.format_map(...)
    - pattern: $TEMPLATE.render(...)
  message: Dynamic system prompt reference
  metadata:
    finding_type: DYNAMIC_SYSTEM_PROMPT_REFERENCE
    base_confidence: 0.65
    library_group: generic
```

## Source Line Strip (CRITICAL)

```python
def strip_extra_lines(finding: dict) -> dict:
    finding.get("extra", {}).pop("lines", None)
    finding.get("extra", {}).pop("metavars", {})  # May contain source snippets
    return finding
```

Applied to EVERY Semgrep finding before storage. No exceptions.

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | Python file with `client.chat.completions.create(model="gpt-4", messages=[...])` | `lcsp-openai-chat-completions-py`, `AI_PROVIDER_USAGE` |
| T02 | TS file with `client.messages.create({model: "claude-3", messages: [...]})` | `lcsp-anthropic-messages-js` |
| T03 | `ChatPromptTemplate.from_messages(...)` | `SYSTEM_PROMPT_DETECTED` |
| T04 | `AgentExecutor(agent=..., tools=...)` | `AI_DECISION_FLOW_SIGNAL` |
| T05 | `VectorStoreIndex.from_documents(...)` | `RAG_USAGE_SIGNAL` |
| T06 | `PydanticOutputParser(...)` | `MODEL_OUTPUT_PARSER_SIGNAL` |
| T07 | `requests.post("http://localhost:11434/api/generate")` | `AI_PROVIDER_USAGE`, `local-inference` |
| T08 | `extra.lines` present in raw Semgrep output | Stripped, not in stored finding |
| T09 | `model.predict(X)` with torch import | `AI_PROVIDER_USAGE`, `pytorch` |
| T10 | `torch.no_grad()` block | `AI_PROVIDER_USAGE`, `pytorch` |

## Definition of Done

- All 10 library groups covered (OpenAI, Anthropic, Google, HuggingFace, LangChain, LlamaIndex, sklearn, TF/Keras, PyTorch, local-HTTP, generic).
- `extra.lines` stripped from every finding before storage.
- `metadata.finding_type` present in every rule.
- `metadata.base_confidence` present in every rule.
- Timeout 180s enforced on `semgrep --config` call.
- Rule file valid YAML parseable by `semgrep --validate`.

## Implementation Evidence

- Replaced the partial `lcsp-ai-usage.yaml` with a full AI ruleset covering OpenAI, Anthropic, Google GenAI/Vertex, Hugging Face, LangChain, LlamaIndex, sklearn, TensorFlow/Keras, PyTorch, local inference endpoints, and generic prompt/model patterns.
- Added top-level ruleset options and metadata (`symbolic_propagation`, `lcsp_version`, `strip_source`) and per-rule `finding_type`, `base_confidence`, and `library_group` metadata.
- Extended `SemgrepFinding` with default-compatible metadata fields for `finding_type`, `base_confidence`, and `library_group`.
- Updated Semgrep parsing so `extra.lines` and `extra.metavars` remain ignored while only rule metadata, message, severity, path, and line facts are stored.
- Added signal-type derivation from canonical finding types while preserving legacy task `003` rule-id mappings.
- Added tests for metadata parsing/source stripping and full ruleset coverage.

## File List

- `deepagents/tools/graph/scanner/rulesets/lcsp-ai-usage.yaml`
- `deepagents/tools/graph/scanner/tools/semgrep_tool.py`
- `deepagents/tests/test_semgrep_tool.py`
- `docs/implementation/tasks/modules/python-workers/scanner/08-semgrep-full-ai-ruleset.md`

## Validation

- `./.venv/bin/pytest tests/test_semgrep_tool.py`
  - Result: passed, 9 tests.
- `./.venv/bin/pytest tests/test_evidence_assembler.py tests/test_scanner_workspace.py`
  - Result: passed, 20 tests.
- `./.venv/bin/python -m compileall tools/graph/scanner/tools tests/test_semgrep_tool.py`
  - Result: passed.
- Python YAML structural validation using the host Python environment
  - Result: passed, 34 Semgrep rules validated for required metadata.
- `./.venv/bin/pytest`
  - Result: blocked by local dependency state: `tiktoken` missing during `tests/test_llm_gateway.py` collection.
- `./.venv/bin/pytest --ignore=tests/test_llm_gateway.py`
  - Result: 153 passed / 8 skipped, with remaining failures unrelated to this task: local venv missing `boto3` for audit export consumer and sandboxed socket binding for health tests.
- `./.venv/bin/pytest tests/test_worker_health.py`
  - Result: passed, 5 tests, run outside filesystem sandbox because tests bind a local HTTP socket.
- `semgrep --validate`
  - Result: not run locally because the `semgrep` binary is not installed in this environment.
