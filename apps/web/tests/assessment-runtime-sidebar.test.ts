import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../src/", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("runtime sidebar renders canonical assessment state, repository setup and canonical activity", async () => {
  const [sidebar, shell, slots] = await Promise.all([
    read("features/assessment-runtime/components/organisms/assessment-runtime-sidebar.tsx"),
    read("features/workspace/components/organisms/assessment-app-shell.tsx"),
    read("features/workspace/components/organisms/assessment-shell-slots.tsx"),
  ]);

  assert.match(sidebar, /useAssessmentDetailQuery/);
  assert.match(sidebar, /useRepositorySetupQuery/);
  assert.match(sidebar, /CanonicalAssessmentStatus/);
  assert.match(sidebar, /CanonicalAssessmentActivity/);
  assert.match(sidebar, /timeline\.canonicalEvents/);
  assert.doesNotMatch(sidebar, /useAssessmentRuntimeViewModel|WorkflowStatusList|ArtifactEvidenceRail/);
  assert.match(shell, /<AssessmentRightPanelSlot open=\{rightPanelOpen\}>[\s\S]*<AssessmentRuntimeSidebar/);
  assert.match(shell, /<SheetContent side="right"[\s\S]*<AssessmentRuntimeSidebar/);
  assert.match(sidebar, /h-full min-h-0 w-full flex-col overflow-y-auto/);
  assert.match(slots, /h-full min-h-0 w-105 shrink-0 overflow-hidden/);
});

test("repository context card renders the matching provider logo beside the provider name", async () => {
  const card = await read("features/assessment-runtime/components/molecules/repository-context-card.tsx");

  assert.match(card, /ASSESSMENT_REPOSITORY_PROVIDERS/);
  assert.match(card, /logo-github\.svg/);
  assert.match(card, /logo-gitlab\.svg/);
  assert.match(card, /logo-bitbucket\.svg/);
  assert.match(card, /logo-azure-devops\.svg/);
  assert.match(card, /<ProviderIcon provider=\{repository\.provider\}/);
  assert.match(card, /data-provider-icon=\{provider\}/);
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
