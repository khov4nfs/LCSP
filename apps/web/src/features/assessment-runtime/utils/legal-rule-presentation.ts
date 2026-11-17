import { RULE_DECISION_COMPLIANCE_OUTCOMES } from "@lcsp/contracts/assessment";
import type {
  AssessmentDetail,
  AssessmentProvenanceArtifact,
  RuleAuditCatalog,
} from "@lcsp/contracts/assessment-domain";
import {
  legalDocumentDisplayName,
  type ActiveLegalLibrary,
} from "@lcsp/contracts/legal-source";
import type { DecisionTurn } from "../types/conversation.types";
import type {
  LegalRuleEvidenceItem,
  LegalRulePresentationModel,
} from "../types/legal-rule-output.types";
import { copy } from "./conversation-copy";

/**
 * Business purpose:
 * Extract human-readable document number from legal document identifier or text.
 *
 * Business rules:
 * - Recognizes law (luat-so-...) and decree (nghi-dinh-so-...) slug conventions.
 * - Parses standard statutory numbering formats (e.g., 147/2024/NĐ-CP, 86/2015/QH13, 05/2023/TT-BTTTT).
 * - Returns null when the format is unrecognized without fabricating legal identifiers.
 *
 * Execution flow:
 * 1. Match against standard statutory number format with slashes.
 * 2. If no slash match, check slug format conventions (luat-so, nghi-dinh-so, thong-tu-so).
 * 3. Format official number string when pattern matches, or return null.
 *
 * Failure cases:
 * - Non-matching or malformed input returns null.
 *
 * Side effects:
 * - Pure formatting function with no external state access.
 */
export function extractLegalDocumentNumber(documentIdOrTitle: string): string | null {
  if (!documentIdOrTitle) return null;

  // Match slash-separated statutory numbers: e.g. 147/2024/NĐ-CP, 86/2015/QH13, 05/2023/TT-BTTTT
  const slashMatch = documentIdOrTitle.match(
    /\b(\d+)\/(\d+)\/([A-ZĐa-zđ0-9-]+)\b/u,
  );
  if (slashMatch) {
    const org = slashMatch[3]
      .toUpperCase()
      .replace("ND-CP", "NĐ-CP");
    return `${slashMatch[1]}/${slashMatch[2]}/${org}`;
  }

  // Match law slug: luat-so-86-2015-qh13
  const law = documentIdOrTitle.match(/^luat-so-(\d+)-(\d+)-qh(\d+)\b/u);
  if (law) {
    return `${law[1]}/${law[2]}/QH${law[3]}`;
  }

  // Match decree slug: nghi-dinh-so-147-2024-nd-cp
  const decree = documentIdOrTitle.match(/^nghi-dinh-so-(\d+)-(\d+)-nd-cp\b/u);
  if (decree) {
    return `${decree[1]}/${decree[2]}/NĐ-CP`;
  }

  // Match circular slug: thong-tu-so-05-2023-tt-btttt
  const circular = documentIdOrTitle.match(/^thong-tu-so-(\d+)-(\d+)-([a-z0-9-]+)\b/u);
  if (circular) {
    return `${circular[1]}/${circular[2]}/${circular[3].toUpperCase()}`;
  }

  return null;
}

/**
 * Business purpose:
 * Transform raw decision record, rule catalog, legal library, and provenance into an Enterprise LegalTech presentation model.
 *
 * Business rules:
 * - Only applicable legal rules may produce active presentation outputs.
 * - Distinguishes verbatim legal source metadata from AI reasoning and evaluation findings.
 * - Links evidence directly to corresponding criteria and obligations with bidirectional navigation anchors.
 * - Never invents fake evidence or fabricates legal citations.
 *
 * Execution flow:
 * 1. Extract rule identity, catalog requirements, and linked legal documents.
 * 2. Resolve verbatim locator, document title, and effect status from pinned legal library.
 * 3. Structure applicability basis findings and explain why the rule applies to the repository.
 * 4. Aggregate criteria decisions and compliance rationales for the evaluated obligations.
 * 5. Map accepted evidence items with file paths, line ranges, and supported criteria roles.
 * 6. Generate the 5-step structured synthesis trace from law to code to conclusion.
 *
 * Failure cases:
 * - Missing catalog or provenance gracefully degrades to available decision record fields without throwing.
 *
 * Side effects:
 * - Pure mapping function; no persistence or query mutations.
 */
