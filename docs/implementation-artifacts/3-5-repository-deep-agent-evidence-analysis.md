> **Superseded by the Repository Analyst runtime (2026-09-30), see deepagents/FLOW.md.** The Planner/Investigator/Scanner-pipeline description below is historical.

# Story 3.5: Repository Deep Agent Evidence Analysis

Status: review

## Story

As LCSP, I want the Repository Deep Agent to derive technical evidence directly from the assessment repository, so evidence is source-grounded and is not constrained by a predefined language-specific scanner pipeline.

## Acceptance Criteria

1. **Given** the assessment repository is hydrated in the managed sandbox
   **When** repository analysis begins
   **Then** the Deep Agent inventories the actual languages, frameworks, build/config/runtime surfaces
   **And** investigates material source paths with native filesystem, search, shell, planning, and subagent capabilities.

2. **Given** Codebase Memory MCP 0.11.0 is available
   **When** structural discovery or relationship lookup can accelerate analysis
   **Then** the agent may use its index, architecture, graph search, trace, change-detection, and coverage capabilities
   **And** material conclusions are verified against direct repository source
   **And** direct source wins if graph memory disagrees.

3. **Given** a technical claim is decided
   **When** the structured repository-analysis result is emitted
   **Then** the claim contains bounded repository-relative source locations
   **And** the result includes coverage state, unresolved frontiers, compatibility evidence graph data, and AI-discovery state.

4. **Given** LCSP considers `AI_ABSENT_CONFIRMED`
   **When** global or AI coverage is partial, or a material generated/dynamic/configured/binary/runtime frontier remains unresolved
   **Then** the result remains partial or unknown
   **And** `AI_ABSENT_CONFIRMED` is not emitted.

5. **Given** analysis finishes
   **When** TechnicalEvidenceReport compatibility payloads are produced
   **Then** raw source, secrets, full prompts, and unbounded command output are excluded from persisted/audit/runtime metadata.

## Tasks / Subtasks

- [ ] Run repository analysis through the native Deep Agent graph and LCSP Docker repository backend.
- [ ] Use native Deep Agents capabilities instead of LCSP-authored language analyzers.
- [ ] Integrate optional Codebase Memory MCP 0.11.0 as structural memory.
- [ ] Build source-grounded evidence, coverage, unresolved-frontier, and AI-discovery output.
- [ ] Preserve TechnicalEvidenceReport/evidence-graph compatibility contracts for downstream consumers.
- [ ] Validate absence-gate behavior and source-grounding with regression and real Codebase Memory E2E tests.

## Explicit Non-Goals

- No Semgrep/Syft/Knip/Deptry orchestration.
- No AST/CST, ts-morph, tree-sitter, or language-adapter pipeline authored by LCSP.
- No graph-memory result treated as source authority.
- No customer application dependency installation or execution.
- No legal applicability/classification decision in repository analysis.

## Verification

- `deepagents/tests/integration/test_codebase_memory_mda_e2e.py`
- `deepagents/tests/investigation/test_native_tool_investigator.py`
- `deepagents/tests/investigation/test_engineering_rule_planner.py`
- `deepagents/tests/test_deep_agent_subagent_contract.py`
- `deepagents/tests/test_runtime_capability_layout.py`
- API scan/evidence callback E2E tests

## References

- `docs/architecture/repository-deep-agent-analysis.md`
- `deepagents/instructions.md`
- `deepagents/subagents/investigator/definition.py`
- `deepagents/tools/common/capabilities/evidence/repository_analysis/analyzer.py`
- `deepagents/tools/common/capabilities/evidence/repository_analysis/boundary.py`
- `deepagents/sandbox/setup.sh`
- `docs/specs/program-evidence-graph-spec.md`
