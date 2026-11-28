import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { BILLING_ERROR_CODES } from "@lcsp/contracts/billing";
import { SESSION_COOKIE_NAME } from "../src/lib/session/session-store.ts";
import { GET as listCases } from "../src/app/api/admin/billing/reconciliation/cases/route.ts";
import { GET as getCase } from "../src/app/api/admin/billing/reconciliation/cases/[caseId]/route.ts";

const request = (url: string, authenticated = true) =>
  new NextRequest(url, {
    headers: authenticated
      ? { cookie: `${SESSION_COOKIE_NAME}=e2e-admin-session-token`, "x-correlation-id": "corr-recon-test" }
      : {},
  });

test("model reconciliation BFF rejects unauthenticated reads before upstream access", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("unexpected upstream request");
  });
  const result = await listCases(request("http://localhost/api/admin/billing/reconciliation/cases", false));
  const body = await result.json();
  assert.equal(result.status, 401);
  assert.equal(body.problem.code, AUTH_ERROR_CODES.sessionInvalid);
  assert.equal(calls, 0);
});

test("model reconciliation BFF rejects unknown filters without an upstream request", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("unexpected upstream request");
  });
  const result = await listCases(request("http://localhost/api/admin/billing/reconciliation/cases?unexpected=1"));
  const body = await result.json();
  assert.equal(result.status, 400);
  assert.equal(body.problem.code, BILLING_ERROR_CODES.validationFailed);
  assert.equal(calls, 0);
});

test("model reconciliation BFF proxies validated case queue and detail with correlation", async (t) => {
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL | string, init?: RequestInit) => {
    paths.push(String(url));
    assert.equal(new Headers(init?.headers).get("x-correlation-id"), "corr-recon-test");
    if (String(url).includes("/cases/case-1")) {
      return Response.json({ ok: true, data: {
        caseId: "case-1", invocationId: "inv-1", admissionId: "adm-1", state: "OPEN",
        provider: "anthropic", providerCorrelationId: "corr-provider-1", providerLogArtifactId: null,
        coverageStart: null, coverageEnd: null, resolvedAt: null, resolvedBy: null, auditRationale: null,
        conflictDetectedAt: null, conflictingPayload: null,
        createdAt: "2026-11-28T00:00:00.000Z", updatedAt: "2026-11-28T00:00:00.000Z",
        admission: { id: "adm-1", invocationId: "inv-1", walletId: "wallet-1", userId: "user-1",
          maximumExposureMicrocredits: "100", state: "DISPATCH_UNKNOWN", rolloutMode: "ADMISSION_REQUIRED",
          debitMode: "OFF", requestedModel: "claude-sonnet-4-6", resolvedProvider: "anthropic",
          resolvedModel: "claude-sonnet-4-6", admittedAt: "2026-11-28T00:00:00.000Z",
          consumedAt: null, expiresAt: "2026-11-28T00:05:00.000Z" }, evidenceArtifact: null,
        compensationPreview: null,
      } });
    }
    return Response.json({ ok: true, data: { items: [], total: 0, page: 1, pageSize: 20 } });
  });
  const list = await listCases(request("http://localhost/api/admin/billing/reconciliation/cases?page=1"));
  const detail = await getCase(request("http://localhost/api/admin/billing/reconciliation/cases/case-1"), { params: Promise.resolve({ caseId: "case-1" }) });
  assert.equal(list.status, 200);
  assert.equal(detail.status, 200);
  assert.deepEqual(paths, [
    "http://localhost:3001/admin/billing/reconciliation/cases?page=1&pageSize=20",
    "http://localhost:3001/admin/billing/reconciliation/cases/case-1",
  ]);
});
