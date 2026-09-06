import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../src/", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("runtime sidebar preview is development-gated and uses the real sidebar", async () => {
  const [sidebar, fixture, shell] = await Promise.all([
    read("features/assessment-runtime/components/organisms/assessment-runtime-sidebar.tsx"),
    read("features/assessment-runtime/dev/assessment-runtime-sidebar-preview.ts"),
    read("features/workspace/components/organisms/assessment-app-shell.tsx"),
  ]);

  assert.match(sidebar, /process\.env\.NODE_ENV === "development"/);
  assert.match(sidebar, /preview.*runtime-sidebar/);
  assert.match(sidebar, /createAssessmentRuntimeSidebarPreview/);
  assert.match(sidebar, /useAssessmentRuntimeViewModel/);
  assert.match(fixture, /NormalizedAssessmentRuntime/);
  assert.match(fixture, /payment-service/);
  assert.match(fixture, /feat\/payment-risk-controls/);
  for (const label of ["Repository", "Scanner", "Interview", "Rules", "Planner", "Investigate", "Gate"]) {
    assert.match(fixture, new RegExp(`label: "${label}"`));
  }
  assert.match(shell, /<AssessmentRuntimeSidebar/);
});

test("runtime sidebar preview supplements, but does not replace, production workflow normalization", async () => {
  const [fixture, adapter] = await Promise.all([
    read("features/assessment-runtime/dev/assessment-runtime-sidebar-preview.ts"),
    read("features/workspace/utils/assessment-runtime-adapter.ts"),
  ]);

  assert.match(fixture, /Development-only Figma fixture/);
  for (const label of ["rules", "planner", "gate"]) {
    assert.match(adapter, new RegExp(`assessmentSidebar\\.workflow\\.${label}`));
  }
});
