import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAPABILITY_POLICY_REASONS,
  DOMAIN_ALLOWLIST_MODES,
  TOOL_ACCESS_MODES,
} from "@lcsp/contracts/auth";
import {
  GET as getCapabilities,
  PATCH as patchCapabilities,
} from "../src/app/api/auth/capabilities/route.ts";
import { SESSION_COOKIE_NAME } from "../src/lib/session/session-store.ts";

test("GET /api/auth/capabilities requires an authenticated session", async () => {
  const req = new NextRequest("http://localhost/api/auth/capabilities");
  const res = await getCapabilities(req);
  assert.equal(res.status, 401);
});

test("GET /api/auth/capabilities forwards bearer token and returns effective capabilities", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let capturedAuth = "";
    globalThis.fetch = async (_input, init) => {
      capturedAuth = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json({
        ok: true,
        data: {
          tool_access_mode: TOOL_ACCESS_MODES.loadWhenNeeded,
          connector_search: true,
          artifacts: true,
          cloud_code_execution: {
            enabled: false,
            enforced: true,
            policy: CAPABILITY_POLICY_REASONS.platformRestricted,
          },
          network_egress: {
            enabled: false,
            enforced: true,
            policy: CAPABILITY_POLICY_REASONS.runtimePolicyRestricted,
          },
          domain_allowlist: {
            mode: DOMAIN_ALLOWLIST_MODES.packageManagersOnly,
            custom_domains_supported: false,
            allowed_domains: ["registry.npmjs.org", "pypi.org"],
          },
          updated_at: "2026-11-25T10:00:00.000Z",
        },
      });
    };

    const req = new NextRequest("http://localhost/api/auth/capabilities", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=valid-session-token` },
    });
    const res = await getCapabilities(req);
    assert.equal(res.status, 200);
    assert.equal(capturedAuth, "Bearer valid-session-token");
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.data.tool_access_mode, TOOL_ACCESS_MODES.loadWhenNeeded);
    assert.equal(json.data.cloud_code_execution.enabled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PATCH /api/auth/capabilities rejects attempts to override locked platform capabilities", async () => {
  const req = new NextRequest("http://localhost/api/auth/capabilities", {
    method: "PATCH",
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=valid-session-token`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      cloud_code_execution: { enabled: true },
    }),
  });
  const res = await patchCapabilities(req);
  assert.equal(res.status, 400);
});

test("PATCH /api/auth/capabilities forwards valid configurable updates upstream", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let capturedBody = "";
    globalThis.fetch = async (_input, init) => {
      capturedBody = String(init?.body ?? "");
      return Response.json({
        ok: true,
        data: {
          tool_access_mode: TOOL_ACCESS_MODES.guided,
          connector_search: false,
          artifacts: true,
          cloud_code_execution: {
            enabled: false,
            enforced: true,
            policy: CAPABILITY_POLICY_REASONS.platformRestricted,
          },
          network_egress: {
            enabled: false,
            enforced: true,
            policy: CAPABILITY_POLICY_REASONS.runtimePolicyRestricted,
          },
          domain_allowlist: {
            mode: DOMAIN_ALLOWLIST_MODES.packageManagersOnly,
            custom_domains_supported: false,
            allowed_domains: ["registry.npmjs.org", "pypi.org"],
          },
          updated_at: "2026-11-25T10:05:00.000Z",
        },
      });
    };

    const req = new NextRequest("http://localhost/api/auth/capabilities", {
      method: "PATCH",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=valid-session-token`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        tool_access_mode: TOOL_ACCESS_MODES.guided,
        connector_search: false,
      }),
    });
    const res = await patchCapabilities(req);
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(capturedBody), {
      tool_access_mode: TOOL_ACCESS_MODES.guided,
      connector_search: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
