import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../src/", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("runtime sidebar consumes normalized runtime data and the shared artifact contract", async () => {
  const [sidebar, row, shell, adapter] = await Promise.all([
    read("features/assessment-runtime/components/organisms/assessment-runtime-sidebar.tsx"),
    read("features/assessment-runtime/components/molecules/artifact-evidence-row.tsx"),
    read("features/workspace/components/organisms/assessment-app-shell.tsx"),
    read("features/workspace/types/assessment-runtime-adapter.types.ts"),
  ]);

  assert.match(sidebar, /useAssessmentRuntimeViewModel/);
  assert.match(sidebar, /RepositoryContextCard/);
  assert.match(sidebar, /WorkflowStatusList/);
  assert.match(sidebar, /ArtifactEvidenceRail/);
  assert.match(row, /buildArtifactOpenTarget/);
  assert.match(row, /ArtifactStatusBadge/);
  assert.match(adapter, /steps: NormalizedWorkflowStep\[\]/);
  assert.match(adapter, /pinnedCommit/);
  assert.match(shell, /<AssessmentRightPanelSlot open=\{rightPanelOpen\}>[\s\S]*<AssessmentRuntimeSidebar/);
  assert.match(shell, /<SheetContent side="right"[\s\S]*<AssessmentRuntimeSidebar/);
  assert.match(shell, /min-h-0 min-w-0 flex-1 flex-col overflow-hidden/);
  assert.match(sidebar, /h-full min-h-0 w-full flex-col overflow-hidden/);
  assert.match(sidebar, /min-h-0 flex-1[\s\S]*overflow-y-auto/);
  assert.match(
    await read("features/workspace/components/organisms/assessment-shell-slots.tsx"),
    /h-full min-h-0 w-105 shrink-0 overflow-hidden/,
  );
});

test("runtime sidebar does not reconstruct workflow from screen or F-state branches", async () => {
  const sidebar = await read("features/assessment-runtime/components/organisms/assessment-runtime-sidebar.tsx");
  assert.doesNotMatch(sidebar, /F0[0-9]|F1[0-6]|screen\s*===|route\s*===/);
});

test("runtime artifact labels use defined localized message keys and target-aware affordances", async () => {
  const [adapter, row] = await Promise.all([
    read("features/workspace/utils/assessment-runtime-adapter.ts"),
    read("features/assessment-runtime/components/molecules/artifact-evidence-row.tsx"),
  ]);
  assert.match(adapter, /artifacts\.types\.programEvidenceGraph/);
  assert.match(adapter, /artifacts\.types\.businessContext/);
  assert.match(adapter, /artifacts\.types\.investigationNotes/);
  assert.doesNotMatch(adapter, /artifacts\.(programEvidenceGraph|businessContext|investigationNotes)\.label/);
  assert.match(row, /target\.kind !== ARTIFACT_OPEN_KINDS\.unsupported/);
});
