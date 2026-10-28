import { describe, expect, it } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_PROVENANCE_SCHEMA_VERSION,
  assessmentProvenanceArtifactSchema,
} from "@lcsp/contracts/assessment-domain";
import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
} from "@lcsp/contracts/assessment";
import { AssessmentProvenanceLoader } from "./assessment-provenance.loader.js";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";

const assessmentId = "11111111-1111-4111-8111-111111111111";
const factId = "22222222-2222-4222-8222-222222222222";
const evidenceId = "33333333-3333-4333-8333-333333333333";
const decisionId = "44444444-4444-4444-8444-444444444444";
const requestId = "55555555-5555-4555-8555-555555555555";
const artifactId = "66666666-6666-4666-8666-666666666666";
const ruleSetVersionId = "77777777-7777-4777-8777-777777777777";
const eventId = "88888888-8888-4888-8888-888888888888";
const snapshotId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const commitSha = "0123456789abcdef0123456789abcdef01234567";
const sha256Hex =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const ownerId = "customer-user-1";
const correlationId = "corr-123";

function buildValidRecord(overrides: Record<string, unknown> = {}) {
  const defaultRecord = {
    id: assessmentId,
    name: "PCI-DSS Assessment",
    ownerId,
    lifecycleState: "ACTIVE",
    lifecycleRevision: 1,
    blockerReason: null,
    blockerReference: null,
    repositorySnapshotId: snapshotId,
    ruleSetVersionId,
    pinnedRepositoryCommit: commitSha,
    pinnedRepositoryHash: sha256Hex,
    pinnedRepositoryTreeHash: sha256Hex,
    pinnedRuleSetHash: sha256Hex,
    repositoryConnectionId: "conn-1",
    runtime: {
      assessmentId,
      threadId: assessmentId,
      rootAgentVersion: "1.0.0",
      checkpointNamespace: assessmentId,
      checkpointId: null,
      currentExecutionId: null,
      executionState: "RUNNING",
      eventSequence: 1,
      startedAt: new Date("2026-10-17T09:00:00Z"),
      lastResumedAt: null,
      createdAt: new Date("2026-10-17T09:00:00Z"),
      updatedAt: new Date("2026-10-17T10:00:00Z"),
    },
    domainCase: {
      assessmentId,
      caseRevision: 3,
      ruleSetVersionId,
      repositorySnapshotId: snapshotId,
      repositoryScanJobId: "job-1",
      repositoryCommit: commitSha,
      pinnedAt: new Date("2026-10-17T09:00:00Z"),
      ruleSet: {
        id: ruleSetVersionId,
        version: "1.0.0",
        legalSourceVersion: {
          version: "1.0.0",
        },
        _count: {
          rules: 10,
          assessmentRules: 5,
        },
      },
      facts: [
        {
          factId,
          assessmentId,
          caseRevision: 1,
          kind: "FACT",
          authority: "EVIDENCE_CITED",
          state: "ACCEPTED",
          statement: "Encryption configured at rest.",
          invalidatedAt: null,
          evidenceLinks: [
            {
              assessmentId,
              factId,
              evidenceId,
            },
          ],
          createdAt: new Date("2026-10-17T09:10:00Z"),
          updatedAt: new Date("2026-10-17T09:10:00Z"),
        },
      ],
      evidence: [
        {
          evidenceId,
          assessmentId,
          type: "REPOSITORY_SOURCE",
          state: "ACCEPTED",
          repositoryCommit: commitSha,
          contentSha256: `sha256:${sha256Hex}`,
          payload: {
            path: "config.json",
            apiKey: "secret-key-123",
            systemPrompt: "You are an internal auditor...",
            reasoning: "Private chain of thought...",
          },
          invalidatedAt: null,
          createdAt: new Date("2026-10-17T09:05:00Z"),
        },
      ],
      decisions: [
        {
          decisionId,
          assessmentId,
          ruleSetVersionId,
          assessmentRuleId: "rule-item-1",
          scopeId: "global",
          decisionRevision: 1,
          state: "ACCEPTED",
          repositoryCommit: commitSha,
          caseRevision: 1,
          decision: {
            scopeId: "global",
            assessmentRuleId: "rule-item-1",
            assessmentRuleVersion: "1.0.0",
            ruleSetVersionId,
            repositorySnapshotId: snapshotId,
            repositoryCommit: commitSha,
            caseRevision: 1,
            applicability: "APPLICABLE",
            rationale: "Configured properly",
            legalContextRefs: [{ legalContextId: "lc-1" }],
            references: [
              {
                type: "ASSESSMENT_EVIDENCE",
                evidenceId,
              },
            ] as Array<{
              type: string;
              evidenceId?: string;
              factId?: string;
              caseRevision?: number;
            }>,
            criteria: [
              {
                criterionId: "crit-1",
                outcome: "MET",
                rationale: "Met criterion",
                references: [
                  {
                    type: "ASSESSMENT_EVIDENCE",
                    evidenceId,
                  },
                ],
              },
            ],
            compliance: "COMPLIANT",
          },
          createdAt: new Date("2026-10-17T09:20:00Z"),
        },
      ],
      coverage: [
        {
          assessmentId,
          ruleSetVersionId,
          assessmentRuleId: "rule-item-1",
          assessmentRuleVersion: "1.0.0",
          resolutionState: "RESOLVED",
          currentDecisionId: decisionId,
          decisionRevision: 1,
          concept: "ENCRYPTION_REST",
          assessmentRule: {
            concept: "ENCRYPTION_REST",
          },
        },
      ],
      humanRequests: [
        {
          requestId,
          assessmentId,
          threadId: assessmentId,
          status: "RESOLVED",
          caseRevision: 1,
          requestRevision: 1,
          assessmentRuleId: "rule-item-1",
          criterionIds: ["crit-1"],
          question: "Confirm database encryption key rotation period",
          unresolvedFact: "Rotation period",
          decisionImpact: ["Determines compliance of rule-item-1"],
          resolutionAttempts: ["Attempted automated search"],
          controlType: "FREE_TEXT",
          choices: [],
          answers: [
            {
              idempotencyKey: "idem-ans-1",
              requestDigest: sha256Hex,
              actorId: ownerId,
              caseRevision: 1,
              requestRevision: 1,
              doesNotKnow: false,
              answer: "Keys are rotated every 90 days via KMS.",
              answeredAt: "2026-10-17T09:15:00Z",
            },
          ],
          checkpointId: null,
          resolvedFactId: factId,
          createdAt: new Date("2026-10-17T09:12:00Z"),
          resolvedAt: new Date("2026-10-17T09:15:00Z"),
        },
      ],
      artifacts: [
        {
          id: "art-row-1",
          artifactId,
          assessmentId,
          kind: "FINAL_REPORT",
          lifecycleState: "ACTIVE",
          ruleSetVersionId,
          repositorySnapshotId: snapshotId,
          repositoryCommit: commitSha,
          caseRevision: 3,
          contentSha256: sha256Hex,
          sizeBytes: 2048,
          createdAt: new Date("2026-10-17T09:30:00Z"),
        },
      ],
    },
    events: [
      {
        id: "evt-1",
        eventId,
        assessmentId,
        threadId: assessmentId,
        sequence: 1,
        timestamp: new Date("2026-10-17T09:01:00Z"),
        eventType: "EVIDENCE_ACCEPTED",
        actorType: "API",
        payload: {
          evidenceId,
          caseRevision: 1,
        },
      },
    ],
  };

  return { ...defaultRecord, ...overrides };
}

