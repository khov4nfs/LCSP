---
task_id: MW-scan-py-009
module: python-workers/scanner
runtime: deepagents
priority: P0
status: DONE
epic_story: 3.5
depends_on:
  - python-workers/scanner/05-knip-deptry-dependency-tool.md
  - python-workers/scanner/06-python-ast-cst-analyzer.md
  - python-workers/scanner/07-ts-js-subprocess-bridge.md
  - python-workers/scanner/08-semgrep-full-ai-ruleset.md
---

# AI Invocation Detector (Signal Fusion + 20 Finding Types + Confidence)

## Outcome

Fuse signals from all prior tool stages (SBOM, Knip/deptry, Python AST/CST, TS/JS bridge, Semgrep) into `TechnicalFinding` records covering all 20 canonical finding types. Apply the confidence formula from `scanner-spec.md`. Detect and emit `UNSUPPORTED_DYNAMIC_FLOW` at L4 boundaries. Produce a deduplicated, confidence-ranked finding list for the evidence report.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/graph/scanner/analyzers/signal_fuser.py` | Create | Merge signals from all tools into finding candidates |
| `deepagents/tools/graph/scanner/analyzers/confidence_calculator.py` | Create | Confidence formula per scanner-spec.md |
| `deepagents/tools/graph/scanner/analyzers/finding_deduplicator.py` | Create | Dedup by file+line+rule_id; merge corroborating signals |
| `deepagents/tools/graph/scanner/analyzers/ai_invocation_detector.py` | Create | Orchestrate fuser → dedup → confidence → `TechnicalFinding` list |
| `deepagents/tools/graph/scanner/analyzers/finding_types.py` | Create | 20 canonical finding type constants + base confidence table |

## 20 Canonical Finding Types

Base values from `scanner-spec.md` Confidence Model (representative bases table):

```python
FINDING_TYPES = {
    # Provider/framework presence: 0.35
    "AI_PROVIDER_USAGE": {"base_confidence": 0.35},
    "AI_FRAMEWORK_USAGE": {"base_confidence": 0.35},
    # Model invocation: 0.70
    "AI_MODEL_INVOCATION": {"base_confidence": 0.70},
    # Input/output signal: 0.55
    "AI_INPUT_SIGNAL": {"base_confidence": 0.55},
    "AI_OUTPUT_SIGNAL": {"base_confidence": 0.55},
    # Decision-flow signal: 0.65
    "AI_DECISION_FLOW_SIGNAL": {"base_confidence": 0.65},
    # Automated decision: 0.75
    "AUTOMATED_DECISION_SIGNAL": {"base_confidence": 0.75},
    # Human review: 0.70
    "HUMAN_REVIEW_SIGNAL": {"base_confidence": 0.70},
    # Ranking/recommendation: 0.60
    "RANKING_SIGNAL": {"base_confidence": 0.60},
    "RECOMMENDATION_SIGNAL": {"base_confidence": 0.60},
    # Status update: 0.65
    "STATUS_UPDATE_SIGNAL": {"base_confidence": 0.65},
    # User impact/sensitive data: 0.60
    "USER_IMPACT_SIGNAL": {"base_confidence": 0.60},
    "SENSITIVE_DATA_SIGNAL": {"base_confidence": 0.60},
    # Domain context: 0.50
    "DOMAIN_CONTEXT_SIGNAL": {"base_confidence": 0.50},
    # Harm potential: 0.55
    "HARM_POTENTIAL_SIGNAL": {"base_confidence": 0.55},
    # Prompt (not in spec table — use closest analogues)
    "SYSTEM_PROMPT_DETECTED": {"base_confidence": 0.70},
    "DYNAMIC_SYSTEM_PROMPT_REFERENCE": {"base_confidence": 0.65},
    # RAG / output parsing
    "RAG_USAGE_SIGNAL": {"base_confidence": 0.65},
    "MODEL_OUTPUT_PARSER_SIGNAL": {"base_confidence": 0.65},
    # Display-only sink: positive evidence AI output terminates in a read-only sink
    "DISPLAY_ONLY_SIGNAL": {"base_confidence": 0.55},
    # Limitations: 1.00 as certainty of limitation, not business claim
    "SCAN_COVERAGE_LIMITATION": {"base_confidence": 1.00},
    "UNSUPPORTED_DYNAMIC_FLOW": {"base_confidence": 1.00},
}
```

## Output Schema

```python
@dataclass
class TechnicalFinding:
    finding_id: str              # UUID generated at detection time
    finding_type: str            # One of 20 canonical types
    file_path: str               # Relative path
    line_number: int | None
    rule_ids: list[str]          # All matched rule IDs from all tools
    source_tools: list[str]      # ['semgrep', 'python_ast', 'ts_js_bridge', 'sbom']
    analysis_level: str          # 'L0' | 'L1' | 'L2' | 'L3' | 'L4'
    confidence: float            # Final clamped confidence 0.00–1.00
    confidence_components: dict  # {base, direct_evidence_bonus, corroboration_bonus, coverage_penalty, ambiguity_penalty}
    library_group: str | None    # 'openai' | 'anthropic' | etc.
    kwarg_names: list[str]       # Arg names only — no values
    has_dynamic_call: bool
    coverage_note: str | None    # Populated when finding_type is SCAN_COVERAGE_LIMITATION
