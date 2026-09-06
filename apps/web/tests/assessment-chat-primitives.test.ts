import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const composerPath = new URL(
  "../src/features/workspace/components/organisms/assessment-composer.tsx",
  import.meta.url,
);
const transcriptPath = new URL(
  "../src/features/workspace/components/organisms/assessment-transcript.tsx",
  import.meta.url,
);
const overviewPath = new URL(
  "../src/features/workspace/components/organisms/assessment-overview.tsx",
  import.meta.url,
);
const shellSlotsPath = new URL(
  "../src/features/workspace/components/organisms/assessment-shell-slots.tsx",
  import.meta.url,
);
const agentTurnPath = new URL(
  "../src/features/workspace/components/molecules/agent-turn.tsx",
  import.meta.url,
);
const singleSelectPath = new URL(
  "../src/features/workspace/components/molecules/chat-single-select.tsx",
  import.meta.url,
);
const toolActivityPath = new URL(
  "../src/features/workspace/components/molecules/tool-activity-row.tsx",
  import.meta.url,
);
const turnFooterPath = new URL(
  "../src/features/workspace/components/molecules/turn-footer.tsx",
  import.meta.url,
);
const selectionHistoryPath = new URL(
  "../src/features/workspace/components/molecules/selection-history-row.tsx",
  import.meta.url,
);
const resultContainerPath = new URL(
  "../src/features/workspace/components/molecules/chat-result-container.tsx",
  import.meta.url,
);
const scannerStepPath = new URL(
  "../src/features/assessment-flow/components/organisms/scanner-step.tsx",
  import.meta.url,
);
const sharedProgramEvidenceSummaryPath = new URL(
  "../src/features/workspace/components/molecules/program-evidence-summary.tsx",
  import.meta.url,
);
const typesPath = new URL(
  "../src/features/workspace/types/assessment-chat.types.ts",
  import.meta.url,
);

const primitivePaths = [
  agentTurnPath,
  singleSelectPath,
  toolActivityPath,
  turnFooterPath,
  selectionHistoryPath,
  resultContainerPath,
];

test("assessment transcript is the shared scrollable 680px rail primitive", async () => {
  const source = await readFile(transcriptPath, "utf8");

  assert.match(source, /export function AssessmentTranscript/);
  assert.match(source, /export function ChatRail/);
  assert.match(source, /data-slot="assessment-transcript"/);
  assert.match(source, /data-slot="chat-rail"/);
  assert.match(source, /role="log"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /no-scrollbar min-h-0 flex-1 overflow-x-hidden/);
  assert.match(source, /overflow-y-auto/);
  assert.match(source, /max-w-170/);
  assert.doesNotMatch(source, /max-w-\[760px\]/);
});

test("assessment transcript follows output only while the reader is near latest content", async () => {
  const source = await readFile(transcriptPath, "utf8");

  assert.match(source, /AUTO_FOLLOW_THRESHOLD_PX = 80/);
  assert.match(source, /isFollowingLatestRef = useRef\(true\)/);
  assert.match(source, /function handleScroll/);
  assert.match(source, /isNearLatest\(event\.currentTarget\)/);
  assert.match(
    source,
    /if \(!isFollowingLatestRef\.current && !isNearLatest\(viewport\)\)/,
  );
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /behavior: prefersReducedMotion \? "auto" : "smooth"/);
  assert.match(source, /viewport\.scrollTo/);
  assert.doesNotMatch(source, /scrollIntoView/);
});

