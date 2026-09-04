import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const shellPath = new URL(
  "../src/features/workspace/components/organisms/assessment-app-shell.tsx",
  import.meta.url,
);
const slotPath = new URL(
  "../src/features/workspace/components/organisms/assessment-shell-slots.tsx",
  import.meta.url,
);
const statePath = new URL(
  "../src/features/workspace/types/assessment-shell-state.types.ts",
  import.meta.url,
);
const navigationPath = new URL(
  "../src/features/workspace/config/app-shell-navigation.ts",
  import.meta.url,
);
const workspaceClientPath = new URL(
  "../src/lib/api/workspace-client.ts",
  import.meta.url,
);
const createAssessmentPath = new URL(
  "../src/features/workspace/components/organisms/create-assessment-form.tsx",
  import.meta.url,
);
const summaryCardPath = new URL(
  "../src/features/workspace/components/molecules/assessment-summary-card.tsx",
  import.meta.url,
);
const legacyRoutePaths = [
  "../src/app/(workspace)/assessments/[id]/readiness/page.tsx",
  "../src/app/(workspace)/assessments/[id]/technical-evidence/page.tsx",
  "../src/app/(workspace)/assessments/[id]/classification/page.tsx",
  "../src/app/(workspace)/assessments/[id]/documents/page.tsx",
  "../src/app/(workspace)/assessments/[id]/conflicts/page.tsx",
].map((path) => new URL(path, import.meta.url));

test("assessment app shell exposes the LCSP-267 state machine and slots", async () => {
  const [shellSource, slotSource, stateSource] = await Promise.all([
    readFile(shellPath, "utf8"),
    readFile(slotPath, "utf8"),
    readFile(statePath, "utf8"),
  ]);

  assert.match(stateSource, /export type AssessmentShellState/);
  assert.match(stateSource, /ASSESSMENT_SHELL_SCREENS/);
  assert.match(stateSource, /workspace: "workspace"/);
  assert.match(stateSource, /legal: "legal"/);
  assert.match(stateSource, /ASSESSMENT_LEFT_SIDEBAR_STATES/);
  assert.match(stateSource, /ASSESSMENT_RIGHT_PANEL_STATES/);
  assert.match(shellSource, /const \[shellState, setShellState\]/);
  assert.match(shellSource, /data-shell-screen/);
  assert.match(slotSource, /export function LeftSidebarSlot/);
  assert.match(slotSource, /export function CenterContentSlot/);
  assert.match(slotSource, /export function AssessmentRightPanelSlot/);
});

test("workspace route uses the redesigned app shell instead of the legacy sidebar provider", async () => {
  const appShellSource = await readFile(
    new URL(
      "../src/features/workspace/components/organisms/app-shell.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.ok(appShellSource.includes('pathname === "/workspace"'));
  assert.ok(appShellSource.includes('pathname.startsWith("/workspace/")'));
  assert.ok(appShellSource.includes('pathname === "/laws"'));
  assert.match(appShellSource, /<AssessmentAppShell/);
  assert.doesNotMatch(appShellSource, /SidebarProvider|AppSidebar|AppHeader/);
});

test("assessment app shell keeps fixed desktop sidebar geometry without overlap", async () => {
  const slotSource = await readFile(slotPath, "utf8");

  assert.match(slotSource, /w-55/);
  assert.match(slotSource, /w-14/);
  assert.match(slotSource, /w-105/);
  assert.match(slotSource, /min-w-0 flex-1/);
  assert.match(slotSource, /hidden .*lg:flex/);
  assert.match(slotSource, /hidden .*xl:flex/);
});

test("assessment entry points no longer route progression through legacy step pages", async () => {
  const [navigationSource, clientSource, createSource, summarySource] =
    await Promise.all([
      readFile(navigationPath, "utf8"),
      readFile(workspaceClientPath, "utf8"),
      readFile(createAssessmentPath, "utf8"),
      readFile(summaryCardPath, "utf8"),
    ]);
  const combined = [
    navigationSource,
    clientSource,
    createSource,
    summarySource,
  ].join("\n");

  assert.doesNotMatch(
    combined,
    /\/(?:wizard|readiness|technical-evidence|classification|documents|conflicts)/,
  );
  assert.match(clientSource, /return `\/assessments\/\$\{encodedId\}`/);
  assert.match(
    createSource,
    /router\.push\(`\/assessments\/\$\{outcome\.assessmentId\}`\)/,
  );
});

test("deprecated assessment step routes redirect back to the shared shell", async () => {
  for (const path of legacyRoutePaths) {
    const source = await readFile(path, "utf8");

    assert.match(source, /import \{ redirect \} from "next\/navigation"/);
    assert.match(
      source,
      /redirect\(`\/assessments\/\$\{encodeURIComponent\(id\)\}`\)/,
    );
    assert.doesNotMatch(
      source,
      /WizardFormPage|ReadinessStatusPage|TechnicalEvidenceRuntimePage|ClassificationStatusPage|DocumentsPageClient|ConflictResolutionPage/,
    );
  }
});

test("wizard assessment route is removed from production routing", async () => {
  await assert.rejects(
    readFile(
      new URL(
        "../src/app/(workspace)/assessments/[id]/wizard/page.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    /ENOENT/,
  );
});
