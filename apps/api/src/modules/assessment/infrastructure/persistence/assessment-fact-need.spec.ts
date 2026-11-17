import { randomUUID } from "node:crypto";
import { describe, expect, it } from "@jest/globals";
import {
  FACT_NEED_ENVIRONMENTS,
  FACT_NEED_SUBJECT_KINDS,
  FACT_NEED_TIMEFRAME_KINDS,
  FACT_NEED_VALUE_KINDS,
  type FactNeedInput,
} from "@lcsp/contracts/assessment-domain";
import { computeFactNeedIdentityDigest } from "./assessment-fact-need.js";

function factNeed(
  deploymentKey = "prod.eu.1",
  timeframe: FactNeedInput["timeframe"] = {
    kind: FACT_NEED_TIMEFRAME_KINDS.current,
    from: null,
    to: null,
  },
): FactNeedInput {
  return {
    subject: {
      kind: FACT_NEED_SUBJECT_KINDS.deployment,
      key: "chatbot.production",
    },
    predicate: "operator.legal_entity",
    operationalScope: "customer_support",
    environment: {
      kind: FACT_NEED_ENVIRONMENTS.production,
      deploymentKey,
    },
    timeframe,
    valueSchema: {
      kind: FACT_NEED_VALUE_KINDS.text,
      schemaVersion: "legal_entity.v1",
      allowedValues: [],
    },
    sourceInvestigationAttempts: ["Inspected deployment ownership metadata."],
    acceptedEvidenceIds: [],
    investigatedRangeIds: [],
  };
}

describe("FactNeed canonical identity", () => {
  it("reuses identity across harmless casing and investigation wording", () => {
    const tenantOwnerId = randomUUID();
    const assessmentId = randomUUID();
    const first = factNeed();
    const equivalent = {
      ...factNeed("PROD.EU.1"),
      predicate: "OPERATOR.LEGAL_ENTITY",
      sourceInvestigationAttempts: ["Equivalent Vietnamese investigation."],
    };

    expect(
      computeFactNeedIdentityDigest({
        tenantOwnerId,
        assessmentId,
        factNeed: first,
      }),
    ).toBe(
      computeFactNeedIdentityDigest({
        tenantOwnerId,
        assessmentId,
        factNeed: equivalent,
      }),
    );
  });

  it("never merges different deployments, timeframes, assessments or tenants", () => {
    const tenantOwnerId = randomUUID();
    const assessmentId = randomUUID();
    const identity = (input: {
      tenantOwnerId?: string;
      assessmentId?: string;
      factNeed?: FactNeedInput;
    }) =>
      computeFactNeedIdentityDigest({
        tenantOwnerId: input.tenantOwnerId ?? tenantOwnerId,
        assessmentId: input.assessmentId ?? assessmentId,
        factNeed: input.factNeed ?? factNeed(),
      });
    const baseline = identity({});

    expect(identity({ factNeed: factNeed("prod.us.1") })).not.toBe(baseline);
    expect(
      identity({
        factNeed: factNeed("prod.eu.1", {
          kind: FACT_NEED_TIMEFRAME_KINDS.atTime,
          from: "2026-01-01T00:00:00.000Z",
          to: null,
        }),
      }),
    ).not.toBe(baseline);
    expect(identity({ assessmentId: randomUUID() })).not.toBe(baseline);
    expect(identity({ tenantOwnerId: randomUUID() })).not.toBe(baseline);
  });
});
