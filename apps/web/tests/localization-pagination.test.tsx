import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LocalizationOperationsQueue } from "../src/features/admin/components/organisms/localization-operations-queue.tsx";
import {
  authoredLocalizationBacklogResponseSchema,
  authoredLocalizationQueueItemSchema,
} from "@lcsp/contracts/assessment-domain";
import { render, settle, click } from "./support/dom.ts";
import { setAppLocale } from "../src/lib/locale.ts";
import { z } from "zod";
test("Admin navigates scope 30 and jobs beyond 100, retains exact draft edits, enforces batch 50 and reports partial outcomes", async () => {
  const wire = JSON.parse(
    readFileSync(
      new URL(
        "../src/public/assets/mocks/localization-pagination.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const backlog = authoredLocalizationBacklogResponseSchema.parse(wire.backlog);
  const jobs = z.array(authoredLocalizationQueueItemSchema).parse(wire.jobs);
  const requests: string[] = [];
  const posts: unknown[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input), "http://localhost");
    requests.push(url.href);
    if (init?.method === "POST") {
      const body = JSON.parse(typeof init.body === "string" ? init.body : "{}");
      posts.push(body);
      const results = body.items.map(
        (item: { requestId: string }, index: number) => ({
          requestId: item.requestId,
          accepted: index === 0,
          errorCode: index === 0 ? null : "TRANSLATION_PROVIDER_INVALID",
        }),
      );
      return Promise.resolve(
        Response.json({
          ok: true,
          data: {
            scopeId: "pagination-scope-30",
            acceptedCount: 1,
            rejectedCount: results.length - 1,
            results,
          },
        }),
      );
    }
    if (url.pathname === "/api/admin/localization") {
      const after = url.searchParams.get("afterScopeId");
      const scopes = backlog.scopes
        .filter((scope) => !after || scope.scopeId > after)
        .slice(0, 25);
      const hasMore = scopes.at(-1)?.scopeId !== backlog.scopes.at(-1)?.scopeId;
      return Promise.resolve(
        Response.json({
          ok: true,
          data: {
            ...backlog,
            scopes,
            hasMore,
            nextAfterScopeId: hasMore ? scopes.at(-1)!.scopeId : null,
          },
        }),
      );
    }
    const after = url.searchParams.get("after");
    const items = url.pathname.endsWith("pagination-scope-30")
      ? jobs.filter((job) => !after || job.id > after).slice(0, 100)
      : [];
    const hasMore = items.length > 0 && items.at(-1)!.id !== jobs.at(-1)!.id;
    return Promise.resolve(
      Response.json({
        ok: true,
        data: { items, hasMore, nextAfter: hasMore ? items.at(-1)!.id : null },
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
    const button = (container: ParentNode, label: string) =>
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === label,
      )!;
    click(button(node, "Next page"));
    await settle();
    assert.match(node.textContent!, /pagination-scope-30/);
    const scope30 = [...node.querySelectorAll("li")].find((row) =>
      row.textContent?.includes("pagination-scope-30"),
    )!;
    click(scope30.querySelector("button"));
    await settle();
    let section = node.querySelector(
      '[data-slot="localization-scope-review"]',
    )!;
    assert.equal(
      section.querySelectorAll('[data-slot="localization-queue-item"]').length,
      100,
    );
    const textarea = section.querySelectorAll("textarea")[1]!;
    act(() => {
      Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(textarea, "Unsubmitted exact-field draft");
      textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    click(button(section, "Next page"));
    await settle();
    section = node.querySelector('[data-slot="localization-scope-review"]')!;
    assert.equal(
      section.querySelectorAll('[data-slot="localization-queue-item"]').length,
      60,
    );
    assert.match(section.textContent!, /event-160/);
    click(button(section, "Previous page"));
    await settle();
    section = node.querySelector('[data-slot="localization-scope-review"]')!;
    assert.equal(
      section.querySelectorAll("textarea")[1]!.value,
      "Unsubmitted exact-field draft",
    );
    act(() => {
      for (const checkbox of [
        ...section.querySelectorAll(
          '[data-slot="localization-queue-item"] input[type="checkbox"]',
        ),
      ].slice(0, 51))
        (checkbox as HTMLInputElement).click();
    });
    click(button(section, "Batch attest source language"));
    await settle();
    assert.equal(posts.length, 0);
    assert.match(section.textContent!, /Select at most 50/);
    act(() => {
      for (const checkbox of [
        ...section.querySelectorAll(
          '[data-slot="localization-queue-item"] input[type="checkbox"]',
        ),
      ].slice(2, 51))
        (checkbox as HTMLInputElement).click();
      const evidence = section.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(evidence, "Explicit field-level synthetic evidence");
      evidence.dispatchEvent(new window.Event("input", { bubbles: true }));
      (
        section.querySelector(
          'input[name="confirmsIndividualFieldReview"]',
        ) as HTMLInputElement
      ).click();
    });
    click(button(section, "Batch attest source language"));
    await settle();
    assert.equal(posts.length, 1);
    assert.match(section.textContent!, /Rejected; review remains unresolved/);
    assert(requests.some((url) => url.includes("after=")));
    assert(requests.some((url) => url.includes("afterScopeId=")));
    const select = section.querySelector("select")!;
    act(() => {
      select.value = "SOURCE_REVIEW_REQUIRED";
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    await settle();
    assert(
      requests.some((url) => url.includes("filter=SOURCE_REVIEW_REQUIRED")),
    );
  } finally {
    globalThis.fetch = original;
    client.clear();
  }
});
