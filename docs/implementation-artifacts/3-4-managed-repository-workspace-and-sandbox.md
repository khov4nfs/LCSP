# Story 3.4: Managed Repository Workspace and Sandbox

Status: ready-for-dev

## Story

As LCSP, I want each assessment to hydrate its commit-pinned repository snapshot into the durable LCSP Docker repository sandbox, so repository investigation is isolated, reproducible, and source-grounded.

## Acceptance Criteria

1. **Given** a RepositoryScanJob references an immutable RepositorySnapshot
   **When** the managed repository-analysis boundary starts
   **Then** the pinned snapshot is hydrated into `/workspace/repository`
   **And** that repository is the Deep Agent filesystem root
   **And** `.git/` and `.lcsp/` are runtime bookkeeping rather than customer evidence.

2. **Given** repository analysis is running
   **When** the Deep Agent uses filesystem, search, shell, planning, or subagent capabilities
   **Then** execution remains inside the assessment-scoped managed sandbox
   **And** customer dependencies are not installed
   **And** the customer application is not executed as part of evidence derivation.

3. **Given** an assessment thread already owns a valid repository working database for the pinned snapshot
   **When** a later managed event resumes that assessment
   **Then** LCSP reuses the same durable thread and sandbox backend
   **And** does not materialize an independent second checkout.

4. **Given** generated, dynamic, unreadable, binary, configured, or runtime-only material cannot be resolved safely
   **When** repository coverage is finalized
   **Then** the unresolved area is recorded as a coverage limitation
   **And** exhaustive or absence claims remain blocked where that limitation is material.

## Tasks / Subtasks

- [ ] Resolve the assessment's durable MDA thread and repository backend.
- [ ] Hydrate the exact pinned snapshot into `/workspace/repository`.
- [ ] Expose repository-rooted Deep Agents filesystem/search/shell capabilities.
- [ ] Keep runtime metadata outside customer evidence and prevent a second host-local checkout.
- [ ] Preserve explicit coverage limitations for unresolved material surfaces.
- [ ] Verify sandbox reuse, repository-root virtualization, and source-safety with automated tests.

## Architecture Compliance

- Repository analysis is owned by LCSP Agent Runtime, not a standalone scanner worker.
- NestJS remains the synchronous control plane and snapshot/job authority.
- Direct repository source is authoritative evidence.
- No custom language-specific scanner pipeline, package installation, or customer application execution is required.
- Raw customer source is not copied into normal LCSP persistence, audit metadata, or queue payloads.

## Verification

- `deepagents/tests/test_managed_assessment_sandbox.py`
- `deepagents/tests/test_managed_deep_agent_project.py`
- repository snapshot and worker-runtime contract tests
- `uv run python -m pytest tests/integration/test_docker_sandbox_e2e.py tests/integration/test_local_agent_runtime_e2e.py`

## References

- `docs/architecture/repository-deep-agent-analysis.md`
- `deepagents/instructions.md`
- `deepagents/sandbox/setup.sh`
- `deepagents/tools/common/capabilities/platform/managed_workspace.py`
- `deepagents/tools/common/capabilities/platform/repository_workspace.py`
- `deepagents/tools/common/capabilities/platform/repository_snapshot_client.py`
- `docs/implementation/python-worker-platform-implementation.md`
- `docs/implementation/queue-implementation.md`
