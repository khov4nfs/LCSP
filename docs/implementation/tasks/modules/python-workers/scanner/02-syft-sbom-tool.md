---
task_id: MW-scan-py-002
module: python-workers/scanner
runtime: deepagents
priority: P0
status: READY_FOR_DEV
epic_story: 3.5
depends_on:
  - python-workers/scanner/01-scanner-workspace-setup.md
---

# Syft SBOM Tool Wrapper

## Outcome

Run Syft SBOM analysis on the scanner workspace. Produce a structured dependency manifest with version pinning and ecosystem metadata. Syft version pinned; config hash recorded in evidence provenance.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/graph/scanner/tools/syft_tool.py` | Create | Syft runner + output parser |
| `deepagents/tools/graph/scanner/tools/tool_base.py` | Create | Base class for all scanner tools |
| `deepagents/tools/graph/scanner/tool_registry.py` | Create | Tool version + config hash registry |

## Tool Configuration

| Parameter | Value | Notes |
|---|---|---|
| Syft version | Pinned (e.g., `v1.x.y`) | Set in `pyproject.toml` or scanner config |
| Output format | `json` | Parsed by wrapper |
| Config file | `syft-config.yaml` | Hash recorded in evidence provenance |
| Timeout | 120s | Abort if exceeded |

## Output Schema (parsed from Syft JSON)

```python
@dataclass
class SBOMEntry:
    name: str
    version: str
    ecosystem: str          # npm, pypi, cargo, etc.
    location: str           # relative file path only (no absolute paths)
    purl: str               # Package URL
    license: str | None
```

## Business Rules

1. Run Syft on the workspace path: `syft dir:<workspace_path> -o json`.
2. Parse JSON output into list of `SBOMEntry`.
3. Record `tool_version = syft --version` output.
4. Record `config_hash = sha256(syft-config.yaml)`.
5. All file paths in output must be relative to workspace root — strip absolute paths.
6. If Syft exits non-zero: classify as `tool_failure`, record severity, continue with other tools (do not abort scan).
7. SBOM output must NOT contain raw source code — only package metadata.
8. Timeout 120s — kill process if exceeded, record as `tool_timeout`.

**Tool failure severity table** (per `docs/implementation/decisions/scanner-severity-tool-provenance-decision.md`):
- Syft failure → `coverage_limited` (partial evidence, not blocking)

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | Workspace with npm packages | SBOM entries for all packages |
| T02 | Workspace with no packages | Empty SBOM list |
| T03 | Syft exits non-zero | `tool_failure` recorded, scan continues |
| T04 | Syft timeout (> 120s) | `tool_timeout` recorded, scan continues |
| T05 | Config hash recorded | `config_hash` in evidence provenance |
| T06 | No absolute file paths in output | Relative paths only |
| T07 | No source code in SBOM entries | Field inspection |

## Definition of Done

- SBOM entries parsed with relative paths only.
- Tool version and config hash recorded in evidence provenance.
- Syft failure is non-blocking (partial coverage).
- No source code in output.