test("assessment overview gates Interview behind repository and scanner runtime", async () => {
  const source = await readFile(overviewPath, "utf8");

  assert.match(source, /const autoScrollKey = \[/);
  assert.match(source, /deriveAssessmentFlowRuntime/);
  assert.match(source, /ASSESSMENT_FLOW_STAGES\.repositorySetup/);
  assert.match(source, /ASSESSMENT_FLOW_STAGES\.interview/);
  assert.match(source, /interviewEnabled/);
  assert.match(source, /interviewQuery\.dataUpdatedAt/);
  assert.match(
    source,
    /<AssessmentTranscript autoScrollKey=\{autoScrollKey\}>/,
  );
});

test("assessment composer keeps the approved 720 by 76 single-send control", async () => {
  const source = await readFile(composerPath, "utf8");

  assert.match(source, /mb-4 h-19 w-full max-w-180/);
  assert.match(source, /shrink-0/);
  assert.match(source, /rounded-\[18px\]/);
  assert.equal(source.match(/<Textarea\b/g)?.length, 1);
  assert.equal(source.match(/<Button\b/g)?.length, 1);
  assert.match(source, /CornerDownLeftIcon/);
  assert.doesNotMatch(source, /PlusIcon|<input\b|avatar|brand label/i);
  assert.doesNotMatch(source, /h-12 w-full max-w-\[760px\]/);
});

test("assessment center keeps the transcript scrollable above a bottom composer", async () => {
  const shellSlotsSource = await readFile(shellSlotsPath, "utf8");
  const overviewSource = await readFile(overviewPath, "utf8");

  assert.match(
    shellSlotsSource,
    /mx-auto flex h-full min-h-0 w-full max-w-180 flex-col/,
  );
  assert.match(shellSlotsSource, /min-h-0 flex-1 overflow-hidden/);
  assert.match(overviewSource, /className="flex h-full min-h-0 flex-col"/);
  assert.ok(
    overviewSource.indexOf("<AssessmentTranscript") <
      overviewSource.indexOf("<AssessmentComposer"),
  );
});

test("assessment composer uses one submit path for Enter, Send, disabled, and IME behavior", async () => {
  const source = await readFile(composerPath, "utf8");

  assert.match(source, /function handleSubmit/);
  assert.match(source, /if \(sendDisabled\)/);
  assert.match(source, /onSubmit\(\)/);
  assert.match(source, /event\.key !== "Enter"/);
  assert.match(source, /event\.shiftKey/);
  assert.match(source, /event\.nativeEvent\.isComposing/);
  assert.match(source, /event\.currentTarget\.form\?\.requestSubmit\(\)/);
  assert.equal(source.match(/onSubmit\(\)/g)?.length, 1);
});

test("agent turn groups agent blocks and places terminal actions before the footer", async () => {
  const source = await readFile(agentTurnPath, "utf8");

  assert.match(source, /data-slot="agent-turn"/);
  assert.match(source, /terminalAction\?: ReactNode/);
  assert.match(source, /data-slot="agent-turn-terminal-action"/);
  assert.match(source, /children \? \(/);
  assert.match(
    source,
    /<div className=\{cn\(content && "mt-3"\)\}>\{children\}/,
  );
  assert.match(source, /footer \? <div className="mt-3">/);
  assert.ok(
    source.indexOf('data-slot="agent-turn-terminal-action"') <
      source.indexOf('footer ? <div className="mt-3">'),
  );
  assert.doesNotMatch(source, /max-w-\[45%\] flex-none self-start/);
  assert.doesNotMatch(source, /chain.of.thought|reasoning/i);
});

test("agent, user, thought, and thinking message primitives are reusable presentation only", async () => {
  const source = await readFile(agentTurnPath, "utf8");

  assert.match(source, /export function AgentMessage/);
  assert.match(source, /export function UserMessage/);
  assert.match(source, /export function ThoughtLine/);
  assert.match(source, /export function ThinkingLine/);
  assert.match(source, /data-slot="agent-message"/);
  assert.match(source, /data-slot="user-message"/);
  assert.match(source, /data-slot="thought-line"/);
  assert.match(source, /data-slot="thinking-line"/);
  assert.match(source, /pages\.appShell\.chatThinking/);
});

test("turn footer defaults to the Figma timestamp plus copy action layout below content", async () => {
  const source = await readFile(turnFooterPath, "utf8");

  assert.match(source, /timestamp\?: string/);
  assert.match(source, /onCopy\?: \(\) => void/);
  assert.match(source, /CopyIcon/);
  assert.match(source, /pages\.appShell\.chatCopy/);
  assert.match(source, /justify-start/);
  assert.match(source, /min-h-7\.5/);
  assert.match(source, /aria-label=\{copyLabel\}/);
  assert.doesNotMatch(source, /justify-end/);
});

test("chat single select uses generic exclusive radio-row semantics and selected visual state", async () => {
  const source = await readFile(singleSelectPath, "utf8");

  assert.match(source, /role="radiogroup"/);
  assert.match(source, /role="radio"/);
  assert.match(source, /aria-checked=\{selected\}/);
  assert.match(source, /onValueChange\(option\.id\)/);
  assert.match(source, /ArrowDown|ArrowRight|ArrowUp|ArrowLeft|Home|End/);
  assert.match(source, /h-9 min-w-0 items-center/);
  assert.match(source, /rounded-xl border border-input bg-card/);
  assert.match(source, /bg-chart-3\/20/);
  assert.doesNotMatch(source, /GitHub|GitLab|Bitbucket|Azure DevOps/);
  assert.doesNotMatch(source, /CheckIcon|items-start/);
});

test("selection history preserves the submitted value as compact transcript history", async () => {
  const source = await readFile(selectionHistoryPath, "utf8");

  assert.match(source, /selectedValue/);
  assert.match(source, /selection-history-row/);
  assert.match(source, /min-h-6/);
  assert.match(source, /rounded-full bg-primary/);
  assert.doesNotMatch(source, /<button|role="radio"|CheckIcon|bg-muted\/40/);
});

test("tool activity list and row support reusable Running, Done, and Failed semantics", async () => {
  const [source, typesSource] = await Promise.all([
    readFile(toolActivityPath, "utf8"),
    readFile(typesPath, "utf8"),
  ]);

  assert.match(source, /export function ToolActivityList/);
  assert.match(source, /export function ToolActivityRow/);
  assert.match(source, /data-slot="tool-activity-list"/);
  assert.match(source, /data-slot="tool-activity-row"/);
  assert.match(source, /icon\?: ReactNode/);
  assert.match(source, /text-primary/);
  assert.match(source, /text-brand/);
  assert.match(source, /text-destructive/);
  assert.match(source, /animate-spin motion-reduce:animate-none/);
  assert.match(typesSource, /running: "running"/);
  assert.match(typesSource, /completed: "completed"/);
  assert.match(typesSource, /failed: "failed"/);
});

test("chat result container stays domain-neutral and wraps chat results", async () => {
  const source = await readFile(resultContainerPath, "utf8");

  assert.match(source, /data-slot="chat-result-container"/);
  assert.match(source, /w-full max-w-170 min-w-0 overflow-hidden/);
  assert.match(source, /title\?: string/);
  assert.match(source, /children\?: ReactNode/);
  assert.match(source, /break-words/);
  assert.doesNotMatch(source, /Program Evidence|Findings|Investigation/);
});

test("scanner renders the dedicated Program Evidence Graph artifact only after evidence is ready", async () => {
  const [scannerSource, artifactSource] = await Promise.all([
    readFile(scannerStepPath, "utf8"),
    readFile(sharedProgramEvidenceSummaryPath, "utf8"),
  ]);

  assert.match(scannerSource, /ProgramEvidenceSummary/);
  assert.match(scannerSource, /evidenceReady \? \(/);
  assert.doesNotMatch(scannerSource, /ChatResultContainer/);
  assert.doesNotMatch(
    scannerSource,
    /pages\.assessmentFlow\.graph\.repository/,
  );
  assert.doesNotMatch(scannerSource, /pages\.assessmentFlow\.graph\.commit/);
  assert.match(artifactSource, /ChatResultContainer/);
  assert.match(artifactSource, /pages\.assessmentFlow\.graph\.servicesScanned/);
  assert.match(
    artifactSource,
    /pages\.assessmentFlow\.graph\.codeSymbolsIndexed/,
  );
  assert.match(
    artifactSource,
    /pages\.assessmentFlow\.graph\.aiProviderCallPaths/,
  );
  assert.match(
    artifactSource,
    /pages\.assessmentFlow\.graph\.evidenceMappedScope/,
  );
  assert.match(
    artifactSource,
    /pages\.assessmentFlow\.graph\.viewEvidenceGraph/,
  );
});

test("assessment overview does not append raw runtime activity to the customer transcript", async () => {
  const source = await readFile(overviewPath, "utf8");

  assert.doesNotMatch(source, /workflowRunTitle/);
  assert.doesNotMatch(source, /workflowRunDescription/);
  assert.doesNotMatch(source, /workflow\.recentActivity\.slice/);
  assert.doesNotMatch(source, /<ToolActivityList>/);
  assert.doesNotMatch(source, /Repository scan run completed/);
  assert.doesNotMatch(source, /Technical evidence callback submitted/);
  assert.doesNotMatch(source, /Technical evidence callback was accepted/);
});

test("structured chat primitives stay presentational and do not introduce chat network calls", async () => {
  for (const path of primitivePaths) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(
      source,
      /fetch\(|useMutation|useQuery|@\/lib\/api|\/api\/v1\/chat/,
    );
  }
});

test("chat primitives use theme tokens and keep dark-light state out of component logic", async () => {
  for (const path of primitivePaths) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}/);
  }

  const combinedSource = (
    await Promise.all(primitivePaths.map((path) => readFile(path, "utf8")))
  ).join("\n");
  assert.match(combinedSource, /bg-card/);
  assert.match(combinedSource, /text-foreground/);
  assert.match(combinedSource, /text-muted-foreground/);
});
