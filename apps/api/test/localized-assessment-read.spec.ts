import assert from "node:assert/strict";
import { it as test } from "@jest/globals";
import { HttpException } from "@nestjs/common";
import { z } from "zod";
import { readFileSync } from "node:fs";
import {
  Prisma,
  AuthoredLocalizationLocale,
  AuthoredLocalizationState,
} from "@prisma/client";
import { localizedHttpFixture } from "./support/localized-http.fixture.js";
import { createHash } from "node:crypto";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  localizedReportArtifactSchema,
  assessmentEventsPageSchema,
  ruleAuditCatalogSchema,
  AUTHORED_LOCALIZATION_ENTITIES,
  AUTHORED_LOCALIZATION_STATES,
  AUTHORED_LOCALIZATION_CODES,
  ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_DOMAIN_ERROR_CODES,
} from "@lcsp/contracts/assessment-domain";
import { assessmentFinalReportArtifactVersionedSchema } from "@lcsp/contracts/assessment-report";
import {
  AuthoredLocalizationService,
  enqueueAuthoredDocument,
  authoredFields,
} from "../src/platform/localization/authored-localization.service.js";
import { LocalePresentationProjectionService } from "../src/modules/assessment/infrastructure/presentation/locale-presentation-projection.service.js";
import { AssessmentReportLoader } from "../src/modules/assessment/infrastructure/persistence/assessment-report.loader.js";
import { decisionFingerprint } from "../src/modules/assessment/domain/decision-fingerprint.js";
import type { DecisionFingerprintEntry } from "../src/modules/assessment/domain/decision-fingerprint.js";
import { chunkedManifestSchema } from "../src/platform/storage/artifact-storage.service.js";
import { report as v2Report } from "./support/localized-report.fixture.js";
let fixtureId = 100;
const randomUUID = () =>
  `00000000-0000-4000-8000-${String(fixtureId++).padStart(12, "0")}`;
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
import { ListAssessmentEventsHandler } from "../src/modules/assessment/application/queries/list-assessment-events/list-assessment-events.handler.js";
import { ListAssessmentEventsQuery } from "../src/modules/assessment/application/queries/list-assessment-events/list-assessment-events.query.js";
import { AssessmentRuleAuditService } from "../src/modules/assessment/application/services/assessment-rule-audit.service.js";

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
          "../../web/src/public/assets/mocks/localized-assessment-wire.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
const problem = (error: unknown) => {
  assert.ok(error instanceof HttpException);
  return z
    .object({
      problem: z.object({
        code: z.string(),
        meta: z.object({ state: z.string() }).optional(),
      }),
    })
    .parse(error.getResponse()).problem;
};

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const owner = "read-boundary-owner";

/** Persistence double only: actual enqueue, localization, integrity loader and BFF execute unchanged. */
type Revision = { content: string; contentSha256: string };
type RequestRow = Pick<
  Prisma.AuthoredLocalizationRequestUncheckedCreateInput,
  | "idempotencyKey"
  | "scopeId"
  | "entityId"
  | "entityType"
  | "canonicalRevision"
  | "canonicalDigest"
  | "fieldPath"
  | "locale"
  | "originSha256"
  | "originalContent"
> & {
  translationRevision: number;
  state: AuthoredLocalizationState;
  revision: Revision | null;
  translationReviewedBy?: string | null;
  translationReviewedAt?: Date | string | null;
};
type ArtifactKey = {
  scopeId: string;
  sourceArtifactId: string;
  locale: AuthoredLocalizationLocale;
  translationRevision: number;
};
type ArtifactRow = ArtifactKey & {
  id: string;
  sourceSha256: string;
  content: Uint8Array;
  contentSha256: string;
};
type ProjectionWhere = Partial<
  Pick<
    RequestRow,
    "entityId" | "entityType" | "canonicalRevision" | "canonicalDigest"
  >
