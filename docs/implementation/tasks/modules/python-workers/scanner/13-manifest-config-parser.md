---
task_id: MW-scan-py-013
module: python-workers/scanner
runtime: deepagents
priority: P0
status: READY_FOR_DEV
epic_story: 3.5
depends_on:
  - python-workers/scanner/01-scanner-workspace-setup.md
---

# Manifest and Configuration Parser (Pipeline Step 5)

## Outcome

Parse all manifest, configuration, schema, and migration files in the workspace to extract structural metadata relevant to AI usage. Produces `ManifestFact` records used downstream by the dependency normalizer, Python AST analyzer, and evidence graph assembler. Never parses or retains raw content — structural metadata only (package names, keys, referenced models, environment variable names).

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/graph/scanner/inventory/manifest_parser.py` | Create | Main parser orchestrator |
| `deepagents/tools/graph/scanner/inventory/manifest_types.py` | Create | `ManifestFact` dataclass |
| `deepagents/tools/graph/scanner/inventory/manifest_rules.py` | Create | Manifest file type registry + extraction rules |

## Manifest Types Handled

| File pattern | Parser | Extracted metadata |
|---|---|---|
| `pyproject.toml`, `setup.cfg`, `setup.py` | TOML/INI/AST | package names, extras, python_requires |
| `requirements*.txt`, `constraints.txt` | Line parser | package names + version specs |
| `package.json` | JSON | name, dependencies, devDependencies keys |
| `yarn.lock`, `pnpm-lock.yaml`, `package-lock.json` | Structural | package names in lockfile (no values) |
| `Pipfile`, `Pipfile.lock` | TOML | package names |
| `Cargo.toml` | TOML | package names (for Rust projects — basic coverage) |
| `*.env`, `*.env.example` | Line parser | environment variable NAMES only — never values |
| `Dockerfile`, `docker-compose*.yml` | Line/YAML parser | FROM image names, EXPOSE ports, service names |
| `*.yaml`, `*.yml` (config) | YAML key-only | top-level key names only — no values |
| `alembic.ini`, `alembic/versions/*.py` | Structural | migration file presence (no content) |
| `prisma/schema.prisma` | Structural | model names, field names (no default values) |
| `*.json` (schema/config) | JSON key-only | top-level and nested key names only |

## Output Schema

```python
@dataclass
class ManifestFact:
    manifest_type: str           # 'requirements_txt' | 'package_json' | 'pyproject_toml' | etc.
    file_path: str               # Relative path only
    package_names: list[str]     # Declared dependency names (no versions in AI-relevant extraction)
    env_var_names: list[str]     # Env var NAMES only — no values, no secrets
    config_key_names: list[str]  # Top-level config key names — no values
    ai_relevant_signals: list[str]  # Package names in AI_PACKAGE_REGISTRY, or AI-related env var names
    parse_error: bool            # True if parse failed
```

## AI-Relevant Env Var Signal Detection

Env var NAMES (not values) indicating AI integration:

```python
AI_ENV_VAR_PATTERNS = [
    "OPENAI_API_KEY", "OPENAI_ORG_ID", "OPENAI_BASE_URL",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY", "VERTEX_AI_PROJECT", "VERTEX_AI_LOCATION",
    "HUGGINGFACE_API_TOKEN", "HF_TOKEN",
    "LANGCHAIN_API_KEY", "LANGCHAIN_TRACING_V2",
    "COHERE_API_KEY", "MISTRAL_API_KEY", "TOGETHER_AI_API_KEY",
    "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT",
    # Generic model/inference patterns
    "MODEL_NAME", "MODEL_ENDPOINT", "INFERENCE_URL", "LLM_MODEL",
    "OLLAMA_BASE_URL", "VLLM_ENDPOINT",
]
```

Detecting an AI env var name (not value) emits contribution to `AI_INPUT_SIGNAL` confidence (env var config is input signal evidence).

## Business Rules

1. Parse files by type — do NOT read raw file content into strings longer than 100 KB.
2. Extract NAMES only: package names, env var names, key names. Never extract values, secrets, or tokens.
3. Env var values must NEVER appear in `ManifestFact` — only the variable name.
4. `.env` files: parse line by line, split on `=`, take left side (name) only — discard right side (value).
5. YAML/JSON config: extract top-level keys only — do not recurse into deep value trees.
6. `parse_error = True` on any exception — non-blocking.
7. Results feed into `DependencyNormalizer` (task 05) and `ScanGraph` (task 11).
8. Max files to parse: 200 manifest files per workspace — skip remainder, record `coverage_limitation`.

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | `requirements.txt` with `openai==1.14.0` | `package_names = ['openai']`, `ai_relevant_signals = ['openai']` |
| T02 | `.env.example` with `OPENAI_API_KEY=sk-...` | `env_var_names = ['OPENAI_API_KEY']` — value NOT in output |
| T03 | `package.json` with `"openai": "^4.0.0"` | `package_names = ['openai']`, `ai_relevant_signals = ['openai']` |
| T04 | `pyproject.toml` with `langchain = "^0.1"` | `package_names = ['langchain']`, `ai_relevant_signals = ['langchain']` |
| T05 | YAML config file | Top-level key names only extracted |
| T06 | Malformed TOML | `parse_error = True`, continues |
| T07 | 201 manifest files | 200 parsed, coverage_limitation recorded |
| T08 | `.env` value on right side of `=` | Value never appears in ManifestFact |

## Definition of Done

- All manifest types listed in table handled.
- Env var values never extracted — names only.
- YAML/JSON values never extracted — keys only.
- `parse_error = True` on failure (non-blocking).
- `ai_relevant_signals` populated from AI_PACKAGE_REGISTRY + AI_ENV_VAR_PATTERNS.
- Results feed into DependencyNormalizer and ScanGraph.
