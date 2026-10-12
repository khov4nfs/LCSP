import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as completeRepositorySetup } from "../src/app/api/assessments/[id]/repository-setup/complete/route.ts";
import { POST as continueRuntime } from "../src/app/api/assessments/[id]/runtime/continue/route.ts";
import { POST as answerHumanRequest } from "../src/app/api/assessments/[id]/human-requests/[requestId]/answers/route.ts";
import { POST as createAssessment } from "../src/app/api/assessments/route.ts";
import { apiRequest } from "../src/lib/api/api-request.ts";
import { setAppLocale } from "../src/lib/locale.ts";

const assessmentId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const targetRunId = "33333333-3333-4333-8333-333333333333";
const sessionToken = "session-test-token-xyz";

test("BFF repository-setup/complete derives authoritative locale from lcsp_locale cookie and forwards x-lcsp-locale upstream", async () => {
  const originalFetch = globalThis.fetch;
  let capturedHeaders: Headers | undefined;
  let capturedUrl: string | undefined;

  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedHeaders = new Headers(init?.headers);
    return Response.json({
      ok: true,
      data: {
        assessment_id: assessmentId,
        repository_connection_id: "conn-1",
        snapshot_id: "snap-1",
        commit_sha: "a".repeat(40),
      },
    });
  };

  try {
    // 1. Initial turn: user selected English (lcsp_locale=en cookie in browser)
    const reqEn = new NextRequest(
      `http://localhost:3000/api/assessments/${assessmentId}/repository-setup/complete`,
      {
        method: "POST",
        headers: {
          cookie: `lcsp_session=${sessionToken}; lcsp_locale=en`,
        },
      },
    );

    const resEn = await completeRepositorySetup(reqEn, {
      params: Promise.resolve({ id: assessmentId }),
    });
    assert.equal(resEn.status, 200);
    assert.ok(
      capturedUrl?.includes(
        `/assessments/${assessmentId}/repository-setup/complete`,
      ),
    );
    assert.equal(
      capturedHeaders?.get("authorization"),
      `Bearer ${sessionToken}`,
    );
    assert.equal(
      capturedHeaders?.get("x-lcsp-locale"),
      "en",
      "BFF must forward x-lcsp-locale: en derived from lcsp_locale=en cookie",
    );

    // 2. Same-thread switch: user toggles language to Vietnamese (lcsp_locale=vi)
    const reqVi = new NextRequest(
      `http://localhost:3000/api/assessments/${assessmentId}/repository-setup/complete`,
      {
        method: "POST",
        headers: {
          cookie: `lcsp_session=${sessionToken}; lcsp_locale=vi`,
        },
      },
    );

    const resVi = await completeRepositorySetup(reqVi, {
      params: Promise.resolve({ id: assessmentId }),
    });
    assert.equal(resVi.status, 200);
    assert.equal(
      capturedHeaders?.get("x-lcsp-locale"),
      "vi",
      "BFF must forward x-lcsp-locale: vi when user switches to Vietnamese on same thread",
    );

    // 3. Same-thread switch back to English (lcsp_locale=en)
    const reqEnAgain = new NextRequest(
      `http://localhost:3000/api/assessments/${assessmentId}/repository-setup/complete`,
      {
        method: "POST",
        headers: {
          cookie: `lcsp_session=${sessionToken}; lcsp_locale=en`,
        },
      },
    );

    const resEnAgain = await completeRepositorySetup(reqEnAgain, {
      params: Promise.resolve({ id: assessmentId }),
    });
    assert.equal(resEnAgain.status, 200);
    assert.equal(
      capturedHeaders?.get("x-lcsp-locale"),
      "en",
      "BFF must forward x-lcsp-locale: en when user switches back to English on same thread",
    );

    // 4. Fallback: unset locale cookie does not inject invalid header
    const reqUnset = new NextRequest(
      `http://localhost:3000/api/assessments/${assessmentId}/repository-setup/complete`,
      {
        method: "POST",
        headers: {
          cookie: `lcsp_session=${sessionToken}`,
        },
      },
    );

    const resUnset = await completeRepositorySetup(reqUnset, {
      params: Promise.resolve({ id: assessmentId }),
    });
    assert.equal(resUnset.status, 200);
    assert.equal(capturedHeaders?.has("x-lcsp-locale"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BFF runtime continue route forwards authoritative lcsp_locale cookie upstream", async () => {
  const originalFetch = globalThis.fetch;
  let capturedHeaders: Headers | undefined;
  let capturedUrl: string | undefined;

  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedHeaders = new Headers(init?.headers);
    return Response.json({
      ok: true,
      data: {
        state: "RUNNING",
        targetRunId,
        requestId: null,
      },
    });
  };

  try {
    const req = new NextRequest(
      `http://localhost:3000/api/assessments/${assessmentId}/runtime/continue`,
      {
        method: "POST",
        headers: {
          cookie: `lcsp_session=${sessionToken}; lcsp_locale=en`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ targetRunId }),
      },
    );

    const res = await continueRuntime(req, {
      params: Promise.resolve({ id: assessmentId }),
    });
    assert.equal(res.status, 200);
    assert.ok(
      capturedUrl?.includes(`/assessments/${assessmentId}/runtime/continue`),
    );
    assert.equal(capturedHeaders?.get("x-lcsp-locale"), "en");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BFF human-requests answer route forwards authoritative lcsp_locale cookie upstream", async () => {
  const originalFetch = globalThis.fetch;
  let capturedHeaders: Headers | undefined;
  let capturedUrl: string | undefined;

  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedHeaders = new Headers(init?.headers);
    return Response.json({
      ok: true,
      data: {
        requestId,
        requestRevision: 2,
        caseRevision: 1,
        status: "RESOLVED",
        factId: null,
        resumed: true,
        replayed: false,
      },
    });
  };

  try {
    const req = new NextRequest(
      `http://localhost:3000/api/assessments/${assessmentId}/human-requests/${requestId}/answers`,
      {
        method: "POST",
        headers: {
          cookie: `lcsp_session=${sessionToken}; lcsp_locale=en`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          expectedCaseRevision: 1,
          expectedRequestRevision: 1,
          idempotencyKey: "idem-key-12345",
          doesNotKnow: false,
          answer: "Confirmed compliance",
        }),
      },
    );

    const res = await answerHumanRequest(req, {
      params: Promise.resolve({ id: assessmentId, requestId }),
    });
    assert.equal(res.status, 200);
    assert.ok(
      capturedUrl?.includes(
        `/assessments/${assessmentId}/human-requests/${requestId}/answers`,
      ),
    );
    assert.equal(capturedHeaders?.get("x-lcsp-locale"), "en");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BFF assessment creation route forwards authoritative lcsp_locale cookie upstream", async () => {
  const originalFetch = globalThis.fetch;
  let capturedHeaders: Headers | undefined;
  let capturedUrl: string | undefined;

  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedHeaders = new Headers(init?.headers);
    return Response.json({
      ok: true,
      data: {
        assessment_id: assessmentId,
        name: "New Assessment",
        owner_id: "user-1",
        lifecycle: null,
        runtime: null,
        case: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        correlationId: "corr-1",
      },
    });
  };

  try {
    const req = new NextRequest(`http://localhost:3000/api/assessments`, {
      method: "POST",
      headers: {
        cookie: `lcsp_session=${sessionToken}; lcsp_locale=en`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "New Assessment",
      }),
    });

    const res = await createAssessment(req);
    assert.equal(res.status, 200);
    assert.ok(capturedUrl?.includes(`/assessments`));
    assert.equal(capturedHeaders?.get("x-lcsp-locale"), "en");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("client apiRequest automatically attaches x-lcsp-locale header in browser environment", async () => {
  const originalWindow = (globalThis as unknown as { window?: unknown }).window;
  const originalFetch = globalThis.fetch;
  let capturedHeaders: Headers | undefined;

  (globalThis as unknown as { window: unknown }).window = {};
  globalThis.fetch = async (_input, init) => {
    capturedHeaders = new Headers(init?.headers);
    return Response.json({ ok: true, data: { status: "ok" } });
  };

  try {
    // 1. Client configured with English
    setAppLocale("en");
    await apiRequest("/api/test");
    assert.equal(
      capturedHeaders?.get("x-lcsp-locale"),
      "en",
      "apiRequest must attach x-lcsp-locale: en when app locale is en",
    );

    // 2. Same session switch to Vietnamese
    setAppLocale("vi");
    await apiRequest("/api/test");
    assert.equal(
      capturedHeaders?.get("x-lcsp-locale"),
      "vi",
      "apiRequest must attach x-lcsp-locale: vi when app locale is switched to vi",
    );
  } finally {
    (globalThis as unknown as { window: unknown }).window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});
