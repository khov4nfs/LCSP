import * as assert from "node:assert/strict";

import { PrismaPg } from "@prisma/adapter-pg";
import { LegalRetrievalIndexStatus, PrismaClient } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import { AppModule } from "../src/app.module.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, successBody } from "./support/http.js";

const ORGANIZATION_ID = "org-1";
const ASSESSMENT_ID = "assessment-legal-readiness";
const CORPUS_ID = "corpus-ready-01";
const INDEX_ID = "index-ready-01";

describe("Legal corpus readiness endpoint (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let managerToken: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    pushPrismaSchema();
    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await prisma.legalRetrievalIndex.deleteMany();
    await prisma.corpusApprovalRecord.deleteMany();
    await prisma.legalDocumentChunk.deleteMany();
    await prisma.legalSourceDocument.deleteMany();
    await prisma.legalCorpusVersion.deleteMany();
    await prisma.assessment.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);

    const policy = await prisma.authPolicy.findUniqueOrThrow({
      where: {
        id_version: {
          id: "policy-manager-workspace",
          version: "2026-06-26",
        },
      },
      select: { actions: true },
    });
    await prisma.authPolicy.update({
      where: {
        id_version: {
          id: "policy-manager-workspace",
          version: "2026-06-26",
        },
      },
      data: { actions: [...policy.actions, PBAC_ACTIONS.legalCorpusRead] },
    });
    await prisma.assessment.create({
      data: {
        id: ASSESSMENT_ID,
        organizationId: ORGANIZATION_ID,
        ownerId: "user-1",
        name: "Legal readiness assessment",
      },
    });
    await seedReadyCorpus(prisma);
    managerToken = await signIn(app);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("TC-01/TC-05: returns a validated pinned readiness projection without corpus text or URLs", async () => {
    const response = await httpRequest(app)
      .get(
        `/assessments/${ASSESSMENT_ID}/legal-corpus-readiness?effective_date=2026-08-12&pinned_corpus_version_id=corpus_${CORPUS_ID}`,
      )
      .set("Authorization", `Bearer ${managerToken}`);

    assert.equal(response.status, 200);
    const data = successBody<{
      status: string;
      evidenceRefs: string[];
      result: { corpusVersionId: string; indexVersionId: string };
    }>(response);
    assert.equal(data.status, "READY");
    assert.equal(data.result.corpusVersionId, `corpus_${CORPUS_ID}`);
    assert.equal(data.result.indexVersionId, `index_${INDEX_ID}`);
    assert.ok(
      data.evidenceRefs.includes("retrieval-validation:index-ready-v1"),
    );
    assert.equal(
      JSON.stringify(response.body).includes("must never leak"),
      false,
    );
    assert.equal(
      JSON.stringify(response.body).includes("official.example"),
      false,
    );

    const audit = await prisma.authAuditEvent.findFirst({
      where: { eventType: "AGENTIC_TOOL_LEGAL_CORPUS_READINESS_READ" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(audit);
    assert.equal(
      JSON.stringify(audit.payload).includes("must never leak"),
      false,
    );
  });

  it("TC-03: PBAC denial is fail-closed and recorded", async () => {
    await prisma.authPolicy.update({
      where: {
        id_version: {
          id: "policy-manager-workspace",
          version: "2026-06-26",
        },
      },
      data: { actions: [PBAC_ACTIONS.assessmentRead] },
    });

    const response = await httpRequest(app)
      .get(
        `/assessments/${ASSESSMENT_ID}/legal-corpus-readiness?effective_date=2026-08-12`,
      )
      .set("Authorization", `Bearer ${managerToken}`);

    assert.equal(response.status, 403);
    const decision = await prisma.authDecisionLog.findFirst({
      where: { action: PBAC_ACTIONS.legalCorpusRead },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(decision?.decision, "DENY");
  });

  it("TC-04: a corpus without a validated index is explicitly blocked", async () => {
    await prisma.legalRetrievalIndex.deleteMany();

    const response = await httpRequest(app)
      .get(
        `/assessments/${ASSESSMENT_ID}/legal-corpus-readiness?effective_date=2026-08-12`,
      )
      .set("Authorization", `Bearer ${managerToken}`);

    assert.equal(response.status, 200);
    const data = successBody<{
      status: string;
      result: { readiness: string; missingRequirements: string[] };
    }>(response);
    assert.equal(data.status, "BLOCKED");
    assert.equal(data.result.readiness, "INDEX_INVALID");
    assert.deepEqual(data.result.missingRequirements, [
      "VALID_RETRIEVAL_INDEX",
    ]);
  });
});

async function seedReadyCorpus(prisma: PrismaClient): Promise<void> {
  await prisma.legalCorpusVersion.create({
    data: {
      id: CORPUS_ID,
      version: "corpus-ready-v1",
      status: "APPROVED",
      sourceManifest: {
        sourceUrl: "https://official.example/private",
        rawSourceText: "must never leak",
      },
      approvedAt: new Date("2026-01-01T00:00:00.000Z"),
      retrievalIndexes: {
        create: {
          id: INDEX_ID,
          version: "index-ready-v1",
          status: LegalRetrievalIndexStatus.VALID,
          configHash:
            "sha256:2e5606c22f82d4607160a3d8743ce3489b15616c44333c008242f432780394b1",
          contentHash:
            "sha256:6ff279fb6419f64bc17f02eec2296a4e3de1a9d61eaad77ef19b8235c3948232",
          validationManifestRef: "retrieval-validation:index-ready-v1",
          validatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      },
    },
  });
}

async function signIn(app: INestApplication): Promise<string> {
  const response = await httpRequest(app).post("/auth/sign-in").send({
    email: "manager@acme.test",
    password: "CorrectHorseBatteryStaple!",
    organization_id: ORGANIZATION_ID,
  });
  return String(
    successBody<{ session_token?: string }>(response).session_token ?? "",
  );
}
