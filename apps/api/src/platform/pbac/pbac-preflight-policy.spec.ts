import { PBAC_DECISION } from "@lcsp/contracts/pbac";
import { jest } from "@jest/globals";

import { PbacPreflightService } from "./pbac-preflight.service.js";

describe("PbacPreflightService trusted policy context", () => {
  function buildService() {
    const memberships = {
      findByUserAndOrganization: jest.fn(() =>
        Promise.resolve({
          policyId: "policy-1",
          policyVersion: "v7",
          status: "ACTIVE",
          subjectAttributes: {},
          role: () => "Owner",
        }),
      ),
    };
    const policies = {
      findByIdAndVersion: jest.fn(() =>
        Promise.resolve({
          id: "policy-1",
          organizationId: "org-1",
          version: "v7",
          subjectRole: "Owner",
          stateGate: "ACTIVE",
          actions: ["classification:review:submit"],
        }),
      ),
    };
    const evaluator = {
      evaluate: jest.fn(() => ({
        decision: PBAC_DECISION.allow,
        reasonCode: null,
        policyId: "policy-1",
        policyVersion: "v7",
      })),
    };
    const decisions = {
      append: jest.fn(() => Promise.resolve(undefined)),
    };

    return {
      service: new PbacPreflightService(
        memberships as never,
        policies as never,
        evaluator as never,
        decisions,
      ),
      decisions,
    };
  }

  it("returns trusted policy metadata only from evaluateWithPolicy", async () => {
    const { service } = buildService();
    const input = {
      userId: "user-1",
      organizationId: "org-1",
      action: "classification:review:submit",
      correlationId: "correlation-1",
    };

    const enriched = await service.evaluateWithPolicy(input);
    expect(enriched).toEqual({
      decision: PBAC_DECISION.allow,
      reasonCode: null,
      correlationId: "correlation-1",
      policyId: "policy-1",
      policyVersion: "v7",
    });

    const publicResult = await service.evaluate(input);
    expect(publicResult).toEqual({
      decision: PBAC_DECISION.allow,
      reasonCode: null,
      correlationId: "correlation-1",
    });
    expect("policyId" in publicResult).toBe(false);
    expect("policyVersion" in publicResult).toBe(false);
  });

  it("fails closed with no trusted policy metadata on evaluator deny", async () => {
    const { service } = buildService();
    const evaluator = (
      service as unknown as { evaluator: { evaluate: jest.Mock } }
    ).evaluator;
    evaluator.evaluate.mockReturnValue({
      decision: "DENY",
      reasonCode: "ACTION_NOT_GRANTED",
      policyId: "policy-1",
      policyVersion: "v7",
    });

    const result = await service.evaluateWithPolicy({
      userId: "user-1",
      organizationId: "org-1",
      action: "classification:review:submit",
      correlationId: "correlation-2",
    });

    expect(result.policyId).toBeNull();
    expect(result.policyVersion).toBeNull();
  });
});
