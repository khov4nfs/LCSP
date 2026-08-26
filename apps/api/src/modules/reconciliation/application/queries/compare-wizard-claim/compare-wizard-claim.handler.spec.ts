import { jest } from "@jest/globals";
import { EvidenceAcceptanceStatus, WizardProfileStatus } from "@prisma/client";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_STATUSES,
  WIZARD_CLAIM_COMPARISON_SCOPES,
  WIZARD_CLAIM_EXPECTED_VALUES,
  WIZARD_CLAIM_FIELDS,
  WIZARD_CLAIM_VERDICTS,
} from "@lcsp/contracts/evidence";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { CompareWizardClaimHandler } from "./compare-wizard-claim.handler.js";
import { CompareWizardClaimQuery } from "./compare-wizard-claim.query.js";

function buildQuery(
  overrides?: Partial<{
    claimField: (typeof WIZARD_CLAIM_FIELDS)[keyof typeof WIZARD_CLAIM_FIELDS];
    expectedValue: (typeof WIZARD_CLAIM_EXPECTED_VALUES)[keyof typeof WIZARD_CLAIM_EXPECTED_VALUES];
  }>,
) {
  return new CompareWizardClaimQuery(
    "assessment-1",
    "wizard-1",
    "report-1",
    "target:provider_openai",
    overrides?.claimField ?? WIZARD_CLAIM_FIELDS.provider,
    overrides?.expectedValue ?? WIZARD_CLAIM_EXPECTED_VALUES.openai,
    WIZARD_CLAIM_COMPARISON_SCOPES.assessment,
    10,
    "corr-1",
  );
}

function buildHandler(input?: {
  wizardStatus?: WizardProfileStatus;
  payload?: Record<string, unknown>;
}) {
  const prisma = {
    wizardProfile: {
      findFirst: jest.fn<() => Promise<object | null>>().mockResolvedValue({
        id: "wizard-1",
        status: input?.wizardStatus ?? WizardProfileStatus.SUBMITTED,
        answers: [
          { questionId: "externalLlmUsage", value: "yes" },
          { questionId: "humanReview", value: "yes" },
        ],
      }),
    },
    technicalEvidenceReport: {
      findFirst: jest.fn<() => Promise<object | null>>().mockResolvedValue({
        id: "report-1",
        status: EvidenceAcceptanceStatus.ACCEPTED,
        evidencePayload:
          input?.payload ??
          ({
            technical_findings: [
              {
                finding_id: "finding-1",
                finding_type: "AI_PROVIDER_INVOCATION",
                library_group: "openai",
              },
            ],
          } satisfies Record<string, unknown>),
      }),
    },
  } as unknown as PrismaService;
  const audit = {
    write: jest.fn().mockImplementation(() => Promise.resolve()),
  } as unknown as AuditWriterService;

  return {
    handler: new CompareWizardClaimHandler(prisma, audit),
    audit,
  };
}

describe("CompareWizardClaimHandler", () => {
  it("TC-01: returns SUPPORTED for matching provider evidence", async () => {
    const { handler } = buildHandler();

    const response = await handler.execute(buildQuery());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.ready);
    expect(response.coverage_state).toBe(
      AGENTIC_TOOL_COVERAGE_STATES.sufficient,
    );
    expect(response.result.verdict).toBe(WIZARD_CLAIM_VERDICTS.supported);
    expect(response.evidence_refs).toEqual(["finding:finding-1"]);
  });

  it("TC-01: returns CONTRADICTED when sufficient evidence supports another provider", async () => {
    const { handler } = buildHandler({
      payload: {
        technical_findings: [
          {
            finding_id: "finding-2",
            finding_type: "AI_PROVIDER_INVOCATION",
            library_group: "google",
          },
        ],
      },
    });

    const response = await handler.execute(buildQuery());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.conflict);
    expect(response.result.verdict).toBe(WIZARD_CLAIM_VERDICTS.contradicted);
    expect(response.result.conflict_candidate_ref).toContain(
      "conflict-candidate:target:provider_openai",
    );
  });

  it("TC-03: returns OUT_OF_COVERAGE when provider evidence is absent and scan coverage is limited", async () => {
    const { handler } = buildHandler({
      payload: {
        technical_findings: [],
        coverage_notes: [{ code: "SCAN_COVERAGE_LIMITATION" }],
      },
    });

    const response = await handler.execute(buildQuery());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.outOfCoverage);
    expect(response.result.verdict).toBe(WIZARD_CLAIM_VERDICTS.outOfCoverage);
    expect(response.limitations).toContain("COVERAGE_LIMITED");
  });

  it("TC-01: returns SUPPORTED for production deployment context", async () => {
    const { handler } = buildHandler({
      payload: {
        deployment_contexts: [
          {
            context_ref: "deployment:1",
            environment: "PRODUCTION",
            evidence_refs: ["deployment:1"],
          },
        ],
      },
    });

    const response = await handler.execute(
      buildQuery({
        claimField: WIZARD_CLAIM_FIELDS.deploymentContext,
        expectedValue: WIZARD_CLAIM_EXPECTED_VALUES.production,
      }),
    );

    expect(response.result.verdict).toBe(WIZARD_CLAIM_VERDICTS.supported);
    expect(response.evidence_refs).toEqual(["deployment:1"]);
  });

  it("TC-02: returns NEEDS_INPUT when wizard profile is not submitted", async () => {
    const { handler } = buildHandler({
      wizardStatus: WizardProfileStatus.IN_PROGRESS,
    });

    const response = await handler.execute(buildQuery());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.needsInput);
    expect(response.coverage_state).toBe(
      AGENTIC_TOOL_COVERAGE_STATES.unavailable,
    );
  });
});
