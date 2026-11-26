import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import {
  AZURE_DEVOPS_CREDENTIAL_TYPES,
  BITBUCKET_CREDENTIAL_TYPES,
  CREDENTIAL_PROVIDERS,
} from "@lcsp/contracts/github-integration";

import { POST } from "../src/app/api/provider-credentials/route.ts";
import { SESSION_COOKIE_NAME } from "../src/lib/session/session-store.ts";

test("credential BFF forwards typed Bitbucket and Azure payloads without rewriting secrets", async () => {
  const originalFetch = globalThis.fetch;
  const captured: Array<{
    body: unknown;
    authorization: string | null;
  }> = [];
  try {
    globalThis.fetch = async (_input, init) => {
      captured.push({
        body: JSON.parse(String(init?.body)),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return Response.json({ ok: true, data: { accepted: true } });
    };

    const payloads = [
      {
        provider: CREDENTIAL_PROVIDERS.bitbucket,
        credential: {
          type: BITBUCKET_CREDENTIAL_TYPES.atlassianApiToken,
          email: "owner@example.com",
          apiToken: "test-bitbucket-token",
        },
        credential_expires_at: "2027-12-31T23:59:59.999Z",
      },
      {
        provider: CREDENTIAL_PROVIDERS.azureDevOps,
        credential: {
          type: AZURE_DEVOPS_CREDENTIAL_TYPES.organizationPat,
          organization: "acme-org",
          pat: "test-azure-pat",
        },
        credential_expires_at: "2027-12-31T23:59:59.999Z",
      },
    ];

    for (const body of payloads) {
      const response = await POST(
        new NextRequest("http://localhost/api/provider-credentials", {
          method: "POST",
          headers: {
            cookie: `${SESSION_COOKIE_NAME}=test-only-session`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
      assert.equal(response.status, 200);
    }

    assert.deepEqual(captured.map((request) => request.body), payloads);
    assert.deepEqual(
      captured.map((request) => request.authorization),
      ["Bearer test-only-session", "Bearer test-only-session"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("credential BFF rejects mismatched typed provider contracts before upstream calls", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  try {
    globalThis.fetch = async () => {
      upstreamCalls += 1;
      return Response.json({ ok: true, data: {} });
    };
    const response = await POST(
      new NextRequest("http://localhost/api/provider-credentials", {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=test-only-session`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          provider: CREDENTIAL_PROVIDERS.bitbucket,
          credential: {
            type: AZURE_DEVOPS_CREDENTIAL_TYPES.organizationPat,
            organization: "acme-org",
            pat: "test-azure-pat",
          },
        }),
      }),
    );
    assert.equal(response.status, 400);
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
