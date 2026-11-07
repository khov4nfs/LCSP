import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { NextRequest } from "../apps/web/node_modules/next/server.js";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  AUTHORED_LOCALIZATION_ENTITIES,
  AUTHORED_LOCALIZATION_STATES,
  AUTHORED_LOCALIZATION_CODES,
  ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
  ASSESSMENT_ARTIFACT_KINDS,
} from "@lcsp/contracts/assessment-domain";
import { assessmentFinalReportArtifactVersionedSchema } from "@lcsp/contracts/assessment-report";
import {
  AuthoredLocalizationService,
  enqueueAuthoredDocument,
  authoredFields,
} from "../apps/api/src/platform/localization/authored-localization.service.ts";
import { LocalePresentationProjectionService } from "../apps/api/src/modules/assessment/infrastructure/presentation/locale-presentation-projection.service.ts";
import { AssessmentReportLoader } from "../apps/api/src/modules/assessment/infrastructure/persistence/assessment-report.loader.ts";
import { decisionFingerprint } from "../apps/api/src/modules/assessment/domain/decision-fingerprint.ts";
import { GET as reportRoute } from "../apps/web/src/app/api/assessments/[id]/artifacts/[artifactId]/report/route.ts";
import { report as v2Report } from "./support/localized-report-fixture.ts";
import { randomUUID } from "node:crypto";
import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_ACTIVITY_KINDS,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DOMAIN_ACTIVITY_LABEL_KEYS,
  ASSESSMENT_AUDIT_MODES,
  RULE_CATALOG_REVIEW_STATES,
  RULE_CATALOG_GROUP_IDS,
} from "@lcsp/contracts/assessment-domain";
import { PREPARATION_ACTIVITY_SCOPES } from "@lcsp/contracts/compliance-rule-set";
import { ListAssessmentEventsHandler } from "../apps/api/src/modules/assessment/application/queries/list-assessment-events/list-assessment-events.handler.ts";
import { ListAssessmentEventsQuery } from "../apps/api/src/modules/assessment/application/queries/list-assessment-events/list-assessment-events.query.ts";
import { AssessmentRuleAuditService } from "../apps/api/src/modules/assessment/application/services/assessment-rule-audit.service.ts";
import { GET as eventsRoute } from "../apps/web/src/app/api/assessments/[id]/events/route.ts";
import { GET as catalogRoute } from "../apps/web/src/app/api/assessments/[id]/rules/route.ts";
import { projectConversation } from "../apps/web/src/features/assessment-runtime/utils/conversation-projection.ts";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const owner = "read-boundary-owner";

/** Persistence double only: actual enqueue, localization, integrity loader and BFF execute unchanged. */
function persistence() {
  const requests: Array<Record<string, any>> = [];
  const artifacts = new Map<string, any>();
  const db = {
    authoredLocalizationRequest: {
      upsert: async ({ create }: any) => {
        let row = requests.find(
          (item) => item.idempotencyKey === create.idempotencyKey,
        );
        if (!row) {
          row = {
            ...create,
            translationRevision: 1,
            state: AUTHORED_LOCALIZATION_STATES.PENDING,
            revision: null,
          };
          requests.push(row);
        }
        return row;
      },
      findMany: async ({ where }: any) =>
        requests.filter((row) =>
          Object.entries(where).every(([key, value]) =>
            key === "originSha256"
              ? (value as { in: string[] }).in.includes(row[key])
              : row[key] === value,
          ),
        ),
    },
    localizedReportArtifact: {
      findUnique: async ({ where }: any) =>
        artifacts.get(
          JSON.stringify(
            where.scopeId_sourceArtifactId_locale_translationRevision,
          ),
        ) ?? null,
      upsert: async ({ where, create }: any) => {
        const key = JSON.stringify(
          where.scopeId_sourceArtifactId_locale_translationRevision,
        );
        if (!artifacts.has(key)) artifacts.set(key, create);
        return artifacts.get(key);
      },
    },
  };
  return {
    db,
    requests,
    artifacts,
    ready() {
      for (const row of requests) {
        const content = `${row.locale}: ${row.originalContent}`;
        row.state = AUTHORED_LOCALIZATION_STATES.READY;
        row.revision = { content, contentSha256: hash(content) };
      }
    },
  };
}

