import {
  LEGAL_OPERATIVE_MODALITIES,
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  PREPARATION_SCOPE_REVIEW_REQUIRED_REASON_PREFIX,
  PREPARATION_SCOPE_STAGES,
} from "@lcsp/contracts/compliance-rule-set";
import {
  ASSESSMENT_RULE_IMPORT_EXCLUSION_REASONS,
  LEGAL_RULE_CATALOG_ERRORS,
  preparationRuleOutputSchema,
  selectedScopeDecisionSchema,
  type PreparationRuleInput,
  type PreparationRuleOutput,
  type SelectedScopeDecision,
} from "@lcsp/contracts/legal-rule-catalog";
import { HttpStatus } from "@nestjs/common";
import {
  LegalEffectStatus,
  LegalSourceDocumentCorpusRole,
  PreparationScopeReviewState,
  type Prisma,
} from "@prisma/client";
import { z } from "zod";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import {
  canonicalJson,
  sha256Hex,
} from "../../../assessment/domain/domain-ids.js";
import { LegalSourceAuthorityService } from "../../../legal-source/application/services/legal-source-authority.service.js";

const [development, nonDevelopment, unresolved] = PREPARATION_SCOPE_STAGES;
const covered = LEGAL_REQUIREMENT_COVERAGE_STATES.COVERED_BY_ASSESSMENT_RULES;

/**
 * Business purpose: Return a safe, non-repairable legal-scope denial.
 * Business rules: Unknown or invalid authorization is not a structural repair request.
 * Execution flow: 1. Emit the shared typed problem with only a bounded field path.
 * Failure cases: Always rejects the requested authoring or publication action.
 * Side effects: None.
 */
function reject(cid: string, path: string): never {
  throw problemException(LEGAL_RULE_CATALOG_ERRORS.SCOPE_REVIEW_REQUIRED, cid, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    meta: { path },
  });
}

/**
 * Business purpose: Pin legal meaning, exact source identity and compliance criteria for reusable selected-rule authority.
 * Business rules:
 * - Non-normative analysis and repository search hints do not change legal authority.
 * - A changed source, legal obligation, material context or compliance criterion changes the key.
 * - The legacy format identifies historical rows only; reuse still checks their exact reviewed criteria.
 * Execution flow: 1. Serialize legal scope and, for new approvals, material rule content in deterministic order. 2. Hash the serialization.
 * Failure cases: Serialization errors fail closed; no fallback identity is issued.
 * Side effects: Pure computation.
 */
export function selectedScopeKey(
  input: PreparationRuleInput,
  output: PreparationRuleOutput,
  format: 1 | 2 = 2,
): string {
  return sha256Hex(
    canonicalJson({
      contract: `SELECTED_SCOPE_V${format}`,
      legalSourceVersionId: input.legalSourceVersionId,
      catalogId: input.catalogVersionId,
      ruleId: input.ruleId,
      indexId: input.indexId,
      indexContentHash: input.indexContentHash,
      citations: input.citations
        .map(({ chunkId, documentId, locator, contentSha256 }) => ({
          chunkId,
          documentId,
          locator,
          contentSha256,
        }))
        .sort((a, b) => a.chunkId.localeCompare(b.chunkId)),
      legalRequirements: [...output.legalRequirements].sort((a, b) =>
        a.legalRequirementId.localeCompare(b.legalRequirementId),
      ),
      contextRelations: [...output.contextRelations].sort((a, b) =>
        a.relationId.localeCompare(b.relationId),
      ),
      ...(format === 2 && {
        // Keep criteria and verdict-relevant evidence; search tactics may change without changing the obligation.
        assessmentRules: output.assessmentRules
          .map((rule) => ({
            assessmentRuleId: rule.assessmentRuleId,
            legalRequirementIds: rule.legalRequirementIds,
            semanticAuthority: rule.semanticAuthority,
            evidenceBindings: rule.evidenceBindings,
            concept: rule.concept,
            legalIntent: rule.legalIntent,
            contextRelationIds: rule.contextRelationIds,
            unresolvedConditionBindings: rule.unresolvedConditionBindings,
            applicabilityGuidance: rule.applicabilityGuidance,
            criteria: rule.criteria.map(
              ({ criterionId, legalRequirementIds, statement }) => ({
                criterionId,
                legalRequirementIds,
                statement,
              }),
            ),
            requiredEvidence: rule.requiredEvidence,
            supportingEvidence: rule.supportingEvidence,
            negativeEvidence: rule.negativeEvidence,
            unresolvedConditions: rule.unresolvedConditions,
            sourceRefs: rule.sourceRefs,
          }))
          .sort((a, b) => a.assessmentRuleId.localeCompare(b.assessmentRuleId)),
      }),
    }),
  );
}

