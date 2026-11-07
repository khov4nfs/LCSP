import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import { z } from "zod";
import {
  assessmentFinalReportArtifactVersionedSchema,
  buildAssessmentReportPresentation,
} from "@lcsp/contracts/assessment-report";
import {
  AUTHORED_LOCALIZATION_CODES,
  AUTHORED_LOCALIZATION_STATES,
  LOCALIZED_REPORT_SCHEMA_VERSION,
  assessmentEventsPageSchema,
  ruleAuditCatalogSchema,
} from "@lcsp/contracts/assessment-domain";
import { GET as reportRoute } from "../src/app/api/assessments/[id]/artifacts/[artifactId]/report/route.ts";
import { GET as eventsRoute } from "../src/app/api/assessments/[id]/events/route.ts";
import { GET as catalogRoute } from "../src/app/api/assessments/[id]/rules/route.ts";
import { projectConversation } from "../src/features/assessment-runtime/utils/conversation-projection.ts";
import type { AssessmentEvent } from "@lcsp/contracts/assessment";
import type { SubmitRuleAudit } from "@lcsp/contracts/assessment-domain";
import { problemEnvelope } from "../src/lib/api/problem-envelope.ts";

// Validated wire data only. The API producer test verifies these against real HTTP controllers/services.
const wire = z
  .object({
    reports: z.record(z.string(), assessmentFinalReportArtifactVersionedSchema),
    events: z.record(z.string(), assessmentEventsPageSchema),
    catalog: z.record(z.string(), ruleAuditCatalogSchema),
  })
  .parse(
    JSON.parse(
      readFileSync(
        new URL(
          "../src/public/assets/mocks/localized-assessment-wire.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );

function request(path: string, locale: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: { cookie: `lcsp_session=fixture-session; lcsp_locale=${locale}` },
  });
}

for (const [key, report] of Object.entries(wire.reports))
  test(`${key}: JSON BFF supplies the complete versioned report to the view`, async () => {
    const locale = key.split(":")[1];
    const fetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      assert.equal(
        new URL(String(input)).pathname,
        `/assessments/${report.assessmentId}/artifacts/${report.artifactId}/download`,
      );
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer fixture-session");
      assert.equal(headers.get("x-lcsp-locale"), locale);
      return Response.json(report);
    };
    try {
      const response = await reportRoute(request("/report", locale), {
        params: Promise.resolve({
          id: report.assessmentId,
          artifactId: report.artifactId,
        }),
      });
      assert.equal(response.status, 200);
      const result = z
        .object({
          ok: z.literal(true),
          data: assessmentFinalReportArtifactVersionedSchema,
        })
        .parse(await response.json());
      assert.deepEqual(result.data, report);
      assert.equal(result.data.decisionFingerprint, report.decisionFingerprint);
      if ("ruleDetails" in result.data)
        assert.ok(
          buildAssessmentReportPresentation(result.data).sections.length > 0,
        );
      else
        assert.match(
          result.data.summary,
          new RegExp(`^${locale.toUpperCase()}:`),
        );
    } finally {
      globalThis.fetch = fetch;
    }
  });

for (const locale of ["en", "vi"] as const)
  test(`${locale}: paged BFF event history supplies localized conversation narratives`, async () => {
    const first = wire.events[`${locale}:0`];
    const fetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      assert.equal(new Headers(init?.headers).get("x-lcsp-locale"), locale);
      const after = new URL(String(input)).searchParams.get("afterSequence");
      return Response.json({
        ok: true,
        data: wire.events[`${locale}:${after}`],
      });
    };
    try {
      const events: AssessmentEvent[] = [];
      for (const after of [0, 1]) {
        const response = await eventsRoute(
          request(`/events?afterSequence=${after}&limit=1`, locale),
          { params: Promise.resolve({ id: first.assessmentId }) },
        );
        assert.equal(response.status, 200);
        const { data } = z
          .object({ ok: z.literal(true), data: assessmentEventsPageSchema })
          .parse(await response.json());
        assert.deepEqual(data, wire.events[`${locale}:${after}`]);
        events.push(...data.events);
      }
      const projection = projectConversation({
        assessmentId: first.assessmentId,
        events,
        detail: null,
        requests: [],
        repository: null,
      });
      const work = projection.turns.find((turn) => "technical" in turn);
      assert.ok(work && "technical" in work);
      assert.deepEqual(
        work.technical.map((event) => event.summary),
        [
          `${locale.toUpperCase()}: Analysis 1`,
          `${locale.toUpperCase()}: Analysis 2`,
        ],
      );
      assert.deepEqual(
        work.technical.map((event) => event.eventId),
        events.map((event) => event.eventId),
      );
    } finally {
      globalThis.fetch = fetch;
    }
  });