> & {
  scopeId: string;
  locale: AuthoredLocalizationLocale;
  translationRevision: number;
  originSha256: { in: string[] };
};
function persistence() {
  const requests: RequestRow[] = [];
  const artifacts = new Map<string, ArtifactRow>();
  const db = {
    authoredLocalizationRequest: {
      upsert: ({
        create,
      }: {
        create: Prisma.AuthoredLocalizationRequestUncheckedCreateInput;
      }) => {
        let row = requests.find(
          (item) => item.idempotencyKey === create.idempotencyKey,
        );
        if (!row) {
          row = {
            ...create,
            translationRevision: 1,
            state: AuthoredLocalizationState.PENDING,
            revision: null,
          };
          requests.push(row);
        }
        return Promise.resolve(row);
      },
      findMany: ({ where }: { where: ProjectionWhere }) => {
        const { originSha256, ...binding } = where;
        return Promise.resolve(
          requests.filter(
            (row) =>
              originSha256.in.includes(row.originSha256) &&
              Object.entries(binding).every(
                ([key, value]) => row[key as keyof RequestRow] === value,
              ),
          ),
        );
      },
    },
    localizedReportArtifact: {
      findUnique: ({
        where,
      }: {
        where: {
          scopeId_sourceArtifactId_locale_translationRevision: ArtifactKey;
        };
      }) =>
        Promise.resolve(
          artifacts.get(
            JSON.stringify(
              where.scopeId_sourceArtifactId_locale_translationRevision,
            ),
          ) ?? null,
        ),
      upsert: ({
        where,
        create,
      }: {
        where: {
          scopeId_sourceArtifactId_locale_translationRevision: ArtifactKey;
        };
        create: ArtifactRow;
      }) => {
        const key = JSON.stringify(
          where.scopeId_sourceArtifactId_locale_translationRevision,
        );
        if (!artifacts.has(key)) artifacts.set(key, create);
        return Promise.resolve(artifacts.get(key)!);
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
        row.state = AuthoredLocalizationState.READY;
        row.translationReviewedBy = "isolated-localization-reviewer";
        row.translationReviewedAt = new Date();
        row.revision = { content, contentSha256: hash(content) };
      }
    },
  };
}

