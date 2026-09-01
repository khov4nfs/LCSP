import * as assert from "node:assert/strict";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  AGENTIC_TOOL_NAMES,
  VERIFIED_AGENT_EPISODE_RECORD_STATUSES,
  VERIFIED_AGENT_EPISODE_TRUST_LEVELS,
  VERIFIED_AGENT_EPISODE_VALIDATION_STATUSES,
} from "@lcsp/contracts/evidence";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";

import { AppModule } from "../src/app.module.js";
import { hashSecret } from "../src/modules/auth-workspace/infrastructure/security/security.utils.js";
import {
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  TEST_DATABASE_URL,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, successBody } from "./support/http.js";

const WORKER_KEY = "test-only-worker-api-key-at-least-32-chars";
const ASSESSMENT_ID = "assessment-verified-episodes";
const USER_ID = "user-verified-episodes";

describe("Verified agent episodes internal dispatch (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.WORKER_API_KEY = WORKER_KEY;
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
    await prisma.verifiedAgentEpisode.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    await prisma.user.create({
      data: {
        id: USER_ID,
        email: "verified-episodes@example.com",
        passwordHash: hashSecret("VerifiedEpisodes123!"),
        emailVerified: true,
        failedLoginCount: 0,
        role: AUTH_USER_ROLES.customer,
      },
    });
    await prisma.assessment.create({
      data: {
        id: ASSESSMENT_ID,
        ownerId: USER_ID,
        name: "Verified episodes assessment",
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("captures, retrieves, and expires episodes through internal agentic dispatch", async () => {
    const capture = await dispatch(
      app,
      AGENTIC_TOOL_NAMES.captureVerifiedEpisode,
      {
        record_id: "episode:e2e",
        owner_agent: "planner",
        workflow_run_id: "workflow-e2e",
        assessment_id: ASSESSMENT_ID,
        engineering_rule_ids: ["ENG-1"],
        artifact_versions: { technicalEvidenceReportId: "ter-1" },
        trust_level: VERIFIED_AGENT_EPISODE_TRUST_LEVELS.verifiedExample,
        validation_status: VERIFIED_AGENT_EPISODE_VALIDATION_STATUSES.verified,
        schema_version: "lcsp.verified_episode.v1",
        content_hash: "sha256:e2e",
        domain_key: "planner:ENG-1",
        input_signature: "sha256:input",
        successful_strategy_summary: "READY strategy",
        evidence_refs: ["evidence:e2e"],
        prompt_version: "planner.v1",
        model_id: "test-model",
        summary: "human review planning seed",
        handoff: { status: "READY" },
        expires_at: "2026-09-30T00:00:00.000Z",
      },
    );
    assert.equal(capture.status, 200);
    assert.equal(successBody<{ status: string }>(capture).status, "READY");

    const retrieve = await dispatch(
      app,
      AGENTIC_TOOL_NAMES.retrieveVerifiedEpisodes,
      {
        ownerAgent: "planner",
        engineeringRuleIds: ["ENG-1"],
        artifactVersions: { technicalEvidenceReportId: "ter-1" },
      },
    );
    assert.equal(retrieve.status, 200);
    const retrieved = successBody<{
      episodes: Array<{ record_id: string; domain_key: string }>;
      retrieval: { mode: string };
    }>(retrieve);
    assert.deepEqual(retrieved.retrieval, { mode: "EXACT_FILTER" });
    assert.deepEqual(
      retrieved.episodes.map(({ record_id, domain_key }) => ({
        record_id,
        domain_key,
      })),
      [{ record_id: "episode:e2e", domain_key: "planner:ENG-1" }],
    );

    const active = await prisma.verifiedAgentEpisode.update({
      where: {
        assessmentId_contentHash: {
          assessmentId: ASSESSMENT_ID,
          contentHash: "sha256:e2e",
        },
      },
      data: { expiresAt: new Date("2026-08-29T00:00:00.000Z") },
    });
    assert.equal(active.status, VERIFIED_AGENT_EPISODE_RECORD_STATUSES.active);

    const consolidate = await dispatch(
      app,
      AGENTIC_TOOL_NAMES.consolidateVerifiedEpisodes,
      {},
    );
    assert.equal(consolidate.status, 200);
    const consolidated = successBody<{
      expiredCount: number;
      expiredEpisodeIds: string[];
      activeEpisodeIds: string[];
    }>(consolidate);
    assert.equal(consolidated.expiredCount, 1);
    assert.deepEqual(consolidated.expiredEpisodeIds, ["episode:e2e"]);
    assert.deepEqual(consolidated.activeEpisodeIds, []);
  });
});

function dispatch(
  app: INestApplication,
  toolName: string,
  input: Record<string, unknown>,
) {
  return httpRequest(app)
    .post("/internal/evidence/agentic-tools/dispatch")
    .set("X-Worker-Api-Key", WORKER_KEY)
    .set("X-Correlation-Id", "verified-episodes-e2e")
    .send({
      tool_name: toolName,
      assessment_id: ASSESSMENT_ID,
      workflow_run_id: "workflow-e2e",
      user_id: USER_ID,
      artifact_versions: { technicalEvidenceReportId: "ter-1" },
      input,
      correlationId: "verified-episodes-e2e",
    });
}
