import { describe, expect, it } from "@jest/globals";
import { UnprocessableEntityException } from "@nestjs/common";
import {
  ASSESSMENT_RESULT_MODES,
  ENGINEERING_LIMITATION_CODES,
  SCAN_ERROR_CODES,
} from "@lcsp/contracts/scan";

import { OverclaimGuardrailService } from "./overclaim-guardrail.service.js";

describe("OverclaimGuardrailService", () => {
  const service = new OverclaimGuardrailService();

  it("passes when no overclaim terms are present", () => {
    expect(() =>
      service.validate(
        {
          classification: "HIGH_RISK",
          risk_level: "level_3",
          notes: "Legal basis supported by Article 12",
        },
        "corr-test",
      ),
    ).not.toThrow();
  });

  it("throws CLASSIFICATION_OVERCLAIM when 'certified' is present", () => {
    expectOverclaim(service, {
      classification: "HIGH_RISK",
      notes: "This AI model is certified by authority",
    });
  });

  it("throws CLASSIFICATION_OVERCLAIM when 'production ready' is present", () => {
    expectOverclaim(service, { system_status: "production ready" });
  });

  it("throws CLASSIFICATION_OVERCLAIM when 'compliant' or 'non-compliant' is present", () => {
    expectOverclaim(service, { result: "non-compliant" });
  });

  it("does not treat direct EngineeringRule machine fields as narrative claims", () => {
    expect(() =>
      service.validate(
        {
          mode: ASSESSMENT_RESULT_MODES.engineeringRuleEvaluation,
          status: "COMPLETE",
          legal_rule_catalog_version_id: "approved-catalog-v1",
          legal_corpus_version_id: "validated-corpus-v1",
          run_id: "compliant-run-id",
          technical_evidence_report_id: "approved-report-id",
          snapshot_id: "production ready snapshot",
          evaluations: [
            {
              engineering_rule_id: "rule-approved-provider-use",
              legal_rule_id: "validated-legal-rule",
              concept: "COMPLIANT_SYSTEM_REFERENCE",
              status: "COMPLIANT",
              reason:
                "Repository evidence demonstrates that the engineering requirement is met.",
              evidence_refs: ["evidence:approved-source"],
              source_chunk_ids: ["validated-source-chunk"],
              source_locators: ["approved/legal/source"],
              confidence: 0.9,
              limitations: [ENGINEERING_LIMITATION_CODES.dynamicPathUnresolved],
            },
          ],
          claims: [
            {
              claim_id: "claim-non-compliant-identifier",
              engineering_rule_id: "approved-rule-id",
              claim_type: "RULE_REQUIREMENT_MET",
              value: true,
              evidence_refs: ["evidence:validated-provider"],
              graph_path_refs: [],
              source_anchor_refs: [],
              confidence: 0.9,
              limitations: [ENGINEERING_LIMITATION_CODES.graphCoverageLimited],
            },
          ],
          limitations: [ENGINEERING_LIMITATION_CODES.searchCoverageIncomplete],
        },
        "corr-test",
      ),
    ).not.toThrow();
  });

  it("still rejects overclaim language in direct EngineeringRule evaluation narratives", () => {
    expectOverclaim(service, {
      mode: ASSESSMENT_RESULT_MODES.engineeringRuleEvaluation,
      evaluations: [
        {
          status: "UNKNOWN",
          reason: "The repository is certified for this requirement.",
          limitations: [],
        },
      ],
      claims: [],
      limitations: [],
    });
  });

  it("still rejects overclaim language in direct top-level notes", () => {
    expectOverclaim(service, {
      mode: ASSESSMENT_RESULT_MODES.engineeringRuleEvaluation,
      notes: "The product is legally compliant.",
      evaluations: [],
      claims: [],
      limitations: [],
    });
  });
});

function expectOverclaim(
  service: OverclaimGuardrailService,
  payload: Record<string, unknown>,
): void {
  try {
    service.validate(payload, "corr-test");
    expect(true).toBe(false);
  } catch (err: unknown) {
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    const res = (err as UnprocessableEntityException).getResponse() as {
      problem: { code: string };
    };
    expect(res.problem.code).toBe(SCAN_ERROR_CODES.classificationOverclaim);
  }
}
