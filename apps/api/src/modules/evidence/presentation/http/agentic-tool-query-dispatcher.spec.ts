import { AGENTIC_TOOL_NAMES } from "@lcsp/contracts/evidence";

import { GetGapRequirementsQuery } from "../../../classification/application/queries/get-gap-requirements/get-gap-requirements.query.js";
import { GetAdminSourceCatalogQuery } from "../../../legal-rule-catalog/application/queries/get-admin-source-catalog/get-admin-source-catalog.query.js";
import { CompareWizardClaimQuery } from "../../../reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.query.js";
import { SearchEvidenceQuery } from "../../application/queries/search-evidence/search-evidence.query.js";
import * as queryEntrypoints from "./agentic-tool-query-dispatcher.js";
import { buildAgenticToolQuery } from "./agentic-tool-query-dispatcher.js";

const baseArgs = {
  assessmentId: "assessment-1",
  organizationId: "org-1",
  userId: "user-1",
  correlationId: "correlation-1",
  artifactVersions: {
    wizardProfileId: "wizard-1",
    technicalEvidenceReportId: "ter-1",
  },
};

const EXACT_QUERY_ENTRYPOINTS = [
  "get_scan_coverage",
  "search_evidence",
  "get_finding_detail",
  "find_provider_invocations",
  "get_evidence_subgraph",
  "get_symbol_context",
  "trace_static_flow",
  "inspect_human_review_path",
  "inspect_decision_path",
  "inspect_data_path",
  "find_similar_symbols",
  "inspect_deployment_context",
  "get_assessment_context",
  "get_artifact_chain",
  "get_reconciliation_context",
  "propose_missing_targets",
  "get_verified_profile",
  "compare_wizard_claim",
  "get_classification_baseline",
  "get_gap_requirements",
  "get_gap_evidence_trace",
  "propose_gap_remediation",
  "validate_classification_proposal",
  "evaluate_gap_matrix",
  "get_admin_source_catalog",
  "get_legal_corpus_readiness",
  "retrieve_legal_basis",
  "get_legal_rule_match",
  "validate_citation_set",
] as const;

describe("buildAgenticToolQuery", () => {
  it("exposes a real function whose name exactly matches every canonical query tool", () => {
    for (const toolName of EXACT_QUERY_ENTRYPOINTS) {
      const entrypoint = queryEntrypoints[toolName];
      expect(typeof entrypoint).toBe("function");
      expect((entrypoint as { name: string }).name).toBe(toolName);
    }
  });

  it("keeps search_evidence mapped to SearchEvidenceQuery", () => {
    const query = buildAgenticToolQuery({
      ...baseArgs,
      toolName: AGENTIC_TOOL_NAMES.searchEvidence,
      input: { maxResults: 10 },
    });

    expect(query).toBeInstanceOf(SearchEvidenceQuery);
  });

  it("routes compare_wizard_claim through the central query table", () => {
    const query = buildAgenticToolQuery({
      ...baseArgs,
      toolName: AGENTIC_TOOL_NAMES.compareWizardClaim,
      input: {
        targetId: "target:abcdefgh",
        claimField: "PROVIDER",
        expectedValue: "OPENAI",
        comparisonScope: "TARGET",
        maxEvidenceRefs: 10,
      },
    });

    expect(query).toBeInstanceOf(CompareWizardClaimQuery);
    expect(query).toMatchObject({
      assessmentId: "assessment-1",
      organizationId: "org-1",
      wizardProfileId: "wizard-1",
      evidenceReportId: "ter-1",
      targetId: "target:abcdefgh",
      claimField: "PROVIDER",
      expectedValue: "OPENAI",
      comparisonScope: "TARGET",
      maxEvidenceRefs: 10,
    });
  });

  it("routes get_gap_requirements through GetGapRequirementsQuery", () => {
    const input = {
      classificationRef: "classification:abcdefgh",
      policyProfileVersionId: "policy_abcdefgh",
    };
    const query = buildAgenticToolQuery({
      ...baseArgs,
      toolName: AGENTIC_TOOL_NAMES.getGapRequirements,
      input,
    });

    expect(query).toBeInstanceOf(GetGapRequirementsQuery);
    expect(query).toMatchObject({
      assessmentId: "assessment-1",
      organizationId: "org-1",
      input,
      actorId: "user-1",
    });
  });

  it("routes get_admin_source_catalog through GetAdminSourceCatalogQuery", () => {
    const input = { catalogId: "catalog_vbpl" };
    const query = buildAgenticToolQuery({
      ...baseArgs,
      toolName: AGENTIC_TOOL_NAMES.getAdminSourceCatalog,
      input,
    });

    expect(query).toBeInstanceOf(GetAdminSourceCatalogQuery);
    expect(query).toMatchObject({
      assessmentId: "assessment-1",
      organizationId: "org-1",
      input,
      actorId: "user-1",
    });
  });

  it("fails closed for an unregistered tool name", () => {
    expect(() =>
      buildAgenticToolQuery({
        ...baseArgs,
        toolName: "unknown_tool",
        input: {},
      }),
    ).toThrow();
  });
});