/**
 * Business purpose: Bind a reviewer decision to immutable legal propositions and exact source spans.
 * Business rules:
 * - Every requirement must be classified once; no unresolved or permission-as-mandatory rule may be approved.
 * - Development means an actual technical development responsibility; external-only obligations remain explicitly accounted for and cannot become assessment rules.
 * - Every requirement source reference must be supported by a verified nonblank text slice. A reason alone is never authority.
 * - This validates structural evidence and recorded review decisions, not semantic entailment by a keyword algorithm.
 * Execution flow: 1. Match all decisions to requirements. 2. Verify classification/coverage and exact source slices. 3. Reject unauthorized rule parents and return the decision digest.
 * Failure cases: Missing, duplicate, unresolved, foreign, substituted or malformed support rejects without authorizing a result.
 * Side effects: None; no model calls or persistence.
 */
export function validateSelectedScopeDecisions(
  input: PreparationRuleInput,
  output: PreparationRuleOutput,
  decisions: readonly SelectedScopeDecision[],
  cid: string,
  approving = true,
): string {
  const requirements = new Map(
    output.legalRequirements.map((r) => [r.legalRequirementId, r]),
  );
  const byChunk = new Map(input.citations.map((c) => [c.chunkId, c]));
  const seen = new Set<string>();
  const allowedParents = new Set<string>();
  if (!requirements.size || decisions.length !== requirements.size)
    reject(cid, "decisions");
  for (const decision of decisions) {
    const requirement = requirements.get(decision.legalRequirementId);
    if (
      !requirement ||
      requirement.operativePropositions?.length !== 1 ||
      seen.has(decision.legalRequirementId)
    )
      reject(cid, "decisions.legalRequirementId");
    seen.add(decision.legalRequirementId);
    if (decision.stage === unresolved && approving)
      reject(cid, "decisions.stage");
    if (decision.stage === development) {
      if (
        !decision.technicalDeliverable?.trim() ||
        requirement.coverage.nonAssessableReason?.startsWith(
          "OUT_OF_SCOPE_TARGET:",
        )
      )
        reject(cid, "decisions.technicalDeliverable");
      if (requirement.coverage.state === covered) {
        if (
          requirement.operativePropositions?.some(
            (p) => p.modality === LEGAL_OPERATIVE_MODALITIES.PERMISSION,
          )
        )
          reject(cid, "decisions.stage");
        allowedParents.add(requirement.legalRequirementId);
      }
    } else if (decision.stage === nonDevelopment) {
      const reason = requirement.coverage.nonAssessableReason?.trim() ?? "";
      if (
        requirement.coverage.state !==
          LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE ||
        !reason ||
        reason.startsWith(PREPARATION_SCOPE_REVIEW_REQUIRED_REASON_PREFIX)
      )
        reject(cid, "decisions.stage");
    }
    const refs = new Set(
      requirement.sourceRefs.map((r) =>
        canonicalJson([r.documentId, r.locator, r.contentSha256]),
      ),
    );
    const supported = new Set<string>();
    const spans = new Set<string>();
    for (const span of decision.sourceSupport) {
      const chunk = byChunk.get(span.chunkId);
      const identity =
        chunk &&
        canonicalJson([chunk.documentId, chunk.locator, chunk.contentSha256]);
      const slice = chunk?.content.slice(span.startOffset, span.endOffset);
      const spanKey = canonicalJson([
        span.chunkId,
        span.startOffset,
        span.endOffset,
      ]);
      if (
        !chunk ||
        !identity ||
        !refs.has(identity) ||
        sha256Hex(chunk.content) !==
          chunk.contentSha256.replace(/^sha256:/u, "") ||
        !Number.isInteger(span.startOffset) ||
        !Number.isInteger(span.endOffset) ||
        span.startOffset < 0 ||
        span.endOffset > chunk.content.length ||
        span.endOffset <= span.startOffset ||
        !slice?.trim() ||
        /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u.test(slice) ||
        sha256Hex(slice) !== span.contentSha256 ||
        spans.has(spanKey)
      )
        reject(cid, "decisions.sourceSupport");
      supported.add(identity);
      spans.add(spanKey);
    }
    if (supported.size !== refs.size) reject(cid, "decisions.sourceSupport");
  }
  if (
    approving &&
    (output.assessmentRules.some((rule) =>
      rule.legalRequirementIds.some((id) => !allowedParents.has(id)),
    ) ||
      [...allowedParents].some(
        (id) =>
          !output.assessmentRules.some((rule) =>
            rule.legalRequirementIds.includes(id),
          ),
      ))
  )
    reject(cid, "output.assessmentRules.legalRequirementIds");
  return sha256Hex(
    canonicalJson(
      [...decisions].sort((a, b) =>
        a.legalRequirementId.localeCompare(b.legalRequirementId),
      ),
    ),
  );
}