```

## Confidence Formula

From `scanner-spec.md`:

```
rawConfidence = baseByFindingType
              + directEvidenceBonus
              + corroborationBonus
              - coveragePenalty
              - ambiguityPenalty

confidence = clamp(rawConfidence, 0.00, 1.00)
```

Component definitions:

Formula per `scanner-spec.md` Confidence Model (verbatim):

```python
import decimal

def calculate_confidence(
    finding_type: str,
    has_direct_ast_cst_evidence: bool,   # Direct AST/CST/symbol/path evidence found
    corroborating_tools: list[str],       # Tools independently confirming (each +0.05, cap +0.15)
    material_coverage_limitations: int,   # Count of material limitations (each -0.15, cap -0.30)
    has_unresolved_path: bool,            # Unresolved callee/output/review path (-0.20)
) -> tuple[float, dict]:

    base = FINDING_TYPES[finding_type]["base_confidence"]

    # Direct AST/CST/symbol/path evidence: +0.15
    direct_evidence_bonus = 0.15 if has_direct_ast_cst_evidence else 0.0

    # Independent corroboration: +0.05 each, capped +0.15
    # Duplicate evidence refs do not add corroboration
    unique_corroborators = list(set(corroborating_tools))
    corroboration_bonus = min(len(unique_corroborators) * 0.05, 0.15)

    # Material coverage limitation: -0.15 each, capped -0.30
    coverage_penalty = min(material_coverage_limitations * 0.15, 0.30)

    # Unresolved callee/output/review path: -0.20
    ambiguity_penalty = 0.20 if has_unresolved_path else 0.0

    raw = base + direct_evidence_bonus + corroboration_bonus - coverage_penalty - ambiguity_penalty

    # roundHalfUp to 2 decimal places, then clamp
    clamped = max(0.00, min(1.00, raw))
    confidence = float(decimal.Decimal(str(clamped)).quantize(
        decimal.Decimal("0.01"), rounding=decimal.ROUND_HALF_UP
    ))

    return confidence, {
        "base": base,
        "direct_evidence_bonus": direct_evidence_bonus,
        "corroboration_bonus": corroboration_bonus,
        "coverage_penalty": coverage_penalty,
        "ambiguity_penalty": ambiguity_penalty,
    }
```

## Signal Fusion Rules

| Priority | Rule |
|---|---|
| 1 | Same `file_path` + `line_number` + `rule_id` from multiple tools → merge into one finding, union `source_tools` |
| 2 | Same `file_path` + `finding_type` within 3 lines → corroborating signals, merge |
| 3 | `SCAN_COVERAGE_LIMITATION` from any tool → emit one finding per tool failure |
| 4 | `has_dynamic_call = True` on any merged finding → emit `UNSUPPORTED_DYNAMIC_FLOW` (additional finding) |
| 5 | Generic pattern (`base_confidence < 0.50`) alone (no SBOM/dependency corroboration) → keep but mark `corroboration_bonus = 0` |

## L4 Boundary (UNSUPPORTED_DYNAMIC_FLOW)

Emit `UNSUPPORTED_DYNAMIC_FLOW` finding when:
- Python AST: `has_dynamic_call = True` on a merged finding.
- TS/JS bridge: `has_dynamic_call = True` on a bridge finding.
- Python: `getattr(obj, method)()` pattern detected.
- TS: dynamic property access on AI client object.
- LangChain: `agent.invoke({"input": dynamic_var})` where input value is a dynamic reference.

`UNSUPPORTED_DYNAMIC_FLOW` findings have `confidence = 1.00` (the limitation itself is certain).

## Deduplication Algorithm

```python
def deduplicate(candidates: list[FindingCandidate]) -> list[TechnicalFinding]:
    # Group by (file_path, line_number_bucket, finding_type, rule_id)
    # line_number_bucket = line_number // 3 * 3  (merge within 3-line windows)
    # Union source_tools across merged group
    # Sum confidence_boost from PackageDependency corroboration
    # One TechnicalFinding per group
    ...
