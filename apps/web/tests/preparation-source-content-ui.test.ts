import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { LEGAL_DOCUMENT_NODE_TYPES } from "@lcsp/contracts/legal-source";
import type { MessageKey } from "@lcsp/i18n";
import { resolveAppMessage } from "../src/lib/i18n";
import { formatPreparationLegalSourceNodeLabel } from "../src/features/admin/components/molecules/preparation-source-content-reader";

test("semantic labels use persisted node types and never infer a legal title", () => {
  const articleType = resolveAppMessage(
    "pages.complianceRuleSets.sourceAnalysis.nodeTypes.ARTICLE" as MessageKey,
  );
  assert.equal(
    formatPreparationLegalSourceNodeLabel({
      nodeType: LEGAL_DOCUMENT_NODE_TYPES.ARTICLE,
      label: "3",
      title: "3",
    }),
    `${articleType} 3`,
  );
  assert.equal(
    formatPreparationLegalSourceNodeLabel({
      nodeType: LEGAL_DOCUMENT_NODE_TYPES.ARTICLE,
      label: "",
      title: "Persisted title",
    }),
    `${articleType}: Persisted title`,
  );
  assert.equal(
    formatPreparationLegalSourceNodeLabel({
      nodeType: LEGAL_DOCUMENT_NODE_TYPES.ARTICLE,
      label: "Article 3",
      title: "Article 3",
    }),
    "Article 3",
  );
});

test("pinned source reader appends text pages and never renders stored content as HTML", async () => {
  const reader = await readFile(
    new URL(
      "../src/features/admin/components/molecules/preparation-source-content-reader.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(reader, /usePreparationSourceNodeContentQuery/u);
  assert.match(reader, /pages\.map\(\(page\) => page\.content\)\.join\(""\)/u);
  assert.match(reader, /whitespace-pre-wrap/u);
  assert.match(reader, /setViewedNodeId\(child\.sourceNodeId\)/u);
  assert.doesNotMatch(reader, /dangerouslySetInnerHTML/u);
});

test("Claim metadata uses localized labels and has no mojibake separator", async () => {
  const modal = await readFile(
    new URL(
      "../src/features/admin/components/molecules/preparation-source-analysis-modal.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(modal, /sourceAnalysis\.claimType/u);
  assert.match(modal, /sourceAnalysis\.claimState/u);
  assert.doesNotMatch(modal, /Ã‚Â·|Â·/u);
});