/**
 * Business purpose: Recheck the persisted, effective original source behind a selected semantic approval.
 * Business rules:
 * - All cited chunks must remain source/version/locator/hash matched; operative references must be effective.
 * - UNKNOWN or reference-only law cannot authorize a new operative assessment rule.
 * Execution flow: 1. Fetch pinned chunks. 2. Compare each exact citation and source effect; reject unknown sources.
 * Failure cases: Missing or changed legal evidence rejects before publication.
 * Side effects: Read-only database access.
 */
export async function requireSelectedScopeSource(
  tx: Prisma.TransactionClient,
  input: PreparationRuleInput,
  output: PreparationRuleOutput,
  cid: string,
  authority = new LegalSourceAuthorityService(),
): Promise<void> {
  await authority.requireVersion(tx, input.legalSourceVersionId, cid);
  const operativeRefs = new Set(
    output.legalRequirements
      .flatMap((r) => r.operativePropositions ?? [])
      .flatMap((p) => p.sourceRefs)
      .map((r) => canonicalJson([r.documentId, r.locator, r.contentSha256])),
  );
  const chunks = await tx.legalDocumentChunk.findMany({
    where: {
      legalSourceVersionId: input.legalSourceVersionId,
      id: { in: input.citations.map((c) => c.chunkId) },
    },
    select: {
      id: true,
      documentId: true,
      locator: true,
      contentSha256: true,
      content: true,
      legalEffectStatus: true,
      sourceDocument: { select: { corpusRole: true } },
    },
  });
  const byId = new Map(chunks.map((c) => [c.id, c]));
  for (const ref of input.citations) {
    const chunk = byId.get(ref.chunkId);
    const operative = operativeRefs.has(
      canonicalJson([ref.documentId, ref.locator, ref.contentSha256]),
    );
    if (
      !chunk ||
      (operative &&
        (chunk.legalEffectStatus !== LegalEffectStatus.EFFECTIVE ||
          chunk.sourceDocument.corpusRole !==
            LegalSourceDocumentCorpusRole.OPERATIVE)) ||
      chunk.documentId !== ref.documentId ||
      chunk.locator !== ref.locator ||
      chunk.contentSha256 !== ref.contentSha256 ||
      chunk.content !== ref.content ||
      sha256Hex(chunk.content) !== chunk.contentSha256.replace(/^sha256:/u, "")
    )
      reject(cid, "source.citations");
  }
}

/**
 * Business purpose: Authorize a positive selected result through an independent reusable semantic review.
 * Business rules:
 * - No new assessment rule may rely on client self-attestation or absence of a review-required marker.
 * - Only exact approved content and independent reviewer identity are accepted. An empty extraction cannot prove coverage.
 * Execution flow: 1. Resolve the exact source-bound key and approved record. 2. Revalidate persisted decision digest, payload and source. 3. Return the authority key.
 * Failure cases: Unreviewed, stale, tampered, or unresolved records produce the non-repairable scope-review error.
 * Side effects: Read-only; never dispatches Preparation or a model.
 */
export async function requireSelectedScopeAuthorization(
  tx: Prisma.TransactionClient,
  input: PreparationRuleInput,
  output: PreparationRuleOutput,
  cid: string,
  authority = new LegalSourceAuthorityService(),
): Promise<string> {
  // Every successful selected result must account for the obligations its source supports.
  if (!output.legalRequirements.length) reject(cid, "output.legalRequirements");
  const key = selectedScopeKey(input, output);
  const current = await tx.selectedRuleScopeAuthorization.findUnique({
    where: { scopeKey: key },
  });
  // V1 rows can authorize only the exact reviewed material rule projection.
  const row =
    current ??
    (await tx.selectedRuleScopeAuthorization.findUnique({
      where: { scopeKey: selectedScopeKey(input, output, 1) },
    }));
  if (
    !row ||
    row.state !== PreparationScopeReviewState.APPROVED ||
    row.legalSourceVersionId !== input.legalSourceVersionId ||
    row.catalogId !== input.catalogVersionId ||
    row.ruleId !== input.ruleId ||
    !row.approvedBy ||
    row.approvedBy === row.submittedBy ||
    !row.approvedAt
  )
    reject(cid, "output.scopeAuthorization");
  const reviewedOutput = preparationRuleOutputSchema.safeParse(row.output);
  const decisions = z
    .array(selectedScopeDecisionSchema)
    .safeParse(row.decisions);
  if (
    !reviewedOutput.success ||
    !decisions.success ||
    selectedScopeKey(input, reviewedOutput.data) !== key ||
    validateSelectedScopeDecisions(input, output, decisions.data, cid) !==
      row.decisionDigest
  )
    reject(cid, "output.scopeAuthorization");
  await requireSelectedScopeSource(tx, input, output, cid, authority);
  return row.scopeKey;
}

