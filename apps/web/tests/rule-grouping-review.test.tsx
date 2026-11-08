import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RULE_CATALOG_GROUP_IDS,
  AUTHORED_LOCALIZATION_CODES,
  authoredLocalizationBacklogResponseSchema,
  authoredLocalizationQueueResponseSchema,
  authoredBatchOutputReviewSchema,
  authoredCandidateActionSchema,
  ruleGroupingProposalSchema,
  ruleCatalogLedgerSchema,
  submitRuleCatalogGroupsSchema,
} from "@lcsp/contracts/assessment-domain";
import { render, settle, click } from "./support/dom.ts";
import { setAppLocale } from "../src/lib/locale.ts";
import { RuleGroupingReview } from "../src/features/admin/components/organisms/rule-grouping-review.tsx";
import { LocalizationOperationsQueue } from "../src/features/admin/components/organisms/localization-operations-queue.tsx";
import { RuleAuditPicker } from "../src/features/assessment-runtime/components/organisms/rule-audit-picker.tsx";
import { problemEnvelope } from "../src/lib/api/problem-envelope.ts";

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

test("Admin discovers localization backlog without a known scopeId and executes candidate review, rejection, retry and batch approval", async () => {
  const wire = JSON.parse(
    readFileSync(
      new URL(
        "../src/public/assets/mocks/rule-grouping-review.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const backlog = authoredLocalizationBacklogResponseSchema.parse(
    wire.localizationBacklog,
  );
  const queue = authoredLocalizationQueueResponseSchema.parse(
    wire.localizationQueue,
  );
  const recordedPosts: Array<{ url: string; body: unknown }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = String(input);
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      recordedPosts.push({ url, body });
      if (url.endsWith("/batch-output-review")) {
        authoredBatchOutputReviewSchema.parse(body);
        return Promise.resolve(
          Response.json({
            ok: true,
            data: {
              scopeId: backlog.scopes[0].scopeId,
              acceptedCount: 1,
              rejectedCount: 0,
              results: [
                {
                  requestId: queue[0].id,
                  accepted: true,
                  errorCode: null,
                },
              ],
            },
          }),
        );
      }
      if (url.endsWith("/retry")) {
        authoredCandidateActionSchema.parse(body);
        return Promise.resolve(
          Response.json({
            ok: true,
            data: {
              id: queue[0].id,
              state: "PENDING",
              translationRevision: 2,
            },
          }),
        );
      }
      return Promise.resolve(
        Response.json({
          ok: true,
          data: { state: "READY", reviewed: 1 },
        }),
      );
    }
    return Promise.resolve(
      Response.json({
        ok: true,
        data: url.includes(backlog.scopes[0].scopeId) ? queue : backlog,
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
        <LocalizationOperationsQueue />
      </QueryClientProvider>,
    );
    await settle();
    assert.match(node.textContent ?? "", /Localization operational readiness/);
    assert.match(node.textContent ?? "", /11111111-1111-4111-8111-111111111111/);
    assert.match(
      node.textContent ?? "",
      /Biện pháp bảo vệ giả lập \(ứng viên\)/,
    );

    act(() => {
      const evidenceTextarea = node.querySelectorAll("textarea")[0]!;
      Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(
        evidenceTextarea,
        "Reviewed Vietnamese candidate and verified legal meaning",
      );
      evidenceTextarea.dispatchEvent(
        new window.Event("change", { bubbles: true }),
      );
      evidenceTextarea.dispatchEvent(
        new window.Event("input", { bubbles: true }),
      );

      for (const checkbox of node.querySelectorAll('input[type="checkbox"]')) {
        (checkbox as HTMLInputElement).click();
      }
    });

    const rejectBtn = [...node.querySelectorAll("button")].find((btn) =>
      /Reject candidate/.test(btn.textContent ?? ""),
    );
    click(rejectBtn ?? null);
    await settle();
    assert.equal(recordedPosts.length, 1);
    assert.equal(
      (recordedPosts[0].body as { action: string }).action,
      "REJECT",
    );

    const batchApproveBtn = [...node.querySelectorAll("button")].find((btn) =>
      /Batch approve output/.test(btn.textContent ?? ""),
    );
    click(batchApproveBtn ?? null);
    await settle();
    assert.equal(recordedPosts.length, 2);
    assert.match(recordedPosts[1].url, /batch-output-review$/);
  } finally {
    globalThis.fetch = original;
    client.clear();
  }
});

test("Customer RuleAuditPicker displays truthful localization readiness alert when selected locale is awaiting review", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      Response.json(
        problemEnvelope(AUTHORED_LOCALIZATION_CODES.INCOMPLETE, 409),
        { status: 409 },
      ),
    );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  try {
    setAppLocale("vi");
    const node = render(
      <QueryClientProvider client={client}>
        <RuleAuditPicker assessmentId="11111111-1111-4111-8111-111111111111" />
      </QueryClientProvider>,
    );
    await settle();
    assert.match(
      node.textContent ?? "",
      /Bản địa hóa cho ngôn ngữ đang chọn đang chờ rà soát/,
    );
  } finally {
    setAppLocale("en");
    globalThis.fetch = original;
    client.clear();
  }
});