async function setup(version: string) {
  const v2 = v2Report();
  v2.decisionFingerprint = decisionFingerprint(v2.ruleDetails);
  const report =
    version === "V2"
      ? v2
      : {
          schemaVersion: ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
          artifactId: v2.artifactId,
          assessmentId: v2.assessmentId,
          kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
          pins: {
            ruleSetVersionId: v2.pins.ruleSetVersionId,
            repositorySnapshotId: v2.pins.repositorySnapshotId,
            repositoryScanJobId: v2.pins.repositoryScanJobId,
            repositoryCommit: v2.pins.repositoryCommit,
          },
          caseRevision: 1,
          decisionFingerprint: decisionFingerprint([]),
          summary: "Report narrative",
          findings: [],
          provenance: {
            evidenceIds: [],
            factIds: [],
            searchCoverageEvidenceIds: [],
          },
        };
  const canonical = assessmentFinalReportArtifactVersionedSchema.parse(report);
  const bytes = JSON.stringify(canonical);
  const store = persistence();
  await enqueueAuthoredDocument(store.db as never, {
    scopeId: report.assessmentId,
    entityType: AUTHORED_LOCALIZATION_ENTITIES.REPORT,
    entityId: report.artifactId,
    canonicalRevision: hash(bytes),
    document: canonical,
  });
  Object.assign(store.db, {
    assessmentArtifact: {
      findUnique: async () => ({
        ...report,
        lifecycleState: "ACTIVE",
        ruleSetVersionId: report.pins.ruleSetVersionId,
        repositorySnapshotId: report.pins.repositorySnapshotId,
        repositoryCommit: report.pins.repositoryCommit,
        contentSha256: `sha256:${hash(bytes)}`,
        sizeBytes: Buffer.byteLength(bytes),
        storageRef: JSON.stringify({
          artifact_id: report.artifactId,
          total_size: Buffer.byteLength(bytes),
          hash: hash(bytes),
          chunks: ["chunk-0"],
        }),
        assessmentCase: {
          ...report.pins,
          caseRevision: 1,
          assessment: { lifecycleState: "COMPLETE", ownerId: owner },
        },
      }),
    },
    complianceRuleSetVersion: {
      findUnique: async () => ({
        id: v2.pins.ruleSetVersionId,
        version: v2.pins.ruleSetVersion,
        ruleSetDigest: v2.pins.ruleSetDigest,
        legalSourceVersion: {
          id: v2.pins.legalSourceVersionId,
          version: v2.pins.legalSourceVersion,
        },
      }),
    },
  });
  const createLoader = () =>
    new AssessmentReportLoader(
      store.db as never,
      { readAndReconstruct: async () => bytes } as never,
      new LocalePresentationProjectionService(
        new AuthoredLocalizationService(store.db as never),
      ),
    );
  const input = {
    assessmentId: report.assessmentId,
    artifactId: report.artifactId,
    sessionUserId: owner,
    subjectRole: AUTH_USER_ROLES.customer,
    correlationId: "localized-report-contract",
  };
  return { ...store, report: canonical, bytes, input, createLoader };
}