```

## Extended Signal Detection (8 Additional Finding Types)

These types must be emittable — they have base confidence values but require specific detection patterns in addition to the signal fusion rules above.

### AI_INPUT_SIGNAL
Evidence: structured data passed INTO an AI call. Detected via:
- Function parameter whose name/type matches input schema patterns AND flows to an AI call site (L2 trace)
- Route handler request body/query parameters flowing into AI call (via tree-sitter route augmentation, task 15)
- Pydantic model, TypedDict, dataclass used as AI call argument
- `messages=`, `prompt=`, `input=` kwarg names on AI call sites (already in `kwarg_names`)
- Manifest signal: `AI_INPUT` env var names (e.g. `MODEL_INPUT_SCHEMA`)

Emit when: AI call site `kwarg_names` contains `messages`, `prompt`, `input`, `user_input`, `query`, `context`, `document`.

### AI_OUTPUT_SIGNAL
Evidence: value returned FROM an AI call. Detected via:
- Assignment of AI call result to a variable (L2 trace: `result = ai_call(...)`)
- AI output variable used in downstream branch, write, or return
- Return type annotation on function containing AI call: `-> str`, `-> dict`, `-> ClassificationResult`
- Pydantic model used to parse/validate AI response (same pattern as `MODEL_OUTPUT_PARSER_SIGNAL`)

Emit when: AI call site result is assigned to a named variable AND that variable is used outside the call expression.

### RANKING_SIGNAL
Evidence: AI output used to order/sort items. Detected via:
- Semgrep rule: `$RESULT.sort(key=...)` or `sorted($RESULT, ...)` on AI output variable
- Function names: `rank`, `rerank`, `sort_by_score`, `order_results`, `rank_candidates`
- LangChain: `ReRanker`, `CohereRank`, cross-encoder usage

Pattern rules:
```python
RANKING_PATTERNS = [
    "rank_results", "rerank", "sort_by_relevance", "rank_candidates",
    "CrossEncoder", "CohereRerank", "BM25Retriever",
]
```

### RECOMMENDATION_SIGNAL
Evidence: AI output used to recommend items to users. Detected via:
- Function names: `recommend`, `get_recommendations`, `suggest`, `personalize`
- Decorator or route path containing `/recommend` or `/suggest`
- LangChain/LlamaIndex retrieval output returned directly to API response

Pattern rules:
```python
RECOMMENDATION_PATTERNS = [
    "recommend", "get_recommendations", "suggest_items", "personalize",
    "collaborative_filter", "content_based_filter",
]
```

### STATUS_UPDATE_SIGNAL
Evidence: AI output triggers a status change in an external system. Detected via:
- AI output → status field write (e.g. `entity.status = result["label"]`)
- Webhook/API call containing AI output label (L2/L3 trace)
- Pattern: `status_update`, `update_status`, `set_status`, `transition_to`

### USER_IMPACT_SIGNAL
Evidence: AI output directly affects a user's status, eligibility, price, or triggers an outbound notification — a decisive outcome, not merely informational content shown to the user. Detected via:
- AI output → email/notification send
- AI output → price/score/eligibility/status field write

A bare "AI output returned as HTTP response body" is deliberately **excluded** from this signal — that alone does not distinguish a decisive outcome from a summary/suggestion shown to the user. See `DISPLAY_ONLY_SIGNAL` below, which this evidence previously conflated with.

Pattern rules:
```python
USER_IMPACT_PATTERNS = [
    "send_email", "send_notification", "notify_user", "update_user",
    "set_eligibility", "set_price", "update_score",
]
```

### DISPLAY_ONLY_SIGNAL
Evidence: AI output resolves to a read-only sink (return/render/template/log) with no state-mutating write, branch-triggered action, or notification call on the same bounded L2/L3 path. This is positive evidence of an assistive/summary-only use, not silence — required to avoid `downstreamAction` defaulting to `UNKNOWN` (which may block classification) for a genuinely low-automation case. Detected via:
- AI output variable's only downstream uses are `return`, `render_template(...)`, `f-string`/template interpolation into a response object, or a logging call.
- No `STATUS_UPDATE_SIGNAL`, `USER_IMPACT_SIGNAL`, or `AUTOMATED_DECISION_SIGNAL` pattern found on the same bounded path.
- Path is fully resolved (not dynamic) — required so this is a positive conclusion, not a guess. If the path is dynamic/unresolved, emit `UNSUPPORTED_DYNAMIC_FLOW` instead, never `DISPLAY_ONLY_SIGNAL`.

Priority: if `STATUS_UPDATE_SIGNAL`, `USER_IMPACT_SIGNAL`, or `AUTOMATED_DECISION_SIGNAL` is found on the same bounded path, do not also emit `DISPLAY_ONLY_SIGNAL` — a decisive signal always takes priority over a display-only conclusion.

Pattern rules:
```python
DISPLAY_ONLY_SINK_PATTERNS = [
    "return", "render_template(", "render(", "JsonResponse(",
    "logger.info(", "logger.debug(", "print(",
]
```

### DOMAIN_CONTEXT_SIGNAL
Evidence: domain-specific context (legal, medical, financial) provided to AI. Detected via:
- Env var names: `DOMAIN`, `SECTOR`, `REGULATION_CONTEXT`, `JURISDICTION`
- Variable names near AI call: `legal_context`, `medical_record`, `financial_data`, `regulatory_framework`
- Manifest: domain-specific package names (e.g. `legal-python`, `medspacy`, `yfinance`)

### HARM_POTENTIAL_SIGNAL
Evidence: AI system operates in a high-stakes domain. Detected via:
- Domain packages: `medspacy`, `pydicom`, `hl7`, `legal-python`, `rdflib` (legal ontology)
- AI call site in function named: `assess_risk`, `evaluate_eligibility`, `make_decision`, `approve`, `reject`, `deny`
- Manifest: safety-critical domain imports

```python
HIGH_STAKES_DOMAINS = {
    "medical": ["medspacy", "pydicom", "hl7", "fhir"],
    "legal": ["legal-python", "courtlistener", "rdflib"],
    "financial": ["yfinance", "quantlib", "fredapi"],
    "safety": ["openalpr", "deepface"],
}
HIGH_STAKES_FUNCTION_NAMES = [
    "approve", "reject", "deny", "grant_access", "assess_risk",
    "evaluate_eligibility", "make_final_decision", "sentence",
]
```

### Signal Fusion for Extended Types

These 8 types are produced by `SignalFuser.fuse_extended_signals()` which runs AFTER primary AI invocation detection:
1. AI_INPUT_SIGNAL: emitted when AI call site has input-kwarg evidence.
2. AI_OUTPUT_SIGNAL: emitted when AI call site result is assigned and used.
3. RANKING/RECOMMENDATION/STATUS_UPDATE/USER_IMPACT: emitted when pattern names appear in same function as AI call site (L2 scope).
4. DOMAIN_CONTEXT/HARM_POTENTIAL: emitted when domain-specific packages or function names appear in workspace (L0 scope sufficient).
5. DISPLAY_ONLY_SIGNAL: emitted after all other extended signals are evaluated for the same bounded path, only when none of `STATUS_UPDATE_SIGNAL`/`USER_IMPACT_SIGNAL`/`AUTOMATED_DECISION_SIGNAL` fired and the path is fully resolved.

None of these require L3+ analysis — they are L0-L2 signals.

## Business Rules

1. Every `TechnicalFinding` has `finding_id` (UUID), `finding_type` in `FINDING_TYPES`, `confidence` in [0.00, 1.00].
2. `file_path` always relative — strip workspace prefix before producing finding.
3. No raw source content in any `TechnicalFinding` field. `kwarg_names` contains names only.
4. `SCAN_COVERAGE_LIMITATION` findings: one per distinct tool failure, `confidence = 1.00`.
5. `UNSUPPORTED_DYNAMIC_FLOW` findings: emitted as separate findings alongside the triggering finding.
6. Generic-pattern findings (`base_confidence < 0.50`) with no SBOM/dependency corroboration: retained but not promoted to top of ranked list.
7. Finding list sorted: `UNSUPPORTED_DYNAMIC_FLOW` and `SCAN_COVERAGE_LIMITATION` first, then by confidence descending.
8. `DISPLAY_ONLY_SIGNAL` and any of `STATUS_UPDATE_SIGNAL`/`USER_IMPACT_SIGNAL`/`AUTOMATED_DECISION_SIGNAL` are mutually exclusive on the same bounded path — a decisive signal always suppresses `DISPLAY_ONLY_SIGNAL`.
9. `DISPLAY_ONLY_SIGNAL` is never emitted on an unresolved/dynamic path — `UNSUPPORTED_DYNAMIC_FLOW` takes precedence so a display-only conclusion is never a guess.

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | Semgrep + Python AST both match `openai` in same file/line with direct AST evidence | `AI_PROVIDER_USAGE`, base=0.35, `direct_evidence_bonus=0.15`, merged |
| T02 | SBOM confirms `openai` as corroborator | `corroboration_bonus += 0.05` → final confidence = roundHalfUp(0.35+0.15+0.05, 2) = 0.55 |
| T03 | Dependency usage confirms `openai` is `used` (second corroborator) | `corroboration_bonus = 0.10` |
| T04 | `has_unresolved_path = True` (dynamic call) | `ambiguity_penalty = 0.20`, additional `UNSUPPORTED_DYNAMIC_FLOW` finding |
| T05 | 2 material coverage limitations | `coverage_penalty = 0.30` (capped) |
| T06 | Generic `.predict()` alone (no SBOM, no dep, no direct evidence) | `base=0.35`, no adjustments → confidence = 0.35 |
| T07 | Semgrep timeout (tool failure) | `SCAN_COVERAGE_LIMITATION` finding emitted |
| T08 | `AI_MODEL_INVOCATION` with direct AST evidence + 3 corroborators | base=0.70, +0.15, +0.15(cap) = 1.00, clamped |
| T09 | `confidence` raw > 1.00 | Clamped to 1.00 then roundHalfUp |
| T10 | `confidence` raw < 0.00 | Clamped to 0.00 |
| T11 | `kwarg_names` field | Contains names only, no string values |
| T12 | Finding list output | Sorted: limitations first, then confidence descending |
| T13 | AI call site with `messages=` kwarg | `AI_INPUT_SIGNAL` emitted |
| T14 | AI call result assigned and used in branch | `AI_OUTPUT_SIGNAL` emitted |
| T15 | `rank_results()` in same function as AI call | `RANKING_SIGNAL` emitted |
| T16 | `assess_risk()` function + medical package in SBOM | `HARM_POTENTIAL_SIGNAL` emitted |
| T17 | AI output only flows to `return {"summary": result}` in an API handler, path fully resolved | `DISPLAY_ONLY_SIGNAL` emitted, no `USER_IMPACT_SIGNAL` |
| T18 | AI output flows to `return` AND to `update_score(result)` in same path | `USER_IMPACT_SIGNAL` emitted; `DISPLAY_ONLY_SIGNAL` suppressed |
| T19 | AI output flows to `return`, but downstream call is dynamic/unresolved | `UNSUPPORTED_DYNAMIC_FLOW`; `DISPLAY_ONLY_SIGNAL` not emitted |

## Definition of Done

- All 20 canonical finding types in `FINDING_TYPES` constant.
- Confidence formula matches scanner-spec.md exactly (all 5 components).
- Deduplication merges same file/line/finding_type within 3-line windows.
- `UNSUPPORTED_DYNAMIC_FLOW` emitted for every dynamic call finding.
- `SCAN_COVERAGE_LIMITATION` emitted for every tool failure.
- No raw source in any `TechnicalFinding` field.
- Finding list sorted: limitations first, then by confidence descending.
- `DISPLAY_ONLY_SIGNAL` only emitted on a fully-resolved path with no decisive signal present, never as a default/guess.
- `USER_IMPACT_SIGNAL` evidence excludes bare HTTP response return — only decisive status/eligibility/price/notification patterns qualify.

## Implementation Evidence

- Added the AI invocation detector pipeline that fuses Semgrep, Python AST/CST, TS/JS bridge, SBOM, and Knip/deptry dependency facts into privacy-safe `TechnicalFinding` records.
- Added canonical finding type constants and scanner-spec base confidence values, including limitation findings with confidence `1.00` as certainty of scanner limitation, not certainty of AI business behavior.
- Implemented the exact confidence formula with `base`, `direct_evidence_bonus`, `corroboration_bonus`, `coverage_penalty`, and `ambiguity_penalty`, using round-half-up and clamping to `[0.00, 1.00]`.
- Implemented deduplication by same file/finding type within a 3-line bucket, while keeping `SCAN_COVERAGE_LIMITATION` and `UNSUPPORTED_DYNAMIC_FLOW` distinct per tool/rule.
- Added extended signal derivation for input/output, ranking, recommendation, status update, user impact, display-only, domain context, and harm potential signals.
- Wired `AIInvocationDetector` into `ScanConsumer` so scanner callbacks now include `technical_findings` in the evidence payload assembled by `EvidenceAssembler`.
- Added comments in the changed analyzer code explaining privacy boundaries, limitation semantics, post-dedup signal derivation, and deterministic confidence arithmetic.
- Added focused tests for signal fusion, confidence calculation, dynamic flow boundaries, coverage limitations, source-free payloads, TS/JS bridge integration, and display-only versus decisive-signal precedence.

## File List

- `deepagents/tools/graph/scanner/analyzers/__init__.py`
- `deepagents/tools/graph/scanner/analyzers/ai_invocation_detector.py`
- `deepagents/tools/graph/scanner/analyzers/confidence_calculator.py`
- `deepagents/tools/graph/scanner/analyzers/finding_deduplicator.py`
- `deepagents/tools/graph/scanner/analyzers/finding_types.py`
- `deepagents/tools/graph/scanner/analyzers/signal_fuser.py`
- `deepagents/tools/graph/scanner/evidence_assembler.py`
- `deepagents/tools/graph/scanner/scan_consumer.py`
- `deepagents/tests/test_ai_invocation_detector.py`
- `deepagents/tests/test_evidence_assembler.py`
- `deepagents/tests/test_scanner_workspace.py`
- `docs/implementation/tasks/modules/python-workers/scanner/09-ai-invocation-detector.md`

## Validation

Baseline commit before task work: `8455adaea47aeccb6ba20f81805afc1a8e91573f`.

- `./.venv/bin/pytest tests/test_ai_invocation_detector.py tests/test_evidence_assembler.py tests/test_scanner_workspace.py`
  - Result: passed, 30 tests.
- `./.venv/bin/pytest tests/test_ai_invocation_detector.py tests/test_semgrep_tool.py tests/test_ts_js_bridge.py tests/test_scanner_analyzer.py tests/test_dependency_usage_tools.py tests/test_evidence_assembler.py tests/test_scanner_workspace.py tests/test_technical_profile_worker.py tests/test_ai_usage_flow_worker.py`
  - Result: passed, 97 tests.
- `./.venv/bin/python -m compileall tools/graph/scanner/analyzers tools/graph/scanner/evidence_assembler.py tools/graph/scanner/scan_consumer.py tests/test_ai_invocation_detector.py tests/test_evidence_assembler.py tests/test_scanner_workspace.py`
  - Result: passed.
- `git diff --check`
  - Result: passed.
- `./.venv/bin/pytest`
  - Result: blocked by local dependency state: `tiktoken` missing during `tests/test_llm_gateway.py` collection.
- `./.venv/bin/pytest --ignore=tests/test_llm_gateway.py`
  - Result: 163 passed / 8 skipped, with remaining failures unrelated to this task: local venv missing `boto3` for audit export consumer and sandboxed socket binding for health tests.
- `./.venv/bin/pytest tests/test_worker_health.py`
  - Result: passed, 5 tests, run outside filesystem sandbox because tests bind a local HTTP socket.
