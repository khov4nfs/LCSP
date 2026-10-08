import assert from "node:assert/strict";
import { test } from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  LEGACY_ARTIFACT_AVAILABILITIES,
  LEGACY_ARTIFACT_RECONCILIATION_CLASSES,
  LEGACY_ARTIFACT_RECONCILIATION_REASONS,
  type LegacyArchiveReportItem,
} from "@lcsp/contracts/legacy-migration";
import { LegacyArchiveReportRow } from "../src/features/workspace/components/molecules/legacy-archive-report-row.tsx";
import { resolveAppMessage } from "../src/lib/i18n.ts";

const RECORD = "05437c7a-526b-c231-1bf5-fe4e391845b2";
const SHA = "a".repeat(64);

const report = (
  overrides: Partial<LegacyArchiveReportItem>,
): LegacyArchiveReportItem => ({
  recordId: RECORD,
  sourceTable: "DOCUMENT_REQUEST",
  documentType: "FINAL_REPORT",
  requestStatus: "READY",
  requestedAt: "2026-08-01T08:00:00.000Z",
  reconciliationClass:
    LEGACY_ARTIFACT_RECONCILIATION_CLASSES.NO_LEGACY_ARTIFACT_PRESENT,
  reconciliationReason:
    LEGACY_ARTIFACT_RECONCILIATION_REASONS.PLACEHOLDER_UPLOADER_NEVER_PERSISTED,
  availability: LEGACY_ARTIFACT_AVAILABILITIES.NOT_RETAINED,
  sizeBytes: null,
  contentSha256: null,
  ...overrides,
});

const render = (item: LegacyArchiveReportItem) =>
  renderToStaticMarkup(
    React.createElement(LegacyArchiveReportRow, {
      assessmentId: "a 1",
      report: item,
    }),
  );

test("a preserved original offers a native download anchor, with its real size and hash", () => {
  const html = render(
    report({
      reconciliationClass:
        LEGACY_ARTIFACT_RECONCILIATION_CLASSES.ARTIFACT_PRESENT_AND_COPIED,
      reconciliationReason:
        LEGACY_ARTIFACT_RECONCILIATION_REASONS.COPIED_AND_VERIFIED,
      availability: LEGACY_ARTIFACT_AVAILABILITIES.DOWNLOADABLE,
      sizeBytes: 123,
      contentSha256: SHA,
    }),
  );
  assert.match(
    html,
    /<a [^>]*href="\/api\/legacy-archive\/assessments\/a%201\/reports\/05437c7a-526b-c231-1bf5-fe4e391845b2\/download"/,
  );
  assert.doesNotMatch(html, /role=/);
  assert.ok(html.includes(SHA) && html.includes("123"));
  assert.ok(
    html.includes(
      resolveAppMessage("pages.legacyArchive.documentTypes.FINAL_REPORT"),
    ),
  );
});

test("anything that is not a preserved original has no download and says why, without inventing size or hash", () => {
  for (const availability of [
    LEGACY_ARTIFACT_AVAILABILITIES.NOT_RETAINED,
    LEGACY_ARTIFACT_AVAILABILITIES.METADATA_ONLY,
    LEGACY_ARTIFACT_AVAILABILITIES.UNAVAILABLE,
  ]) {
    const html = render(report({ availability }));
    assert.doesNotMatch(html, /<a /, availability);
    assert.doesNotMatch(html, /SHA-256|font-mono/u, availability);
    assert.ok(
      html.includes(
        resolveAppMessage(
          `pages.legacyArchive.availabilityDetail.${availability}`,
        ),
      ),
      `${availability} explains itself`,
    );
  }
});

test("the row never renders a storage location", () => {
  const html = render(report({}));
  assert.doesNotMatch(html, /mock-storage|file:|https?:\/\/[^"]*\.md/u);
});

test("an unknown document type falls back to a generic label", () => {
  const html = render(report({ documentType: "SOMETHING_NEW" }));
  assert.ok(
    html.includes(resolveAppMessage("pages.legacyArchive.documentTypes.OTHER")),
  );
});
