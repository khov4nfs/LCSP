import { describe, expect, it } from "@jest/globals";
import {
  FACT_NEED_ENVIRONMENTS,
  FACT_NEED_SUBJECT_KINDS,
  FACT_NEED_TIMEFRAME_KINDS,
  FACT_NEED_VALUE_KINDS,
  HUMAN_FACT_GUARD_FAILURES,
  HUMAN_FACT_PROPOSAL_STATUSES,
  factNeedInputSchema,
  humanAnswerAuditSchema,
  normalizedFactNeedAnswerSchema,
} from "../src/assessment-domain/index.js";

const rangeId = `sha256:${"a".repeat(64)}`;

function validFactNeed() {
  return {
    subject: {
      kind: FACT_NEED_SUBJECT_KINDS.deployment,
      key: "chatbot.production",
    },
    predicate: "operator.legal_entity",
    operationalScope: "customer_support",
    environment: {
      kind: FACT_NEED_ENVIRONMENTS.production,
      deploymentKey: "prod.eu.1",
    },
    timeframe: {
      kind: FACT_NEED_TIMEFRAME_KINDS.current,
      from: null,
      to: null,
    },
    valueSchema: {
      kind: FACT_NEED_VALUE_KINDS.text,
      schemaVersion: "legal_entity.v1",
      allowedValues: [],
    },
    sourceInvestigationAttempts: [
      "Inspected deployment configuration and ownership metadata.",
    ],
    acceptedEvidenceIds: [],
    investigatedRangeIds: [rangeId],
  };
}

describe("FactNeed contracts", () => {
  it("accepts a fully scoped current text need", () => {
    expect(factNeedInputSchema.parse(validFactNeed())).toEqual(validFactNeed());
  });

  it("requires canonical values for an enum need", () => {
    expect(() =>
      factNeedInputSchema.parse({
        ...validFactNeed(),
        valueSchema: {
          kind: FACT_NEED_VALUE_KINDS.enumeration,
          schemaVersion: "deployment_status.v1",
          allowedValues: [],
        },
      }),
    ).toThrow();
  });

  it("rejects reversed timeframe ranges", () => {
    expect(() =>
      factNeedInputSchema.parse({
        ...validFactNeed(),
        timeframe: {
          kind: FACT_NEED_TIMEFRAME_KINDS.range,
          from: "2026-12-01T00:00:00.000Z",
          to: "2026-01-01T00:00:00.000Z",
        },
      }),
    ).toThrow();
  });

  it("preserves deployment and timeframe as explicit identity coordinates", () => {
    const euCurrent = factNeedInputSchema.parse(validFactNeed());
    const usCurrent = factNeedInputSchema.parse({
      ...validFactNeed(),
      environment: {
        ...validFactNeed().environment,
        deploymentKey: "prod.us.1",
      },
    });
    const euHistorical = factNeedInputSchema.parse({
      ...validFactNeed(),
      timeframe: {
        kind: FACT_NEED_TIMEFRAME_KINDS.atTime,
        from: "2026-01-01T00:00:00.000Z",
        to: null,
      },
    });

    expect(usCurrent.environment.deploymentKey).not.toBe(
      euCurrent.environment.deploymentKey,
    );
    expect(euHistorical.timeframe).not.toEqual(euCurrent.timeframe);
  });

  it("keeps historical answer audits valid while accepting typed normalization", () => {
    const historical = {
      idempotencyKey: "answer-idempotency",
      requestDigest: "b".repeat(64),
      actorId: "customer-owner",
      answeredAt: "2026-11-16T10:00:00.000Z",
      caseRevision: 2,
      requestRevision: 1,
      doesNotKnow: false,
      answer: "TRUE",
      selectedChoice: null,
    };

    expect(humanAnswerAuditSchema.parse(historical)).toEqual(historical);
    expect(
      normalizedFactNeedAnswerSchema.parse({
        kind: FACT_NEED_VALUE_KINDS.boolean,
        value: true,
      }),
    ).toEqual({ kind: FACT_NEED_VALUE_KINDS.boolean, value: true });
  });

  it("represents pending and accepted proposals without changing historical answer shape", () => {
    const proposalId = "11111111-1111-4111-8111-111111111111";
    const base = {
      idempotencyKey: "answer-proposal-idempotency",
      requestDigest: "c".repeat(64),
      actorId: "customer-owner",
      answeredAt: "2026-11-16T11:00:00.000Z",
      caseRevision: 2,
      requestRevision: 2,
      doesNotKnow: false,
      answer: "The incident status remains unknown.",
      selectedChoice: null,
      proposalId,
    };

    expect(
      humanAnswerAuditSchema.parse({
        ...base,
        proposalStatus: HUMAN_FACT_PROPOSAL_STATUSES.pendingReview,
        guardFailure: HUMAN_FACT_GUARD_FAILURES.AMBIGUOUS_HUMAN_ANSWER,
      }),
    ).toMatchObject({
      proposalId,
      proposalStatus: HUMAN_FACT_PROPOSAL_STATUSES.pendingReview,
      guardFailure: HUMAN_FACT_GUARD_FAILURES.AMBIGUOUS_HUMAN_ANSWER,
    });
    expect(
      humanAnswerAuditSchema.parse({
        ...base,
        proposalStatus: HUMAN_FACT_PROPOSAL_STATUSES.accepted,
        guardFailure: null,
      }),
    ).toMatchObject({
      proposalStatus: HUMAN_FACT_PROPOSAL_STATUSES.accepted,
      guardFailure: null,
    });
    expect(() =>
      humanAnswerAuditSchema.parse({
        ...base,
        proposalStatus: HUMAN_FACT_PROPOSAL_STATUSES.accepted,
        guardFailure: HUMAN_FACT_GUARD_FAILURES.CONTRADICTS_PRIOR_HUMAN_FACT,
      }),
    ).toThrow();
  });
});