async function setup(version: string) {
  const v2 = v2Report();
  const entries: DecisionFingerprintEntry[] = v2.ruleDetails.map((rule) => {
    assert.notEqual(
      rule.decision,
      undefined,
      "V2 fixture must contain each accepted decision",
    );
    return {
      decisionId: rule.decisionId,
      decisionRevision: rule.decisionRevision,
      decision: rule.decision,
    };
  });
  v2.decisionFingerprint = decisionFingerprint(entries);
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
  const db = Object.assign(store.db, {
    assessmentArtifact: {
      findUnique: () =>
        Promise.resolve({
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
      findUnique: () =>
        Promise.resolve({
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
      { readAndReconstruct: () => Promise.resolve(bytes) } as never,
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
  return { ...store, db, report: canonical, bytes, input, createLoader };
}

for (const version of ["V1", "V2"] as const)
  for (const locale of ["en", "vi"] as const)
    test(`${version} ${locale}: persisted overlay -> real authorized API HTTP full report`, async () => {
      const f = await setup(version);
      f.ready();
      const api = await localizedHttpFixture({
        ownerId: owner,
        localization: new AuthoredLocalizationService(f.db as never),
        report: f.createLoader(),
      });
      try {
        const response = await api.get(
          `/assessments/${f.report.assessmentId}/artifacts/${f.report.artifactId}/download`,
          locale,
        );
        assert.equal(response.status, 200);
        const localized = assessmentFinalReportArtifactVersionedSchema.parse(
          JSON.parse(response.text),
        );
        assert.deepEqual(
          localized,
          wire.reports[`${localized.schemaVersion}:${locale}`],
        );
        assert.equal(
          response.headers["x-lcsp-source-artifact-sha256"],
          hash(f.bytes),
        );
        assert.equal(response.headers.etag, `"${hash(response.text)}"`);
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
        await api.close();
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
      (error: unknown) => {
        assert.equal(
          problem(error).code,
          AUTHORED_LOCALIZATION_CODES.INCOMPLETE,
        );
        assert.equal(problem(error).meta?.state, state);
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
      const overlay = localizedReportArtifactSchema.parse(
        JSON.parse(Buffer.from(artifact.content).toString("utf8")),
      );
      if (damage === "protectedPath")
        overlay.localizedFields = { "/artifactId": f.report.artifactId };
      else if (damage === "missingPath") overlay.localizedFields = {};
      else if (
        damage === "sourceArtifactId" ||
        damage === "localizedArtifactId"
      )
        Object.assign(overlay, { [damage]: randomUUID() });
      else
        Object.assign(overlay, {
          [damage]:
            damage === "translationRevision"
              ? 2
              : damage === "locale"
                ? "en"
                : "0".repeat(64),
        });
      artifact.content = Buffer.from(JSON.stringify(overlay));
      artifact.contentSha256 = hash(
        Buffer.from(artifact.content).toString("utf8"),
      );
    }
    await assert.rejects(f.createLoader().load({ ...f.input, locale: "vi" }));
  });

test("a corrupt READY translation is an integrity failure, never pending or fallback", async () => {
  const f = await setup("V1");
  f.ready();
  for (const row of f.requests) {
    assert.ok(row.revision);
    row.revision.content = "corrupt translated bytes";
  }
  await assert.rejects(
    f.createLoader().load({ ...f.input, locale: "vi" }),
    (error: unknown) =>
      problem(error).code === AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
  );
});

test("canonical report corruption rejects before localized artifacts are created", async () => {
  const f = await setup("V1");
  f.ready();
  const original = f.db.assessmentArtifact.findUnique;
  f.db.assessmentArtifact.findUnique = async () => ({
    ...(await original()),
    contentSha256: `sha256:${"0".repeat(64)}`,
  });
  await assert.rejects(f.createLoader().load({ ...f.input, locale: "vi" }));
  assert.equal(f.artifacts.size, 0);
});

test("foreign report owner cannot read localization or freeze an artifact", async () => {
  const f = await setup("V1");
  f.ready();
  f.db.authoredLocalizationRequest.findMany = () =>
    Promise.reject(new Error("Foreign owner reached localization lookup"));
  await assert.rejects(
    f
      .createLoader()
      .load({ ...f.input, sessionUserId: "foreign", locale: "vi" }),
    (error: unknown) =>
      error instanceof HttpException && error.getStatus() === 404,
  );
  assert.equal(f.artifacts.size, 0);
});

test("a report with matching storage hash but incorrect decision fingerprint is rejected", async () => {
  const f = await setup("V2");
  f.ready();
  const corrupt = JSON.stringify({
    ...f.report,
    decisionFingerprint: `sha256:${"0".repeat(64)}`,
  });
  const row = await f.db.assessmentArtifact.findUnique();
  const manifest = chunkedManifestSchema.parse(JSON.parse(row.storageRef));
  f.db.assessmentArtifact.findUnique = () =>
    Promise.resolve({
      ...row,
      contentSha256: `sha256:${hash(corrupt)}`,
      sizeBytes: Buffer.byteLength(corrupt),
      storageRef: JSON.stringify({
        ...manifest,
        hash: hash(corrupt),
        total_size: Buffer.byteLength(corrupt),
      }),
    });
  const loader = new AssessmentReportLoader(
    f.db as never,
    { readAndReconstruct: () => Promise.resolve(corrupt) } as never,
    new LocalePresentationProjectionService(
      new AuthoredLocalizationService(f.db as never),
    ),
  );
  await assert.rejects(
    loader.load({ ...f.input, locale: "vi" }),
    (error: unknown) =>
      problem(error).code ===
      ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_INVALID,
  );
  assert.equal(f.artifacts.size, 0);
});

for (const locale of ["en", "vi"] as const)
  test(`${locale} persisted paged events reach the real API unchanged in identity`, async () => {
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
      assessment: { findUnique: () => Promise.resolve({ ownerId: owner }) },
      assessmentEvent: {
        findMany: ({
          where,
          take,
        }: {
          where: { sequence: { gt: number } };
          take: number;
        }) =>
          Promise.resolve(
            rows
              .filter((row) => row.sequence > where.sequence.gt)
              .slice(0, take),
          ),
      },
    });
    const handler = () =>
      new ListAssessmentEventsHandler(
        store.db as never,
        new AuthoredLocalizationService(store.db as never),
      );
    const api = await localizedHttpFixture({
      ownerId: owner,
      localization: new AuthoredLocalizationService(store.db as never),
      events: handler(),
    });
    try {
      for (let after = 0; after < 2; after++) {
        const response = await api.get(
          `/assessments/${assessmentId}/events?afterSequence=${after}&limit=1`,
          locale,
        );
        assert.equal(response.status, 200);
        const { data } = z
          .object({ ok: z.literal(true), data: assessmentEventsPageSchema })
          .parse(JSON.parse(response.text));
        assert.deepEqual(data, wire.events[`${locale}:${after}`]);
        assert.equal(data.hasMore, after === 0);
        assert.equal(data.nextAfterSequence, after + 1);
        const event = data.events[0];
        assert.ok(
          event.eventType === AGENTIC_ASSESSMENT_EVENT_TYPES.ACTIVITY_RECORDED,
        );
        assert.equal(event.eventId, rows[after].eventId);
        assert.equal(event.threadId, threadId);
        assert.equal(
          event.payload.summary,
          `${locale.toUpperCase()}: Analysis ${after + 1}`,
        );
      }
      // Persisted identity/payload equality is independent of Jest/structuredClone Date realms.
      assert.equal(JSON.stringify(rows), JSON.stringify(original));
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
        (error: unknown) =>
          problem(error).meta?.state === AUTHORED_LOCALIZATION_STATES.FAILED,
      );
    } finally {
      await api.close();
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
      $transaction: (
        fn: (client: Prisma.TransactionClient) => Promise<unknown>,
      ) => Promise.resolve(fn(db as never)),
      assessment: {
        findUnique: () => Promise.resolve({ ownerId: owner, domainCase }),
      },
      complianceRuleSetVersion: {
        findUnique: () =>
          Promise.resolve({
            id: ruleSetVersionId,
            ruleSetDigest: "digest",
            targetActivityScope: PREPARATION_ACTIVITY_SCOPES[1],
          }),
      },
      assessmentRule: {
        count: () => Promise.resolve(rules.length),
        findMany: (input: { select?: object; skip: number; take: number }) =>
          Promise.resolve(
            input.select
              ? rules
              : rules.slice(input.skip, input.skip + input.take),
          ),
      },
      assessmentRuleAuditItem: { findMany: () => Promise.resolve([]) },
      assessmentDecisionCoverage: { findMany: () => Promise.resolve([]) },
      assessmentHumanRequest: { findMany: () => Promise.resolve([]) },
      assessmentRuleAuditRequest: { findFirst: () => Promise.resolve(null) },
      ruleCatalogGroupMembership: {
        findMany: () => Promise.resolve(approved ? memberships : []),
      },
    });
    const service = () =>
      new AssessmentRuleAuditService(
        db as never,
        {} as never,
        {} as never,
        new AuthoredLocalizationService(db as never),
      );
    const api = await localizedHttpFixture({
      ownerId: owner,
      localization: new AuthoredLocalizationService(db as never),
      catalog: service(),
    });
    try {
      const received: string[] = [];
      for (let offset = 0; offset < 2; offset++) {
        const response = await api.get(
          `/assessments/${assessmentId}/rules?offset=${offset}&limit=1`,
          locale,
        );
        assert.equal(response.status, 200);
        const { data } = z
          .object({ ok: z.literal(true), data: ruleAuditCatalogSchema })
          .parse(JSON.parse(response.text));
        assert.deepEqual(data, wire.catalog[`${locale}:${offset}`]);
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
      await api.close();
    }
  });
