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
const agentTurnPath = new URL(
  "../src/features/workspace/components/molecules/agent-turn.tsx",
  import.meta.url,
);
const structuredPrimitivePaths = [
  "../src/features/workspace/components/molecules/chat-single-select.tsx",
  "../src/features/workspace/components/molecules/tool-activity-row.tsx",
  "../src/features/workspace/components/molecules/turn-footer.tsx",
  "../src/features/workspace/components/molecules/selection-history-row.tsx",
  "../src/features/workspace/components/molecules/chat-result-container.tsx",
].map((path) => new URL(path, import.meta.url));

test("assessment composer keeps the approved 760 by 48 single-send control", async () => {
  const source = await readFile(composerPath, "utf8");

  assert.match(source, /h-12 w-full max-w-\[760px\]/);
  assert.equal(source.match(/<Textarea\b/g)?.length, 1);
  assert.equal(source.match(/<Button\b/g)?.length, 1);
  assert.match(source, /ArrowUpIcon/);
  assert.doesNotMatch(source, /PlusIcon|<input\b/);
});

test("assessment composer uses Enter to submit and Shift+Enter to keep a newline", async () => {
  const source = await readFile(composerPath, "utf8");

  assert.match(source, /event\.key !== "Enter"/);
  assert.match(source, /event\.shiftKey/);
  assert.match(source, /event\.nativeEvent\.isComposing/);
  assert.match(source, /requestSubmit\(\)/);
});

test("assessment transcript retains a scrollable 760px history lane and honors reduced motion", async () => {
  const source = await readFile(transcriptPath, "utf8");

  assert.match(source, /overflow-y-auto/);
  assert.match(source, /max-w-\[760px\]/);
  assert.match(source, /flex-col gap-4/);
  assert.match(source, /autoScrollKey/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /role="log"/);
});

test("agent turn keeps user and agent content in one continuous turn container", async () => {
  const source = await readFile(agentTurnPath, "utf8");

  assert.match(source, /data-slot="agent-turn"/);
  assert.match(source, /isUser \? "justify-end" : "justify-start"/);
  assert.match(source, /rounded-2xl bg-muted/);
  assert.match(source, /children/);
  assert.match(source, /footer/);
  assert.match(source, /max-w-\[45%\] flex-none self-start/);
  assert.match(source, /flex min-w-0 items-start gap-2/);
  assert.doesNotMatch(source, /Card|chain.of.thought|reasoning/i);
});

test("structured chat primitives stay presentational and do not introduce chat network calls", async () => {
  for (const path of structuredPrimitivePaths) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(
      source,
      /fetch\(|useMutation|useQuery|@\/lib\/api|\/api\/v1\/chat/,
    );
  }
});

test("selection history preserves the chosen value for transcript review", async () => {
  const selectionHistorySource = await readFile(
    structuredPrimitivePaths[3],
    "utf8",
  );
  assert.match(selectionHistorySource, /selectedValue/);
  assert.match(selectionHistorySource, /selection-history-row/);
});

test("turn footer wraps actions instead of forcing the center lane wider", async () => {
  const footerSource = await readFile(structuredPrimitivePaths[2], "utf8");
  assert.match(footerSource, /flex-wrap/);
  assert.match(footerSource, /max-w-full/);
  assert.match(footerSource, /justify-end/);
});

test("tool activity content can shrink inside the center pane", async () => {
  const activitySource = await readFile(structuredPrimitivePaths[1], "utf8");
  assert.match(activitySource, /max-w-full min-w-0/);
  assert.match(activitySource, /overflow-wrap:anywhere/);
});