export function buildLegalRulePresentationModel(params: {
  turn: DecisionTurn;
  catalog?: RuleAuditCatalog | null;
  library?: ActiveLegalLibrary | null;
  provenance?: AssessmentProvenanceArtifact | null;
  detail?: AssessmentDetail | null;
}): LegalRulePresentationModel {
  const { turn, catalog, library, provenance } = params;
  const { decision } = turn.record;
  const outcome = decision.compliance ?? "UNDETERMINED";
  const isUnfavourable =
    decision.compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT;

  const ruleId =
    turn.assessmentRuleId ??
    turn.record?.assessmentRuleId ??
    turn.record?.decision?.assessmentRuleId ??
    "";

  const catalogRule = catalog?.rules?.find(
    (item) => item.assessmentRuleId === ruleId,
  );
  const primaryRequirement = catalogRule?.legalRequirements?.[0] ?? null;
  const primarySource = primaryRequirement?.sources?.[0] ?? null;
  const documentId = primarySource?.documentId ?? "";
  const locator =
    primarySource?.locator ??
    copy("decision.ruleFallback", { id: ruleId });

  const matchedDoc = library?.documents?.find(
    (doc) => doc.documentId === documentId,
  );
  const documentTitle = documentId
    ? legalDocumentDisplayName(documentId, matchedDoc?.title)
    : matchedDoc?.title ?? copy("decision.ruleFallback", { id: ruleId });
  const documentNumber =
    (documentId ? extractLegalDocumentNumber(documentId) : null) ??
    (matchedDoc?.title ? extractLegalDocumentNumber(matchedDoc.title) : null);

  const concept =
    catalogRule?.concept ??
    turn.concept ??
    copy("decision.ruleFallback", { id: ruleId });

  // Applicability information
  const basisFindings = (decision.applicabilityBasis ?? []).map((basis) => ({
    kind: basis.kind,
    finding: basis.finding,
    rationale: basis.rationale,
    referencesCount: basis.references.length,
  }));

  const applicabilityConditions: string[] = [];
  if (primaryRequirement) {
    applicabilityConditions.push(primaryRequirement.title);
  }

  const targetActivity =
    basisFindings.length > 0
      ? basisFindings.map((b) => b.rationale).join("; ")
      : catalogRule?.summary ??
        copy("decision.applicabilityExplanation");

  // Obligation information
  const criteria = decision.criteria.map((criterion) => ({
    criterionId: criterion.criterionId,
    outcome: criterion.outcome,
    rationale: criterion.rationale,
    referencesCount: criterion.references.length,
  }));

  // Evidence mapping
  const evidenceList: LegalRuleEvidenceItem[] = [];
  const criterionToEvidenceMap = new Map<string, string>();
  for (const crit of decision.criteria) {
    for (const ref of crit.references) {
      if (ref.type === "ASSESSMENT_EVIDENCE") {
        criterionToEvidenceMap.set(ref.evidenceId, crit.criterionId);
      }
    }
  }

  const acceptedEvidenceMap = new Map(
    (provenance?.acceptedEvidence ?? []).map((item) => [item.evidenceId, item]),
  );

  for (const ref of decision.references) {
    if (ref.type === "ASSESSMENT_EVIDENCE") {
      const accepted = acceptedEvidenceMap.get(ref.evidenceId);
      const supportedCriterionId =
        criterionToEvidenceMap.get(ref.evidenceId) ?? null;
      if (accepted) {
        const payload = accepted.payload as {
          path?: string;
          startLine?: number;
          endLine?: number;
          excerpt?: string;
          scopes?: Array<{ kind: string; path: string }>;
          queries?: Array<{ tool: string; query: string; resultCount: number }>;
        };
        evidenceList.push({
          evidenceId: accepted.evidenceId,
          type: accepted.type,
          path: payload.path ?? null,
          startLine: payload.startLine ?? null,
          endLine: payload.endLine ?? null,
          excerpt: payload.excerpt ?? null,
          role: supportedCriterionId
            ? copy("decision.evidenceRoleSupported", { criterion: supportedCriterionId })
            : copy("decision.evidenceRoleGeneral"),
          supportedCriterionId,
          queries: payload.queries ?? null,
          scopes: payload.scopes ? payload.scopes.map((s) => s.path) : null,
        });
      } else {
        evidenceList.push({
          evidenceId: ref.evidenceId,
          type: "ASSESSMENT_EVIDENCE",
          path: null,
          startLine: null,
          endLine: null,
          excerpt: null,
          role: supportedCriterionId
            ? copy("decision.evidenceRoleSupported", { criterion: supportedCriterionId })
            : copy("decision.evidenceRoleGeneral"),
          supportedCriterionId,
          queries: null,
          scopes: null,
        });
      }
    }
  }

  const hasEvidenceGap =
    evidenceList.length === 0 ||
    evidenceList.every((e) => e.path === null && (e.queries?.length ?? 0) === 0);

  // 5-step Structured Synthesis
  const step1Obligation =
    primaryRequirement?.title ??
    catalogRule?.summary ??
    copy("decision.legalObligationTitle");
  const step2Scope = targetActivity;
  const step3Evidence =
    evidenceList.length > 0
      ? evidenceList
          .map((e) =>
            e.path
              ? `${e.path}${e.startLine ? `:${e.startLine}-${e.endLine}` : ""}`
              : e.evidenceId,
          )
          .join(", ")
      : copy("decision.evidenceGapNotice");
  const step4Fulfillment = decision.rationale;
  const step5Conclusion = `${copy(`decision.outcomes.${outcome}`)} — ${decision.rationale}`;

  return {
    decisionId: turn.decisionId,
    identity: {
      concept,
      assessmentRuleId: turn.assessmentRuleId,
      documentTitle,
      documentNumber,
      documentRowId: matchedDoc?.id ?? null,
      locator,
      sourceUrl: matchedDoc?.sourceUrl ?? null,
      effectiveStatus: matchedDoc?.sourceEffectStatus ?? null,
      effectiveDate: matchedDoc?.effectiveDate ?? null,
      hasOriginal: matchedDoc?.hasOriginal ?? false,
      sourceVersion: catalog?.ruleSetVersionId ?? null,
    },
    applicability: {
      isApplicable: true,
      targetActivity,
      conditions: applicabilityConditions,
      basisFindings,
      nonEquivalenceNote: copy("decision.applicabilityNote"),
    },
    obligation: {
      legalRequirementId: primaryRequirement?.legalRequirementId ?? null,
      title: primaryRequirement?.title ?? concept,
      summary: catalogRule?.summary ?? decision.rationale,
      criteria,
    },
    compliance: {
      outcome,
      rationale: decision.rationale,
      isUnfavourable,
    },
    evidenceList,
    hasEvidenceGap,
    synthesis: {
      step1Obligation,
      step2Scope,
      step3Evidence,
      step4Fulfillment,
      step5Conclusion,
    },
  };
}
