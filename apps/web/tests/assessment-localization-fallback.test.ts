import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  AUTHORED_LOCALIZATION_CODES,
  AUTHORED_LOCALIZATION_READINESS_STATES,
  AUTHORED_LOCALIZATION_STATES,
  ruleAuditCatalogSchema,
} from "@lcsp/contracts/assessment-domain";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import { GET as getDetail } from "../src/app/api/assessments/[id]/route.ts";
import { GET as getQuestions } from "../src/app/api/assessments/[id]/human-requests/route.ts";
import { GET as getRules } from "../src/app/api/assessments/[id]/rules/route.ts";
import { problemEnvelope } from "../src/lib/api/problem-envelope.ts";

const wire = JSON.parse(
  readFileSync(
    new URL(
      "../src/public/assets/mocks/localized-assessment-detail.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const catalog = ruleAuditCatalogSchema.parse(
  JSON.parse(
    readFileSync(
      new URL(
        "../src/public/assets/mocks/selected-rule-audit-catalog.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);
const id = wire.en.assessment_id as string;
const routes = [
  { suffix: "", handler: getDetail, data: wire.en },
  {
    suffix: "/human-requests",
    handler: getQuestions,
    data: wire.humanRequests.en,
  },
  {
    suffix: "/rules?offset=100&limit=100",
    handler: getRules,
    data: { ...catalog, offset: 100 },
  },
];

function localizationProblem(
  locale: string,
  meta: Record<string, unknown> = {},
) {
  const result = problemEnvelope(AUTHORED_LOCALIZATION_CODES.INCOMPLETE, 409);
  return {
    ...result,
    problem: {
      ...result.problem,
      meta: {
        locale,
        state: AUTHORED_LOCALIZATION_STATES.PENDING,
        fieldPath: "/concept",
        ...meta,
      },
    },
  };
}

for (const locale of ["en", "vi"]) {
  for (const route of routes) {
    test(`${locale} ${route.suffix || "detail"}: pending localization returns marked canonical content`, async () => {
      const originalFetch = globalThis.fetch;
      const calls: Array<{ url: string; headers: Headers }> = [];
      globalThis.fetch = async (input, init) => {
        calls.push({ url: String(input), headers: new Headers(init?.headers) });
        return calls.length === 1
          ? Response.json(localizationProblem(locale), { status: 409 })
          : Response.json({ ok: true, data: route.data });
      };
      try {
        const response = await route.handler(
          new NextRequest(
            `http://localhost/api/assessments/${id}${route.suffix}`,
            {
              headers: {
                cookie: `lcsp_session=test-token; lcsp_locale=${locale}`,
              },
            },
          ),
          { params: Promise.resolve({ id }) },
        );
        const body = await response.json();
        assert.equal(response.status, 200);
        assert.equal(calls.length, 2);
        assert.equal(calls[0].url, calls[1].url);
        assert.ok(calls[1].url.endsWith(`/assessments/${id}${route.suffix}`));
        assert.equal(calls[0].headers.get("x-lcsp-locale"), locale);
        assert.equal(calls[1].headers.has("x-lcsp-locale"), false);
        assert.equal(
          calls[1].headers.get("authorization"),
          "Bearer test-token",
        );
        assert.equal(body.data.localizationFallback, true);
        if (route.handler === getRules) {
          assert.equal(
            body.data.localizationState,
            AUTHORED_LOCALIZATION_READINESS_STATES.PENDING,
          );
          assert.deepEqual(body.data.rules, catalog.rules);
        } else {
          assert.deepEqual(body.data, {
            ...route.data,
            localizationFallback: true,
          });
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }

  test(`${locale}: failed localization, unbound conflicts and access failures never trigger fallback`, async () => {
    const originalFetch = globalThis.fetch;
    try {
      for (const failure of [
        {
          body: localizationProblem(locale, {
            state: AUTHORED_LOCALIZATION_STATES.FAILED,
          }),
          status: 409,
        },
        {
          body: localizationProblem(locale, { fieldPath: undefined }),
          status: 409,
        },
        {
          body: problemEnvelope(
            AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
            409,
          ),
          status: 409,
        },
        {
          body: problemEnvelope(AUTH_ERROR_CODES.authRequired, 401),
          status: 401,
        },
        {
          body: problemEnvelope(SHARED_ERROR_CODES.upstreamUnavailable, 503),
          status: 503,
        },
      ]) {
        let calls = 0;
        globalThis.fetch = async () => {
          calls++;
          return Response.json(failure.body, { status: failure.status });
        };
        const response = await getQuestions(
          new NextRequest(
            `http://localhost/api/assessments/${id}/human-requests`,
            {
              headers: {
                cookie: `lcsp_session=test-token; lcsp_locale=${locale}`,
              },
            },
          ),
          { params: Promise.resolve({ id }) },
        );
        assert.equal(response.status, failure.status);
        assert.deepEqual(
          await response.json(),
          JSON.parse(JSON.stringify(failure.body)),
        );
        assert.equal(calls, 1);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test(`${locale}: canonical fallback failures remain failures`, async () => {
    const originalFetch = globalThis.fetch;
    try {
      for (const fallback of [
        {
          body: problemEnvelope(SHARED_ERROR_CODES.upstreamUnavailable, 503),
          status: 503,
          expected: 503,
        },
        { body: { ok: true, data: {} }, status: 200, expected: 502 },
      ]) {
        let calls = 0;
        globalThis.fetch = async () =>
          ++calls === 1
            ? Response.json(localizationProblem(locale), { status: 409 })
            : Response.json(fallback.body, { status: fallback.status });
        const response = await getQuestions(
          new NextRequest(
            `http://localhost/api/assessments/${id}/human-requests`,
            {
              headers: {
                cookie: `lcsp_session=test-token; lcsp_locale=${locale}`,
              },
            },
          ),
          { params: Promise.resolve({ id }) },
        );
        const body = await response.json();
        assert.equal(response.status, fallback.expected);
        assert.equal(body.ok, false);
        assert.equal(body.problem.status, response.status);
        assert.equal(calls, 2);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test("canonical reads without locale do not retry localization conflicts", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json(localizationProblem("en"), { status: 409 });
  };
  try {
    const response = await getQuestions(
      new NextRequest(`http://localhost/api/assessments/${id}/human-requests`, {
        headers: { cookie: "lcsp_session=test-token" },
      }),
      { params: Promise.resolve({ id }) },
    );
    assert.equal(response.status, 409);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
