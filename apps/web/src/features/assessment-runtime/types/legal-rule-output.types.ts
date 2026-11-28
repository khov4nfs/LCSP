export type LegalRuleIdentity = {
  concept: string;
  assessmentRuleId: string;
  documentTitle: string;
  documentNumber: string | null;
  documentRowId: string | null;
  locator: string;
  sourceUrl: string | null;
  effectiveStatus: string | null;
  effectiveDate: string | null;
  hasOriginal: boolean;
  sourceVersion: string | null;
};

export type LegalRuleApplicabilityFinding = {
  kind: string;
  finding: string;
  rationale: string;
  referencesCount: number;
};

export type LegalRuleApplicability = {
  isApplicable: boolean;
  targetActivity: string;
  conditions: string[];
  basisFindings: LegalRuleApplicabilityFinding[];
  nonEquivalenceNote: string;
};

export type LegalRuleCriterion = {
  criterionId: string;
  outcome: string;
  rationale: string;
  referencesCount: number;
};

export type LegalRuleObligation = {
  legalRequirementId: string | null;
  title: string;
  summary: string;
  criteria: LegalRuleCriterion[];
};

export type LegalRuleCompliance = {
  outcome: string;
  rationale: string;
  isUnfavourable: boolean;
};

export type LegalRuleEvidenceItem = {
  evidenceId: string;
  type: string;
  /** Repository the evidence belongs to; null for evidence not bound to one repository. */
  repositoryKey: string | null;
  path: string | null;
  startLine: number | null;
  endLine: number | null;
  excerpt: string | null;
  role: string;
  supportedCriterionId: string | null;
  queries: Array<{ tool: string; query: string; resultCount: number }> | null;
  scopes: string[] | null;
};

export type LegalRuleSynthesis = {
  step1Obligation: string;
  step2Scope: string;
  step3Evidence: string;
  step4Fulfillment: string;
  step5Conclusion: string;
};

export type LegalRulePresentationModel = {
  decisionId: string;
  identity: LegalRuleIdentity;
  applicability: LegalRuleApplicability;
  obligation: LegalRuleObligation;
  compliance: LegalRuleCompliance;
  evidenceList: LegalRuleEvidenceItem[];
  hasEvidenceGap: boolean;
  synthesis: LegalRuleSynthesis;
};
