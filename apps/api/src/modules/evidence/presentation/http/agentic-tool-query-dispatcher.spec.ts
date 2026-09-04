import { AGENTIC_TOOL_NAMES } from "@lcsp/contracts/evidence";

import { GetGapRequirementsQuery } from "../../../classification/application/queries/get-gap-requirements/get-gap-requirements.query.js";
import { GetAdminSourceCatalogQuery } from "../../../legal-rule-catalog/application/queries/get-admin-source-catalog/get-admin-source-catalog.query.js";
import { RetrieveVerifiedAgentEpisodesQuery } from "../../application/queries/retrieve-verified-agent-episodes/retrieve-verified-agent-episodes.query.js";
import * as queryEntrypoints from "./agentic-tool-query-dispatcher.js";
import { buildAgenticToolQuery } from "./agentic-tool-query-dispatcher.js";

const baseArgs = {
  assessmentId: "assessment-1",
  userId: "user-1",
  correlationId: "correlation-1",
  artifactVersions: {
    technicalEvidenceReportId: "ter-1",
  },
};

const CQRS_ENTRYPOINTS = [
  "get_artifact_chain",
  "get_reconciliation_context",
  "get_gap_requirements",
  "get_gap_evidence_trace",
  "evaluate_gap_matrix",
  "get_admin_source_catalog",
  "get_legal_corpus_readiness",
  "retrieve_legal_basis",
  "validate_citation_set",
  "retrieve_verified_episodes",
] as const;

const RETIRED_CQRS_ENTRYPOINTS = [
  "get_verified_profile",
  "get_classification_baseline",
  "validate_classification_proposal",
  "get_legal_rule_match",
  "get_assessment_context",
] as const;

const PYTHON_PROCESSING_TOOLS = [
  AGENTIC_TOOL_NAMES.getScanCoverage,
  AGENTIC_TOOL_NAMES.searchEvidence,
  AGENTIC_TOOL_NAMES.getFindingDetail,
  AGENTIC_TOOL_NAMES.findProviderInvocations,
  AGENTIC_TOOL_NAMES.getEvidenceSubgraph,
  AGENTIC_TOOL_NAMES.getSymbolContext,
  AGENTIC_TOOL_NAMES.traceStaticFlow,
  AGENTIC_TOOL_NAMES.inspectHumanReviewPath,
  AGENTIC_TOOL_NAMES.inspectDecisionPath,
  AGENTIC_TOOL_NAMES.inspectDataPath,
  AGENTIC_TOOL_NAMES.findSimilarSymbols,
  AGENTIC_TOOL_NAMES.inspectDeploymentContext,
  AGENTIC_TOOL_NAMES.proposeMissingTargets,
  AGENTIC_TOOL_NAMES.proposeGapRemediation,
] as const;

describe("buildAgenticToolQuery", () => {
  it("exposes exact-name entrypoints only for Nest CQRS tools", () => {
    for (const toolName of CQRS_ENTRYPOINTS) {
      const entrypoint = queryEntrypoints[toolName];
      expect(typeof entrypoint).toBe("function");
      expect((entrypoint as { name: string }).name).toBe(toolName);
    }
  });

  it.each(RETIRED_CQRS_ENTRYPOINTS)(
    "does not expose retired Nest CQRS tool %s",
    (toolName) => {
      expect(queryEntrypoints[toolName]).toBeUndefined();
      expect(() =>
        buildAgenticToolQuery({
          ...baseArgs,
          toolName,
          input: {},
        }),
      ).toThrow();
    },
  );

  it.each(PYTHON_PROCESSING_TOOLS)(
    "does not dispatch Python processing tool %s through Nest",
    (toolName) => {
      expect(() =>
        buildAgenticToolQuery({
          ...baseArgs,
          toolName,
          input: { maxResults: 10 },
        }),
      ).toThrow();
    },
  );

  it("routes get_gap_requirements through GetGapRequirementsQuery", () => {
    const input = {
      classificationRef: "classification:abcdefgh",
      policyProfileVersionId: "policy_abcdefgh",
    };
    expect(
      buildAgenticToolQuery({
        ...baseArgs,
        toolName: AGENTIC_TOOL_NAMES.getGapRequirements,
        input,
      }),
    ).toBeInstanceOf(GetGapRequirementsQuery);
  });

  it("routes get_admin_source_catalog through GetAdminSourceCatalogQuery", () => {
    expect(
      buildAgenticToolQuery({
        ...baseArgs,
        toolName: AGENTIC_TOOL_NAMES.getAdminSourceCatalog,
        input: { catalogId: "catalog_vbpl" },
      }),
    ).toBeInstanceOf(GetAdminSourceCatalogQuery);
  });

  it("routes retrieve_verified_episodes through RetrieveVerifiedAgentEpisodesQuery", () => {
    expect(
      buildAgenticToolQuery({
        ...baseArgs,
        toolName: AGENTIC_TOOL_NAMES.retrieveVerifiedEpisodes,
        input: { ownerAgent: "planner", engineeringRuleIds: ["ENG-1"] },
      }),
    ).toBeInstanceOf(RetrieveVerifiedAgentEpisodesQuery);
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
