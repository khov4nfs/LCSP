import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../src/", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("runtime sidebar renders canonical assessment state, repository setup and canonical activity", async () => {
  const [sidebar, shell, slots] = await Promise.all([
    read(
      "features/assessment-runtime/components/organisms/assessment-runtime-sidebar.tsx",
    ),
    read("features/workspace/components/organisms/assessment-app-shell.tsx"),
    read("features/workspace/components/organisms/assessment-shell-slots.tsx"),
  ]);

  assert.match(sidebar, /useAssessmentDetailQuery/);
  assert.match(sidebar, /useRepositorySetupQuery/);
  assert.match(sidebar, /CanonicalAssessmentStatus/);
  assert.match(sidebar, /CanonicalAssessmentActivity/);
  assert.match(sidebar, /timeline\.canonicalEvents/);
  assert.doesNotMatch(
    sidebar,
    /useAssessmentRuntimeViewModel|WorkflowStatusList|ArtifactEvidenceRail/,
  );
  assert.match(
    shell,
    /<AssessmentRightPanelSlot open=\{rightPanelOpen\}>[\s\S]*<AssessmentRuntimeSidebar/,
  );
  assert.match(
    shell,
    /<SheetContent side="right"[\s\S]*<AssessmentRuntimeSidebar/,
  );
  assert.match(sidebar, /h-full min-h-0 w-full flex-col overflow-y-auto/);
  assert.match(slots, /h-full min-h-0 w-105 shrink-0 overflow-hidden/);
});

test("runtime sidebar does not reconstruct workflow from screen or F-state branches", async () => {
  const sidebar = await read(
    "features/assessment-runtime/components/organisms/assessment-runtime-sidebar.tsx",
  );
  assert.doesNotMatch(sidebar, /F0[0-9]|F1[0-6]|screen\s*===|route\s*===/);
});
