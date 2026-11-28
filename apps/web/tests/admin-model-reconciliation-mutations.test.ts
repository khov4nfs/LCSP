import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "../src/lib/session/session-store.ts";
import { POST as decideCase } from "../src/app/api/admin/billing/reconciliation/cases/[caseId]/decide/route.ts";
import { POST as compensate } from "../src/app/api/admin/billing/compensate/route.ts";

const request = (path: string, body: unknown, authenticated = true) =>
  new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-correlation-id": "corr-mutation-test",
      ...(authenticated
        ? { cookie: `${SESSION_COOKIE_NAME}=admin-session` }
        : {}),
    },
    body: JSON.stringify(body),
  });

test("Admin mutation BFF denies missing session and malformed payload before upstream", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("unexpected upstream");
  });
  const noSession = await decideCase(
    request("/api/admin/billing/reconciliation/cases/case-1/decide", {}, false),
    { params: Promise.resolve({ caseId: "case-1" }) },
  );
  const invalid = await compensate(
    request("/api/admin/billing/compensate", { amountMicrocredits: "-1" }),
  );
  assert.equal(noSession.status, 401);
  assert.equal(invalid.status, 400);
  assert.equal(calls, 0);
});

test("mock Admin session cannot forward financial mutations to a live upstream", async (t) => {
  const prior = process.env.MOCK_MODE;
  process.env.MOCK_MODE = "true";
  t.after(() => {
    if (prior === undefined) delete process.env.MOCK_MODE;
    else process.env.MOCK_MODE = prior;
  });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("unexpected live mutation");
  });
  const response = await compensate(
    request("/api/admin/billing/compensate", {
      originalLedgerEntryId: "mock-original-debit-1",
      amountMicrocredits: "700",
      reason: "Verified correction",
      idempotencyKey: "mock-comp-12345678",
    }),
  );
  const decision = await decideCase(
    request("/api/admin/billing/reconciliation/cases/case-1/decide", {
      decision: "MAINTAIN_EXPOSURE",
      idempotencyKey: "mock-dec-12345678",
      auditRationale: "Mock investigation only",
    }),
    { params: Promise.resolve({ caseId: "case-1" }) },
  );
  assert.equal(response.status, 403);
  assert.equal(decision.status, 403);
  assert.equal(calls, 0);
});

test("Admin mutation BFF forwards validated decision and compensation with correlation", async (t) => {
  const paths: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: URL | string, init?: RequestInit) => {
      paths.push(String(url));
      assert.equal(
        new Headers(init?.headers).get("x-correlation-id"),
        "corr-mutation-test",
      );
      assert.equal(init?.method, "POST");
      return Response.json({
        ok: true,
        data: String(url).endsWith("/decide")
          ? {
              decided: true,
              caseId: "case-1",
              invocationId: "inv-1",
              admissionId: "adm-1",
              previousState: "OPEN",
              newState: "CONFIRMED_NO_USAGE",
              decision: "CONFIRM_NO_USAGE",
              slotReleased: true,
              auditRationale: "Provider log confirms no use",
              decidedAt: "2026-11-28T00:00:00.000Z",
              decidedBy: "admin-1",
            }
          : {
              compensated: true,
              ledgerEntryId: "ledger-2",
              walletId: "wallet-1",
              userId: "user-1",
              originalLedgerEntryId: "ledger-1",
              originalDebitMicrocredits: "100",
              compensatedMicrocredits: "25",
              totalCompensatedMicrocredits: "25",
              remainingUncompensatedMicrocredits: "75",
              walletBalanceMicrocredits: "75",
              walletVersion: 2,
              compensatedAt: "2026-11-28T00:00:00.000Z",
            },
      });
    },
  );
  const decision = await decideCase(
    request("/api/admin/billing/reconciliation/cases/case-1/decide", {
      decision: "CONFIRM_NO_USAGE",
      idempotencyKey: "decision-1",
      auditRationale: "Provider log confirms no use",
      providerLogArtifactId: "artifact-1",
    }),
    { params: Promise.resolve({ caseId: "case-1" }) },
  );
  const compensation = await compensate(
    request("/api/admin/billing/compensate", {
      originalLedgerEntryId: "ledger-1",
      amountMicrocredits: "25",
      reason: "Verified billing correction",
      idempotencyKey: "compensate-1",
    }),
  );
  assert.equal(decision.status, 200);
  assert.equal(compensation.status, 200);
  assert.deepEqual(paths, [
    "http://localhost:3001/admin/billing/reconciliation/cases/case-1/decide",
    "http://localhost:3001/admin/billing/compensate",
  ]);
});
