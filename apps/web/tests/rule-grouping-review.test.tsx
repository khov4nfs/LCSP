import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RULE_CATALOG_GROUP_IDS,
  ruleGroupingProposalSchema,
  ruleCatalogLedgerSchema,
  submitRuleCatalogGroupsSchema,
} from "@lcsp/contracts/assessment-domain";
import { render, settle, click } from "./support/dom.ts";
import { setAppLocale } from "../src/lib/locale.ts";
import { RuleGroupingReview } from "../src/features/admin/components/organisms/rule-grouping-review.tsx";

test("Admin reviews a proposal without raw JSON and submits its exact pinned membership", async () => {
  const wire = JSON.parse(
    readFileSync(
      new URL(
        "../src/public/assets/mocks/rule-grouping-review.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const proposal = ruleGroupingProposalSchema.parse(wire.proposal);
  let ledger = ruleCatalogLedgerSchema.parse(wire.ledger);
  const submitted: unknown[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (_url, init) => {
    if (init?.method === "POST") {
      const body = submitRuleCatalogGroupsSchema.parse(
        JSON.parse(String(init.body)),
      );
      submitted.push(body);
      ledger = {
        ...ledger,
        membershipDigest: "c".repeat(64),
        memberships: body.memberships.map((row) => ({
          ...row,
          state: "DRAFT",
          submittedBy: "test-admin",
          approvedBy: null,
        })),
      };
    }
    return Promise.resolve(
      Response.json({
        ok: true,
        data: String(_url).endsWith("/proposal") ? proposal : ledger,
      }),
    );
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  try {
    setAppLocale("en");
    const node = render(
      <QueryClientProvider client={client}>
        <RuleGroupingReview ruleSetVersionId={proposal.ruleSetVersionId} />
      </QueryClientProvider>,
    );
    await settle();
    assert.match(node.textContent ?? "", /Synthetic safeguard/);
    assert.match(node.textContent ?? "", /Synthetic developer/);
    assert.equal(node.querySelector("textarea")?.value, "");
    assert.equal(
      [...node.querySelectorAll("button")].find((button) =>
        /Approve/.test(button.textContent ?? ""),
      )?.disabled,
      true,
    );
    act(() => {
      const select = node.querySelector("select")!;
      select.value = RULE_CATALOG_GROUP_IDS.ARCHITECTURE_SAFETY_BY_DESIGN;
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
      for (const textarea of node.querySelectorAll("textarea")) {
        Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        )!.set!.call(textarea, "Administrator-reviewed presentation rationale");
        textarea.dispatchEvent(new window.Event("change", { bubbles: true }));
        textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
      }
    });
    click(node.querySelector('button[type="submit"]'));
    await settle();
    assert.equal(submitted.length, 1);
    const parsed = submitRuleCatalogGroupsSchema.parse(submitted[0]);
    assert.equal(parsed.ruleSetDigest, proposal.ruleSetDigest);
    assert.equal(
      parsed.memberships[0].assessmentRuleId,
      proposal.entries[0].assessmentRuleId,
    );
    assert.deepEqual(
      parsed.memberships[0].sourceReferences,
      proposal.entries[0].sourceReferences,
    );
  } finally {
    globalThis.fetch = original;
    client.clear();
  }
});
