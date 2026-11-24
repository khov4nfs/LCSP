import assert from "node:assert/strict";
import { test } from "node:test";
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ASSESSMENT_RULE_IMPORT_SCHEMA_VERSION,
  ASSESSMENT_RULE_IMPORT_EXCLUSION_REASONS,
} from "@lcsp/contracts/legal-rule-catalog";
import { setAppLocale } from "../src/lib/locale.ts";
import { AssessmentRuleImportPanel } from "../src/features/admin/components/organisms/assessment-rule-import-panel.tsx";
import {
  ASSESSMENT_RULE_IMPORT_FILE_ISSUES,
  ASSESSMENT_RULE_IMPORT_MAX_FILES,
} from "../src/features/admin/config/legal-rule-catalog.config.ts";
import { parseAssessmentRuleImportDocument } from "../src/features/admin/schemas/assessment-rule-import-form.schema.ts";
import { byText, click, installFetch, render, settle } from "./support/dom.ts";

setAppLocale("en");

const CATALOG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOURCE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RULE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REVISION = 7;
const target = { catalogId: CATALOG, catalogRevision: REVISION };

const document_ = (override: Record<string, unknown> = {}) => ({
  schemaVersion: ASSESSMENT_RULE_IMPORT_SCHEMA_VERSION,
  catalogVersionId: CATALOG,
  expectedCatalogRevision: REVISION,
  legalSourceVersionId: SOURCE,
  dryRun: true,
  items: [],
  excludedItems: [
    {
      ruleId: RULE,
      reasonCode: ASSESSMENT_RULE_IMPORT_EXCLUSION_REASONS.CONTEXT_ONLY,
      reason: "Định nghĩa, không đặt nghĩa vụ.",
    },
  ],
  ...override,
});
const result = (dryRun: boolean) => ({
  catalogVersionId: CATALOG,
  catalogRevision: REVISION,
  legalSourceVersionId: SOURCE,
  dryRun,
  imported: [],
  excludedItems: document_().excludedItems,
});
const importRoute = `POST /api/admin/legal-rule-catalog/${CATALOG}/assessment-rules/import`;

test("parser accepts a v1 document for the selected catalog and revision", () => {
  const parsed = parseAssessmentRuleImportDocument(
    { name: "a.json", text: JSON.stringify(document_()) },
    target,
  );
  assert.equal(parsed.ok, true);
});

test("parser names why a file cannot be sent", () => {
  const issue = (text: string) => {
    const parsed = parseAssessmentRuleImportDocument(
      { name: "a.json", text },
      target,
    );
    return parsed.ok ? null : parsed.issue;
  };
  assert.equal(
    issue("{not json"),
    ASSESSMENT_RULE_IMPORT_FILE_ISSUES.INVALID_JSON,
  );
  assert.equal(
    issue(JSON.stringify({ schemaVersion: 1 })),
    ASSESSMENT_RULE_IMPORT_FILE_ISSUES.INVALID_DOCUMENT,
  );
  assert.equal(
    issue(JSON.stringify(document_({ legalRuleVersion: "x" }))),
    ASSESSMENT_RULE_IMPORT_FILE_ISSUES.INVALID_DOCUMENT,
  );
  assert.equal(
    issue(
      JSON.stringify(
        document_({ catalogVersionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }),
      ),
    ),
    ASSESSMENT_RULE_IMPORT_FILE_ISSUES.WRONG_CATALOG,
  );
  assert.equal(
    issue(JSON.stringify(document_({ expectedCatalogRevision: REVISION + 1 }))),
    ASSESSMENT_RULE_IMPORT_FILE_ISSUES.STALE_REVISION,
  );
  assert.ok(ASSESSMENT_RULE_IMPORT_MAX_FILES >= 18);
});

/** Hand a file list to the dialog's file input exactly as the browser would. */
async function chooseFiles(files: Array<{ name: string; text: string }>) {
  const input = document.querySelector<HTMLInputElement>(
    "#assessment-rule-import-files",
  );
  assert.ok(input, "file input is rendered");
  Object.defineProperty(input, "files", {
    configurable: true,
    value: files.map((file) => ({
      name: file.name,
      text: async () => file.text,
    })),
  });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AssessmentRuleImportPanel
        catalogId={CATALOG}
        catalogRevision={REVISION}
        onClose={() => undefined}
      />
    </QueryClientProvider>,
  );
}

test("a clean dry run unlocks the import, which then sends the same document for real", async () => {
  const fetchStub = installFetch({
    [importRoute]: result(true),
  });
  try {
    renderDialog();
    await settle();
    const importButton = () =>
      byText<HTMLButtonElement>(document.body, "button", "Import");
    assert.equal(importButton()?.disabled, true, "import starts locked");
    await chooseFiles([
      { name: "one.import.json", text: JSON.stringify(document_()) },
    ]);
    assert.match(document.body.textContent ?? "", /one\.import\.json/);
    assert.match(document.body.textContent ?? "", /Ready to check/);
    assert.equal(importButton()?.disabled, true, "still locked before a check");

    click(byText(document.body, "button", "Check (dry run)"));
    await settle();
    assert.equal(fetchStub.calls.length, 1);
    assert.equal(JSON.parse(fetchStub.calls[0].body ?? "{}").dryRun, true);
    assert.match(document.body.textContent ?? "", /Check passed/);
    assert.equal(
      importButton()?.disabled,
      false,
      "unlocked after a clean check",
    );

    fetchStub.restore();
    const importStub = installFetch({ [importRoute]: result(false) });
    try {
      click(importButton());
      await settle();
      assert.equal(importStub.calls.length, 1);
      assert.equal(JSON.parse(importStub.calls[0].body ?? "{}").dryRun, false);
      assert.match(document.body.textContent ?? "", /Import finished/);
    } finally {
      importStub.restore();
    }
  } finally {
    fetchStub.restore();
  }
});

test("a file for another catalog is refused locally and nothing is sent", async () => {
  const fetchStub = installFetch({ [importRoute]: result(true) });
  try {
    renderDialog();
    await settle();
    await chooseFiles([
      {
        name: "other.import.json",
        text: JSON.stringify(
          document_({
            catalogVersionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          }),
        ),
      },
    ]);
    assert.match(
      document.body.textContent ?? "",
      /Targets a different catalog/,
    );
    const check = byText<HTMLButtonElement>(
      document.body,
      "button",
      "Check (dry run)",
    );
    assert.equal(check?.disabled, true);
    click(check);
    await settle();
    assert.equal(fetchStub.calls.length, 0);
  } finally {
    fetchStub.restore();
  }
});