for (const version of ["V1", "V2"] as const)
  for (const locale of ["en", "vi"] as const)
    test(`${version} ${locale}: persisted overlay -> verified API loader -> real BFF full report`, async () => {
      const f = await setup(version);
      f.ready();
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (_url, init) => {
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("authorization"), "Bearer fixture-session");
        assert.equal(headers.get("x-lcsp-locale"), locale);
        const loaded = await f.createLoader().load({ ...f.input, locale });
        assert.equal(loaded.artifactId, f.report.artifactId);
        assert.equal(loaded.sourceArtifactSha256, hash(f.bytes));
        assert.equal(
          loaded.contentSha256,
          hash(loaded.content.toString("utf8")),
        );
        return new Response(new Uint8Array(loaded.content), {
          headers: { "content-type": "application/json" },
        });
      };
      try {
        const response = await reportRoute(
          new NextRequest("http://localhost/report", {
            headers: {
              cookie: `lcsp_session=fixture-session; lcsp_locale=${locale}`,
            },
          }),
          {
            params: Promise.resolve({
              id: f.report.assessmentId,
              artifactId: f.report.artifactId,
            }),
          },
        );
        assert.equal(response.status, 200);
        const result = await response.json();
        const localized = assessmentFinalReportArtifactVersionedSchema.parse(
          result.data,
        );
        assert.equal(localized.artifactId, f.report.artifactId);
        assert.equal(
          localized.decisionFingerprint,
          f.report.decisionFingerprint,
        );
        assert.deepEqual(localized.pins, f.report.pins);
        const originals = authoredFields(f.report),
          translated = authoredFields(localized);
        assert.equal(translated.length, originals.length);
        for (let i = 0; i < originals.length; i++)
          assert.equal(
            translated[i].text,
            `${locale.toUpperCase()}: ${originals[i].text}`,
          );
        if ("factIndex" in localized && "factIndex" in f.report) {
          assert.deepEqual(localized.factIndex, f.report.factIndex);
          assert.deepEqual(localized.evidenceIndex, f.report.evidenceIndex);
          assert.deepEqual(
            localized.ruleDetails[0].sourceRefs,
            f.report.ruleDetails[0].sourceRefs,
          );
        }
        const canonical = await f.createLoader().load(f.input);
        assert.equal(canonical.content.toString("utf8"), f.bytes);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

for (const state of [
  AUTHORED_LOCALIZATION_STATES.PENDING,
  AUTHORED_LOCALIZATION_STATES.FAILED,
])
  test(`report ${state} rejects without fallback`, async () => {
    const f = await setup("V1");
    for (const row of f.requests) row.state = state;
    await assert.rejects(
      f.createLoader().load({ ...f.input, locale: "vi" }),
      (error: any) => {
        assert.equal(
          error.getResponse().problem.code,
          AUTHORED_LOCALIZATION_CODES.INCOMPLETE,
        );
        assert.equal(error.getResponse().problem.meta.state, state);
        return true;
      },
    );
  });

for (const damage of [
  "digest",
  "sourceSha256",
  "sourceArtifactId",
  "localizedArtifactId",
  "locale",
  "translationRevision",
  "protectedPath",
  "missingPath",
])
  test(`report overlay ${damage} integrity rejection`, async () => {
    const f = await setup("V1");
    f.ready();
    await f.createLoader().load({ ...f.input, locale: "vi" });
    const artifact = [...f.artifacts.values()][0];
    if (damage === "digest") artifact.contentSha256 = "0".repeat(64);
    else {
      const overlay = JSON.parse(
        Buffer.from(artifact.content).toString("utf8"),
      );
      if (damage === "protectedPath")
        overlay.localizedFields = { "/artifactId": f.report.artifactId };
      else if (damage === "missingPath") overlay.localizedFields = {};
      else if (
        damage === "sourceArtifactId" ||
        damage === "localizedArtifactId"
      )
        overlay[damage] = randomUUID();
      else
        overlay[damage] =
          damage === "translationRevision"
            ? 2
            : damage === "locale"
              ? "en"
              : "0".repeat(64);
      artifact.content = Buffer.from(JSON.stringify(overlay));
      artifact.contentSha256 = hash(artifact.content.toString("utf8"));
    }
    await assert.rejects(f.createLoader().load({ ...f.input, locale: "vi" }));
  });

test("a corrupt READY translation is an integrity failure, never pending or fallback", async () => {
  const f = await setup("V1");
  f.ready();
  for (const row of f.requests)
    row.revision.content = "corrupt translated bytes";
  await assert.rejects(
    f.createLoader().load({ ...f.input, locale: "vi" }),
    (error: any) =>
      error.getResponse().problem.code ===
      AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
  );
});

test("canonical report corruption rejects before localized artifacts are created", async () => {
  const f = await setup("V1");
  f.ready();
  const original = (f.db as any).assessmentArtifact.findUnique;
  (f.db as any).assessmentArtifact.findUnique = async () => ({
    ...(await original()),
    contentSha256: `sha256:${"0".repeat(64)}`,
  });
  await assert.rejects(f.createLoader().load({ ...f.input, locale: "vi" }));
  assert.equal(f.artifacts.size, 0);
});

test("foreign report owner cannot read localization or freeze an artifact", async () => {
  const f = await setup("V1");
  f.ready();
  f.db.authoredLocalizationRequest.findMany = async () => {
    throw new Error("Foreign owner reached localization lookup");
  };
  await assert.rejects(
    f
      .createLoader()
      .load({ ...f.input, sessionUserId: "foreign", locale: "vi" }),
    (error: any) => error.getStatus() === 404,
  );
  assert.equal(f.artifacts.size, 0);
});

for (const locale of ["en", "vi"] as const)
  test(`${locale} persisted paged events reach the real BFF and conversation unchanged in identity`, async () => {
    const store = persistence(),
      assessmentId = randomUUID(),
      threadId = randomUUID();
    const rows = [1, 2].map((sequence) => ({
      eventId: randomUUID(),
      assessmentId,
      threadId,
      sequence,
      timestamp: new Date("2026-11-08T00:00:00Z"),
      eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.ACTIVITY_RECORDED,
      actorType: ASSESSMENT_EVENT_ACTOR_TYPES.RUNTIME,
      executionId: randomUUID(),
      parentExecutionId: null,
      taskId: null,
      toolCallId: null,
      tokenUsage: null,
      technicalDetailsRef: null,
      payload: {
        kind: ASSESSMENT_ACTIVITY_KINDS.MODEL,
        labelKey: ASSESSMENT_DOMAIN_ACTIVITY_LABEL_KEYS.MODEL_STEP_COMPLETED,
        summary: `Analysis ${sequence}`,
      },
    }));
    const original = structuredClone(rows);
    for (const row of rows)
      await enqueueAuthoredDocument(store.db as never, {
        scopeId: assessmentId,
        entityType: AUTHORED_LOCALIZATION_ENTITIES.EVENT,
        entityId: row.eventId,
        canonicalRevision: String(row.sequence),
        document: row.payload,
      });
    store.ready();
    Object.assign(store.db, {
      assessment: { findUnique: async () => ({ ownerId: owner }) },
      assessmentEvent: {
        findMany: async ({ where, take }: any) =>
          rows.filter((row) => row.sequence > where.sequence.gt).slice(0, take),
      },
    });
    const handler = () =>
      new ListAssessmentEventsHandler(
        store.db as never,
        new AuthoredLocalizationService(store.db as never),
      );
    const fetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      const data = await handler().execute(
        new ListAssessmentEventsQuery(
          assessmentId,
          owner,
          AUTH_USER_ROLES.customer,
          {
            afterSequence: Number(url.searchParams.get("afterSequence")),
            limit: 1,
          },
          "event-read",
          new Headers(init?.headers).get("x-lcsp-locale"),
        ),
      );
      return Response.json({ ok: true, data });
    };
    try {
      const events = [];
      for (let after = 0; after < 2; after++) {
        const response = await eventsRoute(
          new NextRequest(
            `http://localhost/events?afterSequence=${after}&limit=1`,
            {
              headers: {
                cookie: `lcsp_session=fixture; lcsp_locale=${locale}`,
              },
            },
          ),
          { params: Promise.resolve({ id: assessmentId }) },
        );
        assert.equal(response.status, 200);
        const { data } = await response.json();
        assert.equal(data.hasMore, after === 0);
        assert.equal(data.nextAfterSequence, after + 1);
        const event = data.events[0];
        assert.equal(event.eventId, rows[after].eventId);
        assert.equal(event.threadId, threadId);
        assert.equal(
          event.payload.summary,
          `${locale.toUpperCase()}: Analysis ${after + 1}`,
        );
        events.push(event);
      }
      const conversation = projectConversation({
        assessmentId,
        events,
        detail: null,
        requests: [],
        repository: null,
      });
      const work = conversation.turns.find((turn) => "technical" in turn);
      assert.ok(work && "technical" in work);
      assert.deepEqual(
        work.technical.map((event) => event.summary),
        events.map((event) => event.payload.summary),
      );
      assert.deepEqual(rows, original);
      await assert.rejects(
        handler().execute(
          new ListAssessmentEventsQuery(
            assessmentId,
            "foreign",
            AUTH_USER_ROLES.customer,
            { afterSequence: 0, limit: 1 },
            "foreign",
            locale,
          ),
        ),
      );
      for (const row of store.requests) {
        row.state = AUTHORED_LOCALIZATION_STATES.FAILED;
        row.revision = null;
      }
      await assert.rejects(
        handler().execute(
          new ListAssessmentEventsQuery(
            assessmentId,
            owner,
            AUTH_USER_ROLES.customer,
            { afterSequence: 0, limit: 1 },
            "failed",
            locale,
          ),
        ),
        (error: any) =>
          error.getResponse().problem.meta.state ===
          AUTHORED_LOCALIZATION_STATES.FAILED,
      );
    } finally {
      globalThis.fetch = fetch;
    }
  });

for (const locale of ["en", "vi"] as const)
  test(`${locale} catalog localizes only its page, exact rule/requirement revisions and selection identities`, async () => {
    const store = persistence(),
      assessmentId = randomUUID(),
      ruleSetVersionId = randomUUID();
    const rules = [1, 2].map((n) => ({
      assessmentRuleId: `rule-${n}`,
      assessmentRuleVersion: "v1",
      contentDigest: `rule-digest-${n}`,
      concept: `Rule ${n}`,
      legalIntent: `Intent ${n}`,
      legalRequirementLinks: [
        {
          legalRequirement: {
            legalRequirementId: `req-${n}`,
            contentDigest: `requirement-digest-${n}`,
            title: `Requirement ${n}`,
            provenance: [{ documentId: "LAW", locator: `article-${n}` }],
          },
        },
      ],
    }));
    for (const rule of rules) {
      await enqueueAuthoredDocument(store.db as never, {
        scopeId: ruleSetVersionId,
        entityType: AUTHORED_LOCALIZATION_ENTITIES.ASSESSMENT_RULE,
        entityId: rule.assessmentRuleId,
        canonicalRevision: rule.contentDigest,
        document: rule,
      });
      const req = rule.legalRequirementLinks[0].legalRequirement;
      await enqueueAuthoredDocument(store.db as never, {
        scopeId: ruleSetVersionId,
        entityType: AUTHORED_LOCALIZATION_ENTITIES.LEGAL_REQUIREMENT,
        entityId: req.legalRequirementId,
        canonicalRevision: req.contentDigest,
        document: req,
      });
    }
    store.ready();
    let approved = true;
    const memberships = rules.map((rule, ordinal) => ({
      ...rule,
      ordinal,
      groupId: RULE_CATALOG_GROUP_IDS.TESTING_CHANGE_ASSURANCE,
      taxonomyVersion: "v1",
      nameEn: "Testing",
      nameVi: "Kiểm thử",
      descriptionEn: "Reviewed tests",
      descriptionVi: "Kiểm thử đã rà soát",
      rationaleEn: "Fixture reviewed membership",
      rationaleVi: "Phân nhóm fixture",
      actor: "DEVELOPER",
      lifecycleStage: "DEVELOPMENT",
      sourceReferences: [
        { documentId: "LAW", locator: `article-${ordinal + 1}` },
      ],
    }));
    const domainCase = {
      auditMode: ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED,
      auditRequestRevision: 0,
      ruleSetVersionId,
      repositorySnapshotId: randomUUID(),
      repositoryCommit: "a".repeat(40),
    };
    const db = Object.assign(store.db, {
      $transaction: async (fn: any) => fn(db),
      assessment: { findUnique: async () => ({ ownerId: owner, domainCase }) },
      complianceRuleSetVersion: {
        findUnique: async () => ({
          id: ruleSetVersionId,
          ruleSetDigest: "digest",
          targetActivityScope: PREPARATION_ACTIVITY_SCOPES[1],
        }),
      },
      assessmentRule: {
        count: async () => rules.length,
        findMany: async (input: any) =>
          input.select
            ? rules
            : rules.slice(input.skip, input.skip + input.take),
      },
      assessmentRuleAuditItem: { findMany: async () => [] },
      assessmentDecisionCoverage: { findMany: async () => [] },
      assessmentHumanRequest: { findMany: async () => [] },
      assessmentRuleAuditRequest: { findFirst: async () => null },
      ruleCatalogGroupMembership: {
        findMany: async () => (approved ? memberships : []),
      },
    });
    const service = () =>
      new AssessmentRuleAuditService(
        db as never,
        {} as never,
        {} as never,
        new AuthoredLocalizationService(db as never),
      );
    const fetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      return Response.json({
        ok: true,
        data: await service().catalog(
          assessmentId,
          owner,
          "catalog",
          Number(url.searchParams.get("offset")),
          1,
          new Headers(init?.headers).get("x-lcsp-locale"),
        ),
      });
    };
    try {
      const received = [];
      for (let offset = 0; offset < 2; offset++) {
        const response = await catalogRoute(
          new NextRequest(`http://localhost/rules?offset=${offset}&limit=1`, {
            headers: { cookie: `lcsp_session=fixture; lcsp_locale=${locale}` },
          }),
          { params: Promise.resolve({ id: assessmentId }) },
        );
        assert.equal(response.status, 200);
        const { data } = await response.json();
        assert.equal(data.total, 2);
        assert.equal(data.rules.length, 1);
        assert.deepEqual(
          data.groups[0].ruleIds,
          rules.map((rule) => rule.assessmentRuleId),
        );
        assert.equal(
          data.rules[0].concept,
          `${locale.toUpperCase()}: ${rules[offset].concept}`,
        );
        assert.equal(
          data.rules[0].summary,
          `${locale.toUpperCase()}: ${rules[offset].legalIntent}`,
        );
        assert.equal(
          data.rules[0].legalRequirements[0].title,
          `${locale.toUpperCase()}: Requirement ${offset + 1}`,
        );
        assert.equal(
          data.rules[0].assessmentRuleVersion,
          rules[offset].assessmentRuleVersion,
        );
        assert.deepEqual(
          data.rules[0].legalRequirements[0].sources,
          rules[offset].legalRequirementLinks[0].legalRequirement.provenance,
        );
        received.push(data.rules[0].assessmentRuleId);
      }
      assert.deepEqual(
        received,
        rules.map((rule) => rule.assessmentRuleId),
      );
      // A foreign revision with the same authored text cannot substitute for this rule.
      for (const row of store.requests.filter(
        (row) => row.entityId === rules[0].assessmentRuleId,
      ))
        row.canonicalRevision = "foreign-revision";
      await assert.rejects(
        service().catalog(assessmentId, owner, "stale", 0, 1, locale),
      );
      await assert.rejects(
        service().catalog(assessmentId, "foreign", "foreign", 0, 1, locale),
      );
      approved = false;
      const hidden = await service().catalog(
        assessmentId,
        owner,
        "review",
        0,
        1,
        locale,
      );
      assert.equal(
        hidden.groupingState,
        RULE_CATALOG_REVIEW_STATES.REVIEW_REQUIRED,
      );
      assert.deepEqual(hidden.rules, []);
    } finally {
      globalThis.fetch = fetch;
    }
  });
