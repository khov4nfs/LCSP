---
task_id: MW-scan-py-005
module: python-workers/scanner
runtime: deepagents
priority: P0
status: DONE
epic_story: 3.5
depends_on:
  - python-workers/scanner/01-scanner-workspace-setup.md
---

# Knip + deptry Dependency Usage Analysis Tool

## Outcome

Run Knip (JS/TS unused/used dependency analysis) and deptry (Python missing/unused/transitive dependency facts) on the scanner workspace. Produce `DependencyUsageFact` records that distinguish declared, used, unused, transitive, and missing dependencies. These complement Syft SBOM with actual usage evidence — presence alone is not AI usage proof.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/graph/scanner/tools/knip_tool.py` | Create | Knip runner + JSON output parser |
| `deepagents/tools/graph/scanner/tools/deptry_tool.py` | Create | deptry runner + JSON output parser |
| `deepagents/tools/graph/scanner/dependencies/dependency_fact.py` | Create | `DependencyUsageFact` dataclass |
| `deepagents/tools/graph/scanner/dependencies/dependency_normalizer.py` | Create | Merge Syft + Knip + deptry into unified `PackageDependency` list |

## Tool Configuration

| Tool | Run condition | Timeout | Failure severity |
|---|---|---|---|
| Knip | JS/TS files present | 120s | `ACCEPTED_WITH_LIMITATION` (non-critical) |
| deptry | Python files + `pyproject.toml` / `requirements*.txt` present | 60s | `ACCEPTED_WITH_LIMITATION` (non-critical) |

Version pinned. Config hash recorded per `scanner-severity-tool-provenance-decision.md`.

## Output Schema

```python
@dataclass
class DependencyUsageFact:
    package_name: str
    version: str | None
    ecosystem: str                   # 'npm' | 'pypi' | 'cargo' | etc.
    usage_state: str                 # 'declared' | 'used' | 'unused' | 'transitive' | 'missing' | 'uncertain'
    source_tool: str                 # 'knip' | 'deptry' | 'syft'
    file_refs: list[str]             # Relative file paths where usage found (no source content)
    is_ai_relevant: bool             # True if package in AI_PACKAGE_REGISTRY

@dataclass
class PackageDependency:
    name: str
    version: str | None
    ecosystem: str
    purl: str | None
    usage_facts: list[DependencyUsageFact]
    confidence_boost: float          # +0.05 per independent tool that confirms usage, capped +0.15
```

## AI Package Registry

```python
AI_PACKAGE_REGISTRY = {
    # OpenAI
    'openai', 'openai-python',
    # Anthropic
    'anthropic',
    # Google
    'google-generativeai', 'google-cloud-aiplatform', 'vertexai',
    # Hugging Face
    'transformers', 'datasets', 'huggingface-hub', 'diffusers',
    # LangChain
    'langchain', 'langchain-core', 'langchain-community', 'langchain-openai',
    'langchain-anthropic', 'langchain-google-genai',
    # LlamaIndex
    'llama-index', 'llama-index-core', 'llama_index',
    # Frameworks
    'autogen', 'pyautogen', 'crewai', 'haystack-ai',
    'semantic-kernel', 'guidance',
    # ML
    'torch', 'tensorflow', 'keras', 'scikit-learn', 'sklearn',
    'xgboost', 'lightgbm',
    # JS/TS equivalents
    'openai',           # npm
    '@anthropic-ai/sdk',
    '@google/generative-ai',
    'langchain',        # npm
    'llamaindex',       # npm
    '@huggingface/inference',
}
```

## Business Rules

1. Run Knip: `npx knip --reporter json` in workspace (no install — Node.js already in scanner env).
2. Run deptry: `deptry . --json-output /tmp/deptry-out.json` in workspace.
3. Do NOT run `npm install`, `pip install`, `poetry install`, or any package manager install in workspace.
4. Normalize Knip + deptry + Syft outputs into `PackageDependency` list via `DependencyNormalizer`.
5. `is_ai_relevant = True` when package name is in `AI_PACKAGE_REGISTRY`.
6. `file_refs` contains relative paths only — no absolute paths, no source content.
7. `usage_state` priority: if Knip/deptry marks `used` → `used`; if SBOM only → `declared`.
8. Tool failure: record `tool_failure`, continue (non-blocking).
9. Confidence boost: each independent tool confirming usage of same package → `+0.05` to that package's AI signal confidence.

## Dependency State Definitions

| State | Meaning |
|---|---|
| `declared` | In manifest/lockfile only — no usage confirmed |
| `used` | Confirmed used by import/call analysis (Knip/deptry) |
| `unused` | Declared but Knip/deptry confirm no import |
| `transitive` | Not in manifest but Syft found via lockfile/tree |
| `missing` | Imported in code but not in manifest (deptry: missing) |
| `uncertain` | Tool could not determine state |

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | JS project with `openai` imported | `is_ai_relevant = True`, `usage_state = used` |
| T02 | Python project with `torch` in requirements but unused | `usage_state = unused` |
| T03 | `langchain` imported but not in requirements | `usage_state = missing` |
| T04 | Transitive dep from lockfile only | `usage_state = transitive` |
| T05 | Knip timeout | `tool_failure` recorded, analysis continues |
| T06 | No `npm install` run | No `node_modules` created in workspace |
| T07 | `file_refs` relative only | No absolute paths |
| T08 | Two tools confirm same AI package usage | `confidence_boost = 0.10` (two × 0.05) |

## Definition of Done

- `DependencyUsageFact` distinguishes all 6 usage states.
- `AI_PACKAGE_REGISTRY` covers OpenAI, Anthropic, Google, Hugging Face, LangChain, LlamaIndex, Autogen, ML frameworks.
- No package install in workspace (Knip runs via pre-installed Node.js in scanner env).
- Tool version and config hash recorded in evidence provenance.
- Non-blocking on failure (`ACCEPTED_WITH_LIMITATION`).

## Implementation Evidence

- Added `deepagents/tools/graph/scanner/dependencies/dependency_fact.py` with `DependencyUsageFact`, `PackageDependency`, all 6 usage states, and the AI package registry from this task brief.
- Added `deepagents/tools/graph/scanner/dependencies/dependency_normalizer.py` to merge Syft SBOM entries with Knip/deptry usage facts, distinguish declared/transitive/used/unused/missing states, and calculate capped confidence boost per confirming tool.
- Added `deepagents/tools/graph/scanner/tools/knip_tool.py` with JS/TS run-condition detection, `npx --no-install knip --reporter json`, pinned version check, config hash, timeout/failure handling, relative file refs, and no `node_modules` creation.
- Added `deepagents/tools/graph/scanner/tools/deptry_tool.py` with Python+manifest run-condition detection, `deptry . --json-output <tmp>`, pinned version check, config hash, timeout/failure handling, missing/unused parsing, and relative file refs.
- Updated `ScanConsumer` to run Syft → Semgrep → Knip → deptry, record all tool provenance, normalize package dependencies, and include them in the scan callback evidence payload.
- Updated `EvidenceAssembler` to include `package_dependencies` and dependency tool executions in the final redacted callback payload/tool failure records.
- Validation: Python compile checks passed for changed worker files and tests. Targeted pytest passed: `test_dependency_usage_tools.py`, `test_evidence_assembler.py`, `test_scanner_workspace.py`, `test_api_client.py` — 30 passed, 1 warning. Full `deepagents/tests` collection is blocked in the temporary Python 3.14 validation environment by missing `tiktoken`; installing full worker deps is blocked because `tiktoken==0.8.0` has no compatible wheel here and requires a Rust compiler.