/**
 * Business purpose: Verify that an excluded import rule has an independent, approved NON_DEVELOPMENT semantic authorization.
 * Business rules:
 * - Reuses SelectedRuleScopeAuthorization rather than introducing a separate approval table.
 * - An exclusion is only valid when approved by a separate reviewer with zero assessment rules and every requirement classified NON_DEVELOPMENT.
 * - OUT_OF_SCOPE exclusions must carry the OUT_OF_SCOPE_TARGET: prefix on every requirement's nonAssessableReason.
 * Execution flow: 1. Query approved authorizations for the rule. 2. Validate key, digest, non-development decisions, and source support. 3. Reject if none match.
 * Failure cases: Unreviewed, revoked, self-approved, or mismatched exclusions fail with SCOPE_REVIEW_REQUIRED.
 * Side effects: Read-only database access.
 */
export async function requireSelectedExclusionAuthorization(
  tx: Prisma.TransactionClient,
  input: PreparationRuleInput,
  reasonCode: string,
  cid: string,
  authority = new LegalSourceAuthorityService(),
): Promise<string> {
  if (reasonCode === ASSESSMENT_RULE_IMPORT_EXCLUSION_REASONS.NEEDS_REVIEW) {
    reject(cid, "excludedItems.reasonCode");
  }
  const rows = await tx.selectedRuleScopeAuthorization.findMany({
    where: {
      legalSourceVersionId: input.legalSourceVersionId,
      catalogId: input.catalogVersionId,
      ruleId: input.ruleId,
      state: PreparationScopeReviewState.APPROVED,
    },
    orderBy: [{ updatedAt: "desc" }],
  });
  for (const row of rows) {
    if (
      !row.approvedBy ||
      row.approvedBy === row.submittedBy ||
      !row.approvedAt
    ) {
      continue;
    }
    const reviewedOutput = preparationRuleOutputSchema.safeParse(row.output);
    const decisions = z
      .array(selectedScopeDecisionSchema)
      .safeParse(row.decisions);
    if (!reviewedOutput.success || !decisions.success) {
      continue;
    }
    const output = reviewedOutput.data;
    if (output.assessmentRules.length > 0 || !output.legalRequirements.length) {
      continue;
    }
    if (
      selectedScopeKey(input, output) !== row.scopeKey &&
      selectedScopeKey(input, output, 1) !== row.scopeKey
    ) {
      continue;
    }
    if (decisions.data.some((decision) => decision.stage !== nonDevelopment)) {
      continue;
    }
    // Enforce semantic distinction between exclusion reason codes so a context-only
    // framing cannot masquerade as an out-of-scope obligation or vice versa.
    if (reasonCode === ASSESSMENT_RULE_IMPORT_EXCLUSION_REASONS.OUT_OF_SCOPE) {
      if (
        output.legalRequirements.some(
          (req) =>
            req.coverage.state !==
              LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE ||
            !(req.coverage.nonAssessableReason ?? "").startsWith(
              "OUT_OF_SCOPE_TARGET:",
            ),
        )
      ) {
        continue;
      }
    } else if (
      reasonCode === ASSESSMENT_RULE_IMPORT_EXCLUSION_REASONS.CONTEXT_ONLY
    ) {
      if (
        output.legalRequirements.some(
          (req) =>
            req.coverage.state !==
              LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE ||
            !(req.coverage.nonAssessableReason ?? "").startsWith(
              "CONTEXT_ONLY:",
            ),
        )
      ) {
        continue;
      }
    } else if (
      reasonCode === ASSESSMENT_RULE_IMPORT_EXCLUSION_REASONS.NON_ASSESSABLE
    ) {
      if (
        output.legalRequirements.some(
          (req) =>
            req.coverage.state !==
              LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE ||
            !(req.coverage.nonAssessableReason ?? "").trim() ||
            (req.coverage.nonAssessableReason ?? "").startsWith(
              "OUT_OF_SCOPE_TARGET:",
            ) ||
            (req.coverage.nonAssessableReason ?? "").startsWith(
              "CONTEXT_ONLY:",
            ),
        )
      ) {
        continue;
      }
    } else {
      continue;
    }
    if (
      validateSelectedScopeDecisions(input, output, decisions.data, cid) !==
      row.decisionDigest
    ) {
      continue;
    }
    await requireSelectedScopeSource(tx, input, output, cid, authority);
    return row.scopeKey;
  }
  reject(cid, "excludedItems.scopeAuthorization");
}