for (const locale of ["en", "vi"] as const)
  test(`${locale}: grouped catalog BFF preserves complete pinned selection across pages`, async () => {
    const first = wire.catalog[`${locale}:0`];
    const fetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      assert.equal(new Headers(init?.headers).get("x-lcsp-locale"), locale);
      const offset = new URL(String(input)).searchParams.get("offset");
      return Response.json({
        ok: true,
        data: wire.catalog[`${locale}:${offset}`],
      });
    };
    try {
      const selected: SubmitRuleAudit["rules"] = [];
      for (const offset of [0, 1]) {
        const response = await catalogRoute(
          request(`/rules?offset=${offset}&limit=1`, locale),
          { params: Promise.resolve({ id: first.assessmentId }) },
        );
        const { data } = z
          .object({ ok: z.literal(true), data: ruleAuditCatalogSchema })
          .parse(await response.json());
        assert.equal(response.status, 200);
        assert.deepEqual(data, wire.catalog[`${locale}:${offset}`]);
        assert.equal(data.ruleSetVersionId, first.ruleSetVersionId);
        assert.equal(data.ruleSetDigest, first.ruleSetDigest);
        assert.equal(data.repositorySnapshotId, first.repositorySnapshotId);
        assert.equal(data.repositoryCommit, first.repositoryCommit);
        for (const rule of data.rules) {
          assert.match(rule.concept, new RegExp(`^${locale.toUpperCase()}:`));
          assert.match(rule.summary, new RegExp(`^${locale.toUpperCase()}:`));
          assert.ok(
            rule.legalRequirements.every((requirement) =>
              requirement.title.startsWith(`${locale.toUpperCase()}:`),
            ),
          );
          selected.push({
            assessmentRuleId: rule.assessmentRuleId,
            assessmentRuleVersion: rule.assessmentRuleVersion,
          });
        }
      }
      assert.deepEqual(selected, [
        { assessmentRuleId: "rule-1", assessmentRuleVersion: "v1" },
        { assessmentRuleId: "rule-2", assessmentRuleVersion: "v1" },
      ]);
      assert.deepEqual(
        first.groups[0].ruleIds,
        selected.map((rule) => rule.assessmentRuleId),
      );
      assert.equal(
        new Set(selected.map((rule) => rule.assessmentRuleId)).size,
        first.total,
      );
    } finally {
      globalThis.fetch = fetch;
    }
  });

for (const state of [
  AUTHORED_LOCALIZATION_STATES.PENDING,
  AUTHORED_LOCALIZATION_STATES.FAILED,
])
  for (const kind of ["report", "events", "catalog"] as const)
    test(`${kind}: ${state} remains an explicit incomplete response through BFF`, async () => {
      const report = Object.values(wire.reports)[0],
        id = report.assessmentId;
      const fetch = globalThis.fetch;
      const envelope = problemEnvelope(
        AUTHORED_LOCALIZATION_CODES.INCOMPLETE,
        409,
        "fixture-correlation",
      );
      const payload = {
        ...envelope,
        problem: { ...envelope.problem, meta: { locale: "vi", state } },
      };
      globalThis.fetch = async () => Response.json(payload, { status: 409 });
      try {
        const response =
          kind === "report"
            ? await reportRoute(request("/report", "vi"), {
                params: Promise.resolve({ id, artifactId: report.artifactId }),
              })
            : kind === "events"
              ? await eventsRoute(request("/events", "vi"), {
                  params: Promise.resolve({ id }),
                })
              : await catalogRoute(request("/rules", "vi"), {
                  params: Promise.resolve({ id }),
                });
        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), payload);
      } finally {
        globalThis.fetch = fetch;
      }
    });

test("JSON BFF rejects an internal overlay instead of presenting it as a report", async () => {
  const report = Object.values(wire.reports)[0],
    fetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      schemaVersion: LOCALIZED_REPORT_SCHEMA_VERSION,
      localizedFields: { "/summary": "overlay" },
    });
  try {
    const response = await reportRoute(request("/report", "vi"), {
      params: Promise.resolve({
        id: report.assessmentId,
        artifactId: report.artifactId,
      }),
    });
    assert.equal(response.status, 502);
  } finally {
    globalThis.fetch = fetch;
  }
});
