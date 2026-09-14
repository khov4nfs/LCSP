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
  assert.match(source, /setDetail\(value\);\s*setLoading\(false\);/);
  assert.match(source, /setDetail\(null\);\s*setLoading\(false\);/);

  const openBlock = source.slice(
    source.indexOf("const openArtifact"),
    source.indexOf("useEffect(() =>", source.indexOf("const openArtifact")),
  );
  assert.match(openBlock, /setOpen\(true\)/);
  assert.match(openBlock, /loadDetail\(\)/);

  const providerBody = source.slice(source.indexOf("export function ProgramEvidenceGraphProvider"));
  const effects = providerBody.match(/useEffect\(\(\) =>[\s\S]*?\n  \}, \[[^\]]*\]\);/g) ?? [];
  assert.equal(effects.some((effect) => effect.includes("loadDetail()")), false);
  assert.match(source, /requestVersionRef/);
});
