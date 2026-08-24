---
task_id: MW-scan-py-015
module: python-workers/scanner
runtime: deepagents
priority: P1
status: READY_FOR_DEV
epic_story: 3.5
depends_on:
  - python-workers/scanner/14-language-classifier.md
  - python-workers/scanner/06-python-ast-cst-analyzer.md
  - python-workers/scanner/07-ts-js-subprocess-bridge.md
---

# Tree-sitter Structural Augmentation (Pipeline Step 11)

## Outcome

Run tree-sitter (or custom structural parser) on files where the primary analyzer (Python AST/CST or TS/JS bridge) produced findings, to augment structural metadata: route handler detection, decorator patterns, class hierarchy, and function signatures. Augments `TechnicalFinding` records with structural context without duplicating or replacing primary analysis. Non-blocking — failure emits `ACCEPTED_WITH_LIMITATION`.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/graph/scanner/parsers/tree_sitter_parser.py` | Create | tree-sitter runner + structural extraction |
| `deepagents/tools/graph/scanner/parsers/structural_augmentor.py` | Create | Merge tree-sitter output into existing findings/graph nodes |
| `deepagents/tools/graph/scanner/parsers/structural_types.py` | Create | `StructuralFact` dataclass |

## Structural Patterns Extracted

| Pattern | Languages | Purpose | Graph node added |
|---|---|---|---|
| HTTP route decorator (`@app.route`, `@router.get`, `@app.post`, `@Get()`, `@Post()`) | Python, TS/JS | Detect AI usage in web request handlers | `ROUTE` node |
| Class definition with AI base class | Python, TS/JS | Detect `class MyAgent(AgentExecutor):` etc. | `CLASS` node with AI flag |
| Async function definition containing AI call site | Python, TS/JS | Confirm async AI invocation path | `FUNCTION` node, `is_async=True` |
| FastAPI/Django/Flask router patterns | Python | Route-level AI usage | `CONTROLLER` and `ROUTE` nodes |
| NestJS controller decorator | TS | Route-level AI usage | `CONTROLLER` and `ROUTE` nodes |
| Celery task decorator (`@celery.task`, `@shared_task`) | Python | Background job AI usage | `FUNCTION` node with job context |
| Pydantic model definition near AI call site | Python | Input/output schema for AI calls | `AI_INPUT` or `AI_OUTPUT` node |

## Output Schema

```python
@dataclass
class StructuralFact:
    file_path: str              # Relative path
    pattern_type: str           # 'route_handler' | 'ai_class' | 'async_ai_function' | 'celery_task' | 'pydantic_model'
    name: str                   # Function/class/route name — no source content
    line_number: int
    decorators: list[str]       # Decorator names only (e.g. ['@app.get', '@require_auth'])
    is_async: bool
    ai_finding_ids: list[str]   # TechnicalFinding IDs this augments
    graph_node_type: str        # 'ROUTE' | 'CONTROLLER' | 'FUNCTION' | 'CLASS'
    parse_source: str           # 'tree_sitter' | 'custom_regex_fallback'
```

## Scope Constraint

- Runs on files that already have AI findings from tasks 06 or 07, plus Basic-signal-detection-language files (Java, Kotlin, Go, C#, Rust) identified by task 14, per ADR-023 Phase 5.2M widening — tree-sitter coverage expands to more languages/structural facts but remains additive; it does not replace `ast`/`libcst` or `ts-morph` semantic resolution and does not upgrade Basic-signal-detection languages to first-class semantic analysis.
- Does NOT scan all workspace files unconditionally — still targeted augmentation, now gated on either an existing AI finding or Basic-signal-detection-language membership.
- Max files: 100 files with AI findings, plus a separate bounded cap for Basic-signal-detection-language structural augmentation (same 100-file/10s-per-file limits apply independently).
- Per file timeout: 10s. On timeout → skip file, `ACCEPTED_WITH_LIMITATION`.

## Fallback: Custom Regex Parser

If `tree-sitter` grammar not available for a language, fall back to regex-based structural detection:

```python
ROUTE_PATTERNS = [
    # Python
    r'@(?:app|router|blueprint)\.(get|post|put|delete|patch)\s*\(',
    r'@(?:app\.route|router\.route)\s*\(',
    # FastAPI
    r'@(?:router|app)\.(get|post|put|delete|patch)\s*\(',
    # NestJS (TypeScript)
    r'@(?:Get|Post|Put|Delete|Patch)\s*\(',
    r'@Controller\s*\(',
    # Django
    r'path\s*\(',
    r'urlpatterns\s*=',
]

CELERY_PATTERNS = [
    r'@(?:celery|app)\.task',
    r'@shared_task',
]
```

## Business Rules

1. Only augments files with existing AI findings — does not introduce new files to analysis.
2. `StructuralFact.decorators` contains decorator names only — no decorator arguments or values.
3. `StructuralFact.name` contains function/class name only — no source content.
4. Tree-sitter failure → fallback to regex parser → failure → skip file, `ACCEPTED_WITH_LIMITATION`.
5. Augmentation merges into graph (task 11) by adding/updating `ROUTE`, `CONTROLLER`, `FUNCTION`, `CLASS` nodes.
6. Does NOT create new `TechnicalFinding` records — only enriches existing ones via `ai_finding_ids`.
7. Route detection augments `AI_INPUT_SIGNAL` findings (HTTP route = structured input path).

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | `@app.get('/predict')` function containing OpenAI call | `ROUTE` node added, linked to AI finding |
| T02 | `@shared_task` celery task with LangChain chain | `FUNCTION` node, job context |
| T03 | `class MyAssistant(AgentExecutor):` | `CLASS` node, `ai_class` pattern |
| T04 | `async def process(...)` with Anthropic call | `FUNCTION` node, `is_async=True` |
| T05 | File with no AI findings | Not processed |
| T06 | tree-sitter grammar unavailable | Regex fallback runs |
| T07 | Regex fallback failure | Skip file, `ACCEPTED_WITH_LIMITATION` |
| T08 | Decorator has arguments | Decorator NAME only, no argument values |
| T09 | 101 AI-finding files | 100 processed, 1 coverage limitation |
| T10 | NestJS `@Get('/generate')` controller | `CONTROLLER` + `ROUTE` node added |

## Definition of Done

- Processes only files with existing AI findings.
- Route, controller, async function, celery task, and class patterns detected.
- tree-sitter failure falls back to regex — both non-blocking.
- No source content in any `StructuralFact` field.
- Graph augmentation: `ROUTE`, `CONTROLLER`, `FUNCTION`, `CLASS` nodes created/updated.
- `ai_finding_ids` links structural facts to triggering findings.
