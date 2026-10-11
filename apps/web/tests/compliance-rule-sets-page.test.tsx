import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

import { buttons, byText, click, installFetch, render, settle } from "./support/dom.ts";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { complianceRuleSetHistorySchema } from "@lcsp/contracts/compliance-rule-set";
import { setAppLocale } from "../src/lib/locale.ts";
import { ComplianceRuleSetsPage } from "../src/features/admin/components/organisms/compliance-rule-sets-page.tsx";

setAppLocale("en");

const SOURCE_V1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOURCE_V2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RULE_SET_V1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RUN_OK = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const RUN_FAILED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const history = complianceRuleSetHistorySchema.parse({
  ruleSets: [
    {
      ruleSetVersionId: RULE_SET_V1,
      version: "2026.10.p1",
      legalSourceVersionId: SOURCE_V1,
      legalSourceVersion: "2026.10",
      ruleSetDigest: "f".repeat(64),
      lifecycleState: "ACTIVE",
      activatedAt: "2026-10-11T10:00:00.000Z",
      supersededAt: null,
      createdAt: "2026-10-11T09:55:00.000Z",
      legalRequirementCount: 37,
      assessmentRuleCount: 62,
    },
  ],
  preparations: [
    {
      preparationRunId: RUN_FAILED,
      legalSourceVersionId: SOURCE_V2,
      legalSourceVersion: "2026.11",
      executionState: "FAILED",
      ruleSetVersionId: null,
      failureReason: "NO_SUBMISSION",
      attempt: 1,
      requestedBy: "rule-set-preparation-system",
      createdAt: "2026-10-11T11:00:00.000Z",
      completedAt: "2026-10-11T11:10:00.000Z",
      retryable: true,
    },
    {
      preparationRunId: RUN_OK,
      legalSourceVersionId: SOURCE_V1,
      legalSourceVersion: "2026.10",
      executionState: "SUCCEEDED",
      ruleSetVersionId: RULE_SET_V1,
      failureReason: null,
      attempt: 1,
      requestedBy: "rule-set-preparation-system",
      createdAt: "2026-10-11T09:40:00.000Z",
      completedAt: "2026-10-11T09:55:00.000Z",
      retryable: false,
    },
  ],
});

function client() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
}

test("Compliance Rule Sets is an operations view: active version, preparations, history; no start control", async () => {
  const stub = installFetch({ "GET /api/admin/compliance-rule-sets": history });
  try {
    const page = render(
      <QueryClientProvider client={client()}>
        <ComplianceRuleSetsPage />
      </QueryClientProvider>,
    );
    await settle();
    const text = page.textContent ?? "";
    assert.match(text, /Compliance rule sets/);
    assert.match(text, /2026\.10\.p1/);
    assert.match(text, /Legal Source Version/);
    assert.match(text, /37/);
    assert.match(text, /62/);
    assert.match(text, /f{64}/);
    assert.match(text, /No rule set|Rule Set Preparation/);
    // The page never offers to start a preparation or pick a source to prepare.
    assert.equal(page.querySelectorAll("form, select, [role='combobox']").length, 0);
    assert.equal(byText(page, "button", /^Start/), null);
    assert.equal(byText(page, "button", /Start preparation|Start Legal Preparation/i), null);
    // The only action is the explicit retry of the one failed run.
    const retry = buttons(page).filter((button) => /Retry failed Rule Set Preparation/.test(button.textContent ?? ""));
    assert.equal(retry.length, 1);
    assert.equal(page.querySelectorAll("[data-preparation-state='FAILED']").length, 1);
    assert.match(page.textContent ?? "", /No rule set was submitted/);
  } finally {
    stub.restore();
  }
});

test("retrying a failed preparation calls the retry route for THAT run only", async () => {
  const stub = installFetch({
    "GET /api/admin/compliance-rule-sets": history,
    [`POST /api/admin/compliance-rule-sets/preparations/${RUN_FAILED}/retries`]: {
      preparationRunId: "99999999-9999-4999-8999-999999999999",
      legalSourceVersionId: SOURCE_V2,
      executionState: "QUEUED",
      ruleSetVersionId: null,
    },
  });
  try {
    const page = render(
      <QueryClientProvider client={client()}>
        <ComplianceRuleSetsPage />
      </QueryClientProvider>,
    );
    await settle();
    click(byText(page, "button", "Retry failed Rule Set Preparation"));
    await settle();
    const posts = stub.calls.filter((call) => call.method === "POST");
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.body, null, "no source, key or version can be supplied by the page");
  } finally {
    stub.restore();
  }
});

test("web code has no route, hook or form that starts a Rule Set Preparation", async () => {
  const root = new URL("../src/", import.meta.url);
  const files: string[] = [];
  const walk = async (dir: URL) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
      if (entry.isDirectory()) await walk(child);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(child.pathname);
    }
  };
  await walk(root);
  const sources = await Promise.all(files.map(async (file) => [file, await readFile(file, "utf8")] as const));
  const offenders = sources.filter(([, source]) =>
    /StartRuleSetPreparation|useStartRuleSetPreparation|ruleSetPreparationStartRequestSchema|compliance-rule-sets\/preparations["'`]/.test(source),
  );
  assert.deepEqual(offenders.map(([file]) => file), []);
  assert.ok(files.some((file) => file.endsWith("compliance-rule-sets/preparations/[preparationRunId]/retries/route.ts")));
  assert.ok(!files.some((file) => file.endsWith("compliance-rule-sets/preparations/route.ts")));
});
