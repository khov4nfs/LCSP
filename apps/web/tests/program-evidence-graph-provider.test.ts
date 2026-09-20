import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const providerPath = new URL(
  "../src/features/assessment-runtime/components/organisms/program-evidence-graph-drawer.tsx",
  import.meta.url,
);

test("refetches graph detail when opening after an unavailable initial result", async () => {
  const source = await readFile(providerPath, "utf8");

  assert.match(source, /const loadDetail = useCallback/);
  assert.match(source, /getProgramEvidenceGraphDetailState\(assessmentId\)/);
  assert.match(
    source,
    /setDetail\(value\.detail\);\s*setLoadState\(value\.state\);/,
  );
  assert.match(
    source,
    /setDetail\(null\);\s*setLoadState\(PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES\.unavailable\);/,
  );

  const openBlock = source.slice(
    source.indexOf("const openArtifact"),
    source.indexOf("useEffect(() =>", source.indexOf("const openArtifact")),
  );
  assert.match(openBlock, /setOpen\(true\)/);
  assert.match(openBlock, /loadDetail\(\)/);

  const providerBody = source.slice(
    source.indexOf("export function ProgramEvidenceGraphProvider"),
  );
  const effects =
    providerBody.match(/useEffect\(\(\) =>[\s\S]*?\n  \}, \[[^\]]*\]\);/g) ??
    [];
  assert.equal(
    effects.some((effect) => effect.includes("loadDetail()")),
    false,
  );
  assert.match(source, /requestVersionRef/);
});

test("keeps polling only while the open drawer's graph is still building", async () => {
  const source = await readFile(providerPath, "utf8");
  const pollEffect = source.slice(
    source.indexOf("A building graph is not an error"),
    source.indexOf("}, [open, loading, loadState, loadDetail]);"),
  );

  assert.match(
    pollEffect,
    /loadState !== PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES\.pending/,
  );
  assert.match(pollEffect, /!open/);
  assert.match(
    pollEffect,
    /setTimeout\(\s*loadDetail\s*,\s*PROGRAM_EVIDENCE_GRAPH_PENDING_POLL_MS\s*,?\s*\)/,
  );
  assert.match(pollEffect, /clearTimeout\(timer\)/);
  assert.match(
    source,
    /PROGRAM_EVIDENCE_GRAPH_UNAVAILABLE_MESSAGE_KEYS\[loadState\]/,
  );
});
