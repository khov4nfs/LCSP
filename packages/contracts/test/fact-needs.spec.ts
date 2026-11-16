import { describe, expect, it } from "@jest/globals";
import {
  FACT_NEED_ENVIRONMENTS,
  FACT_NEED_SUBJECT_KINDS,
  FACT_NEED_TIMEFRAME_KINDS,
  FACT_NEED_VALUE_KINDS,
  factNeedInputSchema,
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
});
