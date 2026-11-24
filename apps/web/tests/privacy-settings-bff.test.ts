import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GET as getPrivacy,
  PATCH as patchPrivacy,
} from "../src/app/api/auth/privacy/route.ts";
import { SESSION_COOKIE_NAME } from "../src/lib/session/session-store.ts";

test("GET /api/auth/privacy requires an authenticated session", async () => {
  const req = new NextRequest("http://localhost/api/auth/privacy");
  const res = await getPrivacy(req);
  assert.equal(res.status, 401);
});

test("GET /api/auth/privacy forwards bearer token and returns privacy settings", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let capturedAuth = "";
    globalThis.fetch = async (_input, init) => {
      capturedAuth = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json({
        ok: true,
        data: {
          retain_repository_telemetry: false,
          enable_audit_export_api: true,
          restricted_assessment_sharing: false,
          purge_agent_memory_on_completion: true,
          improve_models: {
            enabled: false,
            enforced: true,
          },
          updated_at: "2026-11-24T12:00:00.000Z",
        },
      });
    };

    const req = new NextRequest("http://localhost/api/auth/privacy", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=valid-session-token` },
    });
    const res = await getPrivacy(req);
    assert.equal(res.status, 200);
    assert.equal(capturedAuth, "Bearer valid-session-token");
    const json = await res.json();
    assert.deepEqual(json, {
      ok: true,
      data: {
        retain_repository_telemetry: false,
        enable_audit_export_api: true,
        restricted_assessment_sharing: false,
        purge_agent_memory_on_completion: true,
        improve_models: {
          enabled: false,
          enforced: true,
        },
        updated_at: "2026-11-24T12:00:00.000Z",
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PATCH /api/auth/privacy requires an authenticated session", async () => {
  const req = new NextRequest("http://localhost/api/auth/privacy", {
    method: "PATCH",
    body: JSON.stringify({ retain_repository_telemetry: true }),
  });
  const res = await patchPrivacy(req);
  assert.equal(res.status, 401);
});

test("PATCH /api/auth/privacy forwards payload and updates privacy settings", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let capturedBody = "";
    globalThis.fetch = async (_input, init) => {
      capturedBody = String(init?.body ?? "");
      return Response.json({
        ok: true,
        data: {
          retain_repository_telemetry: true,
          enable_audit_export_api: true,
          restricted_assessment_sharing: false,
          purge_agent_memory_on_completion: true,
          improve_models: {
            enabled: false,
            enforced: true,
          },
          updated_at: "2026-11-24T12:30:00.000Z",
        },
      });
    };

    const req = new NextRequest("http://localhost/api/auth/privacy", {
      method: "PATCH",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=valid-session-token`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ retain_repository_telemetry: true }),
    });
    const res = await patchPrivacy(req);
    assert.equal(res.status, 200);
    assert.equal(
      capturedBody,
      JSON.stringify({ retain_repository_telemetry: true }),
    );
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.data.retain_repository_telemetry, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