describe("AssessmentProvenanceLoader", () => {
  it("preserves a human request opening event's required null previous status", async () => {
    const record = buildValidRecord({
      events: [
        {
          ...buildValidRecord().events[0],
          eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.HUMAN_RESOLUTION_CHANGED,
          actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
          payload: {
            requestId,
            fromStatus: null,
            toStatus: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
            caseRevision: 1,
          },
        },
      ],
    });
    const originalEvents = structuredClone(record.events);
    const prisma = {
      assessment: { findUnique: () => Promise.resolve(record) },
    } as unknown as PrismaService;
    const result = await new AssessmentProvenanceLoader(prisma).load({
      assessmentId,
      sessionUserId: ownerId,
      subjectRole: AUTH_USER_ROLES.customer,
      correlationId,
    });

    expect(result.events).toMatchObject([
      {
        eventId,
        eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.HUMAN_RESOLUTION_CHANGED,
        payload: {
          requestId,
          fromStatus: null,
          toStatus: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
        },
      },
    ]);
    expect(record.events).toEqual(originalEvents);
    expect(() =>
      assessmentProvenanceArtifactSchema.parse(result),
    ).not.toThrow();
  });

  it("assembles canonical provenance artifact with deterministic checksum and validates against schema", async () => {
    const record = buildValidRecord();
    const prisma = {
      assessment: {
        findUnique: () => Promise.resolve(record),
      },
    } as unknown as PrismaService;

    const loader = new AssessmentProvenanceLoader(prisma);
    const result = await loader.load({
      assessmentId,
      sessionUserId: ownerId,
      subjectRole: AUTH_USER_ROLES.customer,
      correlationId,
    });

    expect(result.schemaVersion).toBe(ASSESSMENT_PROVENANCE_SCHEMA_VERSION);
    expect(result.assessmentId).toBe(assessmentId);
    expect(result.name).toBe("PCI-DSS Assessment");
    expect(result.ownerId).toBe(ownerId);
    expect(result.correlationId).toBe(correlationId);
    expect(result.pins?.repositoryCommit).toBe(commitSha);
    expect(result.pins?.ruleSet?.version).toBe("1.0.0");
    expect(result.acceptedFacts).toHaveLength(1);
    expect(result.acceptedEvidence).toHaveLength(1);
    expect(result.humanResolutions).toHaveLength(1);
    expect(result.humanResolutions[0]?.answers[0]?.answer).toBe(
      "Keys are rotated every 90 days via KMS.",
    );
    expect(result.decisions).toHaveLength(1);
    expect(result.coverage).toHaveLength(1);
    expect(result.events).toHaveLength(1);
    expect(result.artifacts).toHaveLength(1);
    expect(result.checksumSha256).toBeDefined();

    // Verify valid against contracts zod schema
    expect(() =>
      assessmentProvenanceArtifactSchema.parse(result),
    ).not.toThrow();
  });

  it("redacts sensitive fields, private reasoning, and system prompts from event payloads", async () => {
    const record = buildValidRecord();
    const prisma = {
      assessment: {
        findUnique: () => Promise.resolve(record),
      },
    } as unknown as PrismaService;

    const loader = new AssessmentProvenanceLoader(prisma);
    const result = await loader.load({
      assessmentId,
      sessionUserId: ownerId,
      subjectRole: AUTH_USER_ROLES.customer,
      correlationId,
    });

    const evidence = result.acceptedEvidence[0];
    expect(evidence).toBeDefined();
    expect(evidence?.payload).toHaveProperty("apiKey", "[REDACTED]");
    expect(evidence?.payload).toHaveProperty(
      "systemPrompt",
      "[HIDDEN_PRIVATE_RUNTIME_STATE]",
    );
    expect(evidence?.payload).toHaveProperty(
      "reasoning",
      "[HIDDEN_PRIVATE_RUNTIME_STATE]",
    );
    expect(evidence?.payload).toHaveProperty("path", "config.json");
  });

  it("throws notFound (404) when a customer attempts to load another customer's assessment", async () => {
    const record = buildValidRecord({ ownerId: "different-owner" });
    const prisma = {
      assessment: {
        findUnique: () => Promise.resolve(record),
      },
    } as unknown as PrismaService;

    const loader = new AssessmentProvenanceLoader(prisma);

    await expect(
      loader.load({
        assessmentId,
        sessionUserId: "attacker-customer",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId,
      }),
    ).rejects.toMatchObject({
      status: 404,
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: ASSESSMENT_ERROR_CODES.notFound,
        }),
      }),
    });
  });

  it("permits admin users to load provenance for any owner", async () => {
    const record = buildValidRecord({ ownerId: "different-owner" });
    const prisma = {
      assessment: {
        findUnique: () => Promise.resolve(record),
      },
    } as unknown as PrismaService;

    const loader = new AssessmentProvenanceLoader(prisma);

    const result = await loader.load({
      assessmentId,
      sessionUserId: "admin-user",
      subjectRole: AUTH_USER_ROLES.admin,
      correlationId,
    });

    expect(result.assessmentId).toBe(assessmentId);
  });

  it("fails closed with PROVENANCE_INTEGRITY_MISMATCH if a fact belongs to a foreign assessment", async () => {
    const record = buildValidRecord();
    record.domainCase.facts[0] = {
      ...record.domainCase.facts[0],
      assessmentId: "99999999-9999-4999-8999-999999999999",
    };

    const prisma = {
      assessment: {
        findUnique: () => Promise.resolve(record),
      },
    } as unknown as PrismaService;

    const loader = new AssessmentProvenanceLoader(prisma);

    await expect(
      loader.load({
        assessmentId,
        sessionUserId: ownerId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        }),
      }),
    });
  });

  it("fails closed with PROVENANCE_INTEGRITY_MISMATCH if evidence belongs to a foreign assessment", async () => {
    const record = buildValidRecord();
    record.domainCase.evidence[0] = {
      ...record.domainCase.evidence[0],
      assessmentId: "99999999-9999-4999-8999-999999999999",
    };

    const prisma = {
      assessment: {
        findUnique: () => Promise.resolve(record),
      },
    } as unknown as PrismaService;

    const loader = new AssessmentProvenanceLoader(prisma);

    await expect(
      loader.load({
        assessmentId,
        sessionUserId: ownerId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        }),
      }),
    });
  });

  it("fails closed with PROVENANCE_INTEGRITY_MISMATCH if a fact references nonexistent evidence", async () => {
    const record = buildValidRecord();
    record.domainCase.facts[0] = {
      ...record.domainCase.facts[0],
      evidenceLinks: [
        {
          assessmentId,
          factId,
          evidenceId: "99999999-9999-4999-8999-999999999999",
        },
      ],
    };

    const prisma = {
      assessment: {
        findUnique: () => Promise.resolve(record),
      },
    } as unknown as PrismaService;

    const loader = new AssessmentProvenanceLoader(prisma);

    await expect(
      loader.load({
        assessmentId,
        sessionUserId: ownerId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        }),
      }),
    });
  });

  it("fails closed with PROVENANCE_INTEGRITY_MISMATCH if a decision belongs to a foreign assessment", async () => {
    const record = buildValidRecord();
    record.domainCase.decisions[0] = {
      ...record.domainCase.decisions[0],
      assessmentId: "99999999-9999-4999-8999-999999999999",
    };

    const prisma = {
      assessment: {
        findUnique: () => Promise.resolve(record),
      },
    } as unknown as PrismaService;

    const loader = new AssessmentProvenanceLoader(prisma);

    await expect(
      loader.load({
        assessmentId,
        sessionUserId: ownerId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        }),
      }),
    });
  });

  it("fails closed with PROVENANCE_INTEGRITY_MISMATCH if a human request belongs to a foreign assessment", async () => {
    const record = buildValidRecord();
    record.domainCase.humanRequests[0] = {
      ...record.domainCase.humanRequests[0],
      assessmentId: "99999999-9999-4999-8999-999999999999",
    };

    const prisma = {
      assessment: {
        findUnique: () => Promise.resolve(record),
      },
    } as unknown as PrismaService;

    const loader = new AssessmentProvenanceLoader(prisma);

    await expect(
      loader.load({
        assessmentId,
        sessionUserId: ownerId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        }),
      }),
    });
  });

  it("fails closed with PROVENANCE_INTEGRITY_MISMATCH if an event belongs to a foreign assessment", async () => {
    const record = buildValidRecord();
    record.events[0] = {
      ...record.events[0],
      assessmentId: "99999999-9999-4999-8999-999999999999",
    };

    const prisma = {
      assessment: {
        findUnique: () => Promise.resolve(record),
      },
    } as unknown as PrismaService;

    const loader = new AssessmentProvenanceLoader(prisma);

    await expect(
      loader.load({
        assessmentId,
        sessionUserId: ownerId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        }),
      }),
    });
  });

  it("fails closed with PROVENANCE_INTEGRITY_MISMATCH if runtime threadId does not match assessmentId", async () => {
    const record = buildValidRecord();
    record.runtime = {
      ...record.runtime,
      threadId: "99999999-9999-4999-8999-999999999999",
    };

    const prisma = {
      assessment: {
        findUnique: () => Promise.resolve(record),
      },
    } as unknown as PrismaService;

    const loader = new AssessmentProvenanceLoader(prisma);

    await expect(
      loader.load({
        assessmentId,
        sessionUserId: ownerId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        }),
      }),
    });
  });

  it("fails closed with PROVENANCE_INTEGRITY_MISMATCH if a decision references nonexistent evidence", async () => {
    const record = buildValidRecord();
    record.domainCase.decisions[0].decision = {
      ...record.domainCase.decisions[0].decision,
      references: [
        {
          type: "ASSESSMENT_EVIDENCE",
          evidenceId: "99999999-9999-4999-8999-999999999999",
        },
      ],
    };

    const prisma = {
      assessment: {
        findUnique: () => Promise.resolve(record),
      },
    } as unknown as PrismaService;

    const loader = new AssessmentProvenanceLoader(prisma);

    await expect(
      loader.load({
        assessmentId,
        sessionUserId: ownerId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        }),
      }),
    });
  });

  it("fails closed with PROVENANCE_INTEGRITY_MISMATCH if a decision references nonexistent fact", async () => {
    const record = buildValidRecord();
    record.domainCase.decisions[0].decision = {
      ...record.domainCase.decisions[0].decision,
      references: [
        {
          type: "CONFIRMED_FACT",
          factId: "99999999-9999-4999-8999-999999999999",
          caseRevision: 1,
        },
      ],
    };

    const prisma = {
      assessment: {
        findUnique: () => Promise.resolve(record),
      },
    } as unknown as PrismaService;

    const loader = new AssessmentProvenanceLoader(prisma);

    await expect(
      loader.load({
        assessmentId,
        sessionUserId: ownerId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        }),
      }),
    });
  });

  it("fails closed with PROVENANCE_INTEGRITY_MISMATCH if coverage.currentDecisionId does not resolve to a valid decision", async () => {
    const record = buildValidRecord();
    record.domainCase.coverage[0] = {
      ...record.domainCase.coverage[0],
      currentDecisionId: "99999999-9999-4999-8999-999999999999",
    };

    const prisma = {
      assessment: {
        findUnique: () => Promise.resolve(record),
      },
    } as unknown as PrismaService;

    const loader = new AssessmentProvenanceLoader(prisma);

    await expect(
      loader.load({
        assessmentId,
        sessionUserId: ownerId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        }),
      }),
    });
  });

  it("fails closed with PROVENANCE_INTEGRITY_MISMATCH if human request resolvedFactId references nonexistent fact", async () => {
    const record = buildValidRecord();
    record.domainCase.humanRequests[0] = {
      ...record.domainCase.humanRequests[0],
      resolvedFactId: "99999999-9999-4999-8999-999999999999",
    };

    const prisma = {
      assessment: {
        findUnique: () => Promise.resolve(record),
      },
    } as unknown as PrismaService;

    const loader = new AssessmentProvenanceLoader(prisma);

    await expect(
      loader.load({
        assessmentId,
        sessionUserId: ownerId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        }),
      }),
    });
  });

  it("fails closed with PROVENANCE_INTEGRITY_MISMATCH if decision commit or pins mismatch canonical case", async () => {
    const record = buildValidRecord();
    record.domainCase.decisions[0].decision = {
      ...record.domainCase.decisions[0].decision,
      repositoryCommit: "ffffffffffffffffffffffffffffffffffffffff",
    };

    const prisma = {
      assessment: {
        findUnique: () => Promise.resolve(record),
      },
    } as unknown as PrismaService;

    const loader = new AssessmentProvenanceLoader(prisma);

    await expect(
      loader.load({
        assessmentId,
        sessionUserId: ownerId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        }),
      }),
    });
  });

  it("fails closed with PROVENANCE_INTEGRITY_MISMATCH if evidence commit does not match pinned case commit", async () => {
    const record = buildValidRecord();
    record.domainCase.evidence[0] = {
      ...record.domainCase.evidence[0],
      repositoryCommit: "ffffffffffffffffffffffffffffffffffffffff",
    };

    const prisma = {
      assessment: {
        findUnique: () => Promise.resolve(record),
      },
    } as unknown as PrismaService;

    const loader = new AssessmentProvenanceLoader(prisma);

    await expect(
      loader.load({
        assessmentId,
        sessionUserId: ownerId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        }),
      }),
    });
  });

  it("fails closed with PROVENANCE_INTEGRITY_MISMATCH if final artifact pins mismatch canonical case", async () => {
    const record = buildValidRecord();
    record.domainCase.artifacts[0] = {
      ...record.domainCase.artifacts[0],
      repositoryCommit: "ffffffffffffffffffffffffffffffffffffffff",
    };

    const prisma = {
      assessment: {
        findUnique: () => Promise.resolve(record),
      },
    } as unknown as PrismaService;

    const loader = new AssessmentProvenanceLoader(prisma);

    await expect(
      loader.load({
        assessmentId,
        sessionUserId: ownerId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        }),
      }),
    });
  });

  it("computes deterministic content fingerprint across multiple requests and changes when provenance changes", async () => {
    const record1 = buildValidRecord();
    const prisma1 = {
      assessment: { findUnique: () => Promise.resolve(record1) },
    } as unknown as PrismaService;
    const loader1 = new AssessmentProvenanceLoader(prisma1);

    const result1 = await loader1.load({
      assessmentId,
      sessionUserId: ownerId,
      subjectRole: AUTH_USER_ROLES.customer,
      correlationId: "correlation-attempt-1",
    });

    // Second call with different correlationId
    const result2 = await loader1.load({
      assessmentId,
      sessionUserId: ownerId,
      subjectRole: AUTH_USER_ROLES.customer,
      correlationId: "correlation-attempt-2",
    });

    // Content fingerprint is identical despite volatile correlationId
    expect(result1.contentFingerprintSha256).toBe(
      result2.contentFingerprintSha256,
    );
    expect(result1.checksumSha256).toBe(result2.checksumSha256);
    expect(result1.contentFingerprintSha256).toBe(result1.checksumSha256);
    expect(result1.correlationId).not.toBe(result2.correlationId);

    // Now change canonical state: add an accepted fact
    const record2 = buildValidRecord();
    record2.domainCase.facts.push({
      factId: "99999999-9999-4999-8999-999999999999",
      assessmentId,
      caseRevision: 2,
      kind: "FACT",
      authority: "EVIDENCE_CITED",
      state: "ACCEPTED",
      statement: "New secondary security fact.",
      invalidatedAt: null,
      evidenceLinks: [],
      createdAt: new Date("2026-10-17T09:15:00Z"),
      updatedAt: new Date("2026-10-17T09:15:00Z"),
    });
    const prisma2 = {
      assessment: { findUnique: () => Promise.resolve(record2) },
    } as unknown as PrismaService;
    const loader2 = new AssessmentProvenanceLoader(prisma2);

    const result3 = await loader2.load({
      assessmentId,
      sessionUserId: ownerId,
      subjectRole: AUTH_USER_ROLES.customer,
      correlationId: "correlation-attempt-3",
    });

    expect(result3.contentFingerprintSha256).not.toBe(
      result1.contentFingerprintSha256,
    );
    expect(result3.checksumSha256).not.toBe(result1.checksumSha256);
  });
});
