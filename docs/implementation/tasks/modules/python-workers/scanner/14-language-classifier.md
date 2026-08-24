---
task_id: MW-scan-py-014
module: python-workers/scanner
runtime: deepagents
priority: P0
status: READY_FOR_DEV
epic_story: 3.5
depends_on:
  - python-workers/scanner/01-scanner-workspace-setup.md
  - python-workers/scanner/13-manifest-config-parser.md
---

# Language Classifier and Analyzer Router (Pipeline Step 8)

## Outcome

Classify each file in the workspace by language and support level, then route to the appropriate analyzer: Python AST/CST analyzer (task 06), TS/JS subprocess bridge (task 07), or basic manifest/structural signal detection. Emits `SCAN_COVERAGE_LIMITATION` for unsupported languages. This step determines what analysis runs — without it, analyzers cannot know which files to process.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/graph/scanner/inventory/language_classifier.py` | Create | Classify files → `LanguageClassification` list |
| `deepagents/tools/graph/scanner/inventory/analyzer_router.py` | Create | Route `LanguageClassification` → analyzer dispatch list |
| `deepagents/tools/graph/scanner/inventory/language_types.py` | Create | `LanguageClassification` dataclass, support level constants |

## Support Levels (from scanner-spec.md)

| Level | Languages | Analyzers | Notes |
|---|---|---|---|
| `FULL` | Python (`.py`) | Python AST/CST (task 06) | First-class bounded analysis L0-L3 |
| `FULL` | TypeScript, JavaScript (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`) | TS/JS subprocess bridge (task 07) | First-class via subprocess |
| `BASIC` | Other languages with text-parseable manifests | Semgrep only, manifest-signal only | No AST/CST |
| `MANIFEST_ONLY` | Binary, generated, minified, oversized (>10 MB), unknown | Manifest parser only | No code analysis |
| `SKIP` | Binary, compiled, media, auto-generated lock files only | None | Emit SCAN_COVERAGE_LIMITATION |

## Output Schema

```python
@dataclass
class LanguageClassification:
    file_path: str           # Relative path
    language: str            # 'python' | 'typescript' | 'javascript' | 'yaml' | 'json' | 'other' | 'binary' | 'unknown'
    support_level: str       # 'FULL' | 'BASIC' | 'MANIFEST_ONLY' | 'SKIP'
    file_size_bytes: int
    line_count: int | None   # None for binary/skip
    skip_reason: str | None  # Populated when SKIP
    coverage_limitation: bool

@dataclass
class AnalyzerDispatch:
    python_files: list[str]  # Relative paths for Python AST/CST analyzer
    ts_js_files: list[str]   # Relative paths for TS/JS bridge
    basic_files: list[str]   # Relative paths for Semgrep-only pass
    skipped_files: list[str] # Files with SKIP level
    coverage_limitations: list[dict]  # {file_path, reason}
```

## File Classification Rules

1. Extension-based primary classification:
   - `.py` → `python`, `FULL`
   - `.ts`, `.tsx` → `typescript`, `FULL`
   - `.js`, `.jsx`, `.mjs`, `.cjs` → `javascript`, `FULL`
   - `.yaml`, `.yml` → `yaml`, `BASIC`
   - `.json` → `json`, `BASIC` (manifests only — not data files >100 KB)
   - `.toml`, `.cfg`, `.ini`, `.env` → config, `MANIFEST_ONLY`
   - `.md`, `.rst`, `.txt` → docs, `SKIP`
   - `.png`, `.jpg`, `.gif`, `.ico`, `.woff`, `.mp4`, etc. → binary, `SKIP`
   - `.min.js` (minified) → `SKIP` (emit `SCAN_COVERAGE_LIMITATION`)
   - `.d.ts` (TypeScript declarations) → `SKIP`

2. Size override: any file > 10 MB → `SKIP` (emit `SCAN_COVERAGE_LIMITATION`).

3. Path exclusion (always skip, no coverage limitation needed):
   - `node_modules/`, `venv/`, `.venv/`, `__pycache__/`, `.git/`, `dist/`, `build/`, `.tox/`, `*.egg-info/`

4. Max analyzed files per language:
   - Python: max 500 files
   - TS/JS: max 500 files  
   - Exceeding → truncate list, emit `SCAN_COVERAGE_LIMITATION`

## Business Rules

1. Exclusion paths checked before classification — excluded files produce no `LanguageClassification` record.
2. `.min.js` detection: filename contains `.min.js` or file has <5 lines despite >10 KB.
3. Minified JS → `SKIP` with `SCAN_COVERAGE_LIMITATION` (cannot analyze reliably).
4. Binary detection: non-UTF-8 content in first 512 bytes → binary → `SKIP`.
5. `AnalyzerDispatch` is the output consumed by tasks 06, 07, 08, 09.
6. Language breakdown (file counts per language) is recorded in `REPOSITORY` graph node.

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | `src/main.py` | `python`, `FULL`, in `python_files` |
| T02 | `src/app.ts` | `typescript`, `FULL`, in `ts_js_files` |
| T03 | `src/utils.min.js` | `SKIP`, `SCAN_COVERAGE_LIMITATION` |
| T04 | File > 10 MB | `SKIP`, `SCAN_COVERAGE_LIMITATION` |
| T05 | `node_modules/openai/index.js` | Excluded — no record |
| T06 | 501 Python files | 500 analyzed, 1 coverage limitation |
| T07 | Binary PNG | `binary`, `SKIP` |
| T08 | `__pycache__/main.cpython-311.pyc` | Excluded — no record |
| T09 | `.env` file | `MANIFEST_ONLY` |
| T10 | `package.json` 200 KB | `MANIFEST_ONLY` (>100 KB JSON treated as data, not manifest) |

## Definition of Done

- All 5 support levels implemented.
- Extension rules cover Python, TS/JS, YAML, JSON, config, docs, binary.
- Exclusion paths (`node_modules/`, `venv/`, etc.) applied before classification.
- `.min.js` detected and skipped with coverage limitation.
- Size limit (10 MB per file) enforced.
- Max analyzed files (500 per language) enforced.
- `AnalyzerDispatch` output consumed by tasks 06, 07, 08, 09.
