import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../src/", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("the context panel renders canonical context only and is mounted twice by the shell (panel + sheet)", async () => {
  const [panel, shell, slots] = await Promise.all([
    read(
      "features/assessment-runtime/components/organisms/assessment-context-panel.tsx",
    ),
    read("features/workspace/components/organisms/assessment-app-shell.tsx"),
    read("features/workspace/components/organisms/assessment-shell-slots.tsx"),
  ]);

  assert.match(panel, /useAssessmentDetailQuery/);
  assert.match(panel, /useRepositorySetupQuery/);
  assert.match(panel, /customerAssessmentState/);
  assert.doesNotMatch(
    panel,
    /useAssessmentRuntimeViewModel|WorkflowStatusList|ArtifactEvidenceRail|CanonicalAssessmentActivity|canonicalEvents/,
  );
  assert.match(
    shell,
    /<AssessmentRightPanelSlot open=\{rightPanelOpen\}>[\s\S]*<AssessmentContextPanel/,
  );
  assert.match(
    shell,
    /<SheetContent side="right"[\s\S]*<AssessmentContextPanel/,
  );
  assert.match(panel, /h-full min-h-0 w-full flex-col[^"]*overflow-y-auto/);
  assert.match(slots, /h-full min-h-0 w-80 shrink-0 overflow-hidden/);
});

test("the context panel does not reconstruct workflow from screen or F-state branches", async () => {
  const panel = await read(
    "features/assessment-runtime/components/organisms/assessment-context-panel.tsx",
  );
  assert.doesNotMatch(panel, /F0[0-9]|F1[0-6]|screen\s*===|route\s*===/);
});
