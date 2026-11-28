import {
  LEGAL_OPERATIVE_MODALITIES,
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  PREPARATION_SCOPE_REVIEW_REQUIRED_REASON_PREFIX,
  PREPARATION_SCOPE_STAGES,
} from "@lcsp/contracts/compliance-rule-set";
import {
  ASSESSMENT_RULE_IMPORT_EXCLUSION_REASONS,
  LEGAL_RULE_CATALOG_ERRORS,
  preparationRuleInputSchema,
  preparationRuleOutputSchema,
  SEMANTIC_VALIDATION_STATUSES,
  SEMANTIC_VALIDATION_VERDICTS,
  selectedScopeDecisionSchema,
  type PreparationRuleInput,
  type PreparationRuleOutput,
  type SelectedScopeDecision,
} from "@lcsp/contracts/legal-rule-catalog";
import { HttpStatus } from "@nestjs/common";
import {
  AgentExecutionState as PrismaAgentExecutionState,
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
import { preparationInputFingerprint } from "../../../legal-rule-catalog/application/services/legal-rule-catalog-shared.js";

const unresolved = PREPARATION_SCOPE_STAGES[2];
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
 * - Every requirement has one decision; unresolved candidates may be retained as drafts but never approved or published.
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
    // Unified eligibility: any system-relevant requirement with COVERED_BY_ASSESSMENT_RULES
    // (across development, deployment, or operation) may back Assessment Rules,
    // regardless of whether the legacy stage label is DEVELOPMENT or NON_DEVELOPMENT.
    if (requirement.coverage.state === covered) {
      if (
        requirement.operativePropositions?.some(
          (p) => p.modality === LEGAL_OPERATIVE_MODALITIES.PERMISSION,
        )
      )
        reject(cid, "decisions.stage");
      allowedParents.add(requirement.legalRequirementId);
    } else if (
      requirement.coverage.state ===
      LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE
    ) {
      const reason = requirement.coverage.nonAssessableReason?.trim() ?? "";
      // Preserve the explicit uncertainty in a review draft; approval still requires a
      // corrected source-backed requirement and cannot clear the marker implicitly.
      if (
        !reason ||
        (reason.startsWith(PREPARATION_SCOPE_REVIEW_REQUIRED_REASON_PREFIX) &&
          (approving || decision.stage !== unresolved))
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
  options: { requireReviewedAuthorization?: boolean } = {},
): Promise<string> {
  // Unified legal validation across all authoring paths:
  // 1. Every result must account for at least one sourced LegalRequirement.
  if (!output.legalRequirements.length) reject(cid, "output.legalRequirements");
  const key = selectedScopeKey(input, output);
  const current = await tx.selectedRuleScopeAuthorization.findUnique({
    where: { scopeKey: key },
  });
  const row =
    current ??
    (await tx.selectedRuleScopeAuthorization.findUnique({
      where: { scopeKey: selectedScopeKey(input, output, 1) },
    }));

  // 2. If a review record exists, enforce its state: REJECTED/DRAFT blocks publication;
  // APPROVED requires independent reviewer and matching digest.
  if (row) {
    if (
      row.state !== PreparationScopeReviewState.APPROVED ||
      row.legalSourceVersionId !== input.legalSourceVersionId ||
      row.catalogId !== input.catalogVersionId ||
      row.ruleId !== input.ruleId ||
      !row.approvedBy ||
      row.approvedBy === row.submittedBy ||
      !row.approvedAt
    ) {
      reject(cid, "output.scopeAuthorization");
    }
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
    ) {
      reject(cid, "output.scopeAuthorization");
    }
    await requireSelectedScopeSource(tx, input, output, cid, authority);
    return row.scopeKey;
  }

  // 3. Model-free JSON Import must never treat unreviewed external input as legally verified.
  if (options.requireReviewedAuthorization) {
    reject(cid, "output.scopeAuthorization");
  }

  // 4. When no exact-key review record exists, ensure this rule has not already been
  // reviewed or revoked under another material key (preventing hash-change bypass).
  if (tx.selectedRuleScopeAuthorization?.findFirst) {
    const priorForRule = await tx.selectedRuleScopeAuthorization.findFirst({
      where: {
        legalSourceVersionId: input.legalSourceVersionId,
        catalogId: input.catalogVersionId,
        ruleId: input.ruleId,
      },
      select: { scopeKey: true },
    });
    if (priorForRule) {
      reject(cid, "output.scopeAuthorization");
    }
  }

  // 5. For brand-new unreviewed rules from Deep Agent Preparation, allow publication
  // only when there is no LEGAL_REVIEW_REQUIRED marker, all source/structural provenance
  // checks pass, AND Deep Agent semanticValidation proves every rule-to-requirement pair is GROUNDED.
  // source citations, legal requirements, and assessment-rule criteria are grounded.
  const hasLegalUncertainty = output.legalRequirements.some((req) =>
    (req.coverage.nonAssessableReason ?? "").startsWith(
      PREPARATION_SCOPE_REVIEW_REQUIRED_REASON_PREFIX,
    ),
  );
  if (hasLegalUncertainty) {
    reject(cid, "output.legalRequirements");
  }
  const requirementById = new Map(
    output.legalRequirements.map((req) => [req.legalRequirementId, req]),
  );
  const coveredIds = new Set(
    output.legalRequirements
      .filter((req) => req.coverage.state === covered)
      .map((req) => req.legalRequirementId),
  );
  if (
    output.legalRequirements.some(
      (req) =>
        !req.sourceRefs.length ||
        !req.operativePropositions?.length ||
        req.operativePropositions.some(
          (op) =>
            !op.actor.trim() || !op.action.trim() || !op.sourceRefs.length,
        ),
    )
  ) {
    reject(cid, "output.legalRequirements");
  }
  for (const rule of output.assessmentRules) {
    if (
      !rule.legalRequirementIds.length ||
      rule.legalRequirementIds.some((id) => !coveredIds.has(id)) ||
      !rule.criteria.length ||
      rule.criteria.some(
        (c) =>
          !c.legalRequirementIds?.length ||
          c.legalRequirementIds.some((id) => !coveredIds.has(id)),
      ) ||
      !rule.sourceRefs.length
    ) {
      reject(cid, "output.assessmentRules.legalRequirementIds");
    }
    const parentSourceKeys = new Set(
      rule.legalRequirementIds.flatMap((id) =>
        (requirementById.get(id)?.sourceRefs ?? []).map((r) =>
          canonicalJson([r.documentId, r.locator, r.contentSha256]),
        ),
      ),
    );
    if (
      rule.sourceRefs.some(
        (r) =>
          !parentSourceKeys.has(
            canonicalJson([r.documentId, r.locator, r.contentSha256]),
          ),
      )
    ) {
      reject(cid, "output.assessmentRules.sourceRefs");
    }
  }
  // Why: Structural link checks alone cannot prove an Assessment Rule criterion
  // is semantically grounded in its cited Legal Requirement.
  // How: Require Deep Agent semanticValidation evidence (status=PASSED, every
  // (assessmentRuleId, legalRequirementId) pair verified GROUNDED with sourceRefs
  // matching the parent LegalRequirement).
  if (output.assessmentRules.length > 0) {
    const sv = output.semanticValidation;
    if (
      !sv ||
      sv.status !== SEMANTIC_VALIDATION_STATUSES.passed ||
      sv.verifier !== "DEEP_AGENT_SEMANTIC_VALIDATOR" ||
      sv.checks.some((c) => c.verdict !== SEMANTIC_VALIDATION_VERDICTS.grounded)
    ) {
      reject(cid, "output.semanticValidation");
    }
    const checkByPair = new Map(
      sv.checks.map((c) => [
        `${c.assessmentRuleId}::${c.legalRequirementId}`,
        c,
      ]),
    );
    for (const rule of output.assessmentRules) {
      for (const reqId of rule.legalRequirementIds) {
        const check = checkByPair.get(`${rule.assessmentRuleId}::${reqId}`);
        if (!check) {
          reject(cid, "output.semanticValidation");
        }
        const reqSourceKeys = new Set(
          (requirementById.get(reqId)?.sourceRefs ?? []).map((r) =>
            canonicalJson([r.documentId, r.locator, r.contentSha256]),
          ),
        );
        if (
          check.sourceRefs.some(
            (r) =>
              !reqSourceKeys.has(
                canonicalJson([r.documentId, r.locator, r.contentSha256]),
              ),
          )
        ) {
          reject(cid, "output.semanticValidation");
        }
      }
    }
  }
  await requireSelectedScopeSource(tx, input, output, cid, authority);
  return key;
}

const selectedManifestEntrySchema = z.object({
  ruleId: z.string().uuid(),
  resultId: z.string().uuid(),
  revision: z.number().int().positive(),
  inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  outputDigest: z.string().regex(/^[a-f0-9]{64}$/),
  scopeAuthorizationKey: z.string().regex(/^[a-f0-9]{64}$/),
});

/**
 * Business purpose: Verify the immutable Selected Rule Set activation manifest and ensure none of its authorizations were revoked.
 *
 * Business rules:
 * - Manifest must be a non-empty array of complete, unique rule/result/digest entries bound to persisted input, output and material authority.
 * - Any REJECTED or DRAFT authorization for a manifest key blocks admission or reactivation.
 *
 * Execution flow:
 * 1. Parse the manifest array and verify uniqueness of ruleId and scopeAuthorizationKey.
 * 2. Recompute the persisted input fingerprint, output digest and material key; verify legacy keys against their exact approved output.
 * 3. Check SelectedRuleScopeAuthorization for any REJECTED or DRAFT rows matching the manifest keys.
 *
 * Failure cases:
 * - Malformed, empty, duplicate, or revoked/draft manifests return false (fail closed).
 *
 * Side effects:
 * - Read-only database query.
 */
export async function hasValidSelectedActivationManifest(
  tx: Prisma.TransactionClient,
  selectedPreparationResults: unknown,
  context?: {
    legalSourceVersionId?: string;
    expectedRuleSetDigest?: string;
    actualRuleSetDigest?: string;
  },
): Promise<boolean> {
  const parsed = z
    .array(selectedManifestEntrySchema)
    .min(1)
    .safeParse(selectedPreparationResults);
  if (!parsed.success) return false;
  const keys = parsed.data.map((entry) => entry.scopeAuthorizationKey);
  const ruleIds = parsed.data.map((entry) => entry.ruleId);
  const resultIds = parsed.data.map((entry) => entry.resultId);
  if (
    new Set(keys).size !== keys.length ||
    new Set(ruleIds).size !== ruleIds.length ||
    new Set(resultIds).size !== resultIds.length
  ) {
    return false;
  }
  if (
    context?.expectedRuleSetDigest &&
    context?.actualRuleSetDigest &&
    context.expectedRuleSetDigest !== context.actualRuleSetDigest
  ) {
    return false;
  }
  // Why: Manifest shape alone cannot prove the manifest corresponds to persisted,
  // succeeded PreparationRuleResult rows or their immutable output digests.
  // How: When preparationRuleResult is available on tx, verify every entry's resultId,
  // revision, ruleId, executionState, legalSourceVersionId, inputFingerprint, and outputDigest.
  if (!tx.preparationRuleResult?.findMany) return false;
  {
    const rows = await tx.preparationRuleResult.findMany({
      where: { id: { in: resultIds } },
      select: {
        id: true,
        revision: true,
        inputFingerprint: true,
        inputSnapshot: true,
        output: true,
        preparationRule: { select: { legalRuleId: true } },
        preparationRun: {
          select: {
            executionState: true,
            legalSourceVersionId: true,
          },
        },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const entry of parsed.data) {
      const row = byId.get(entry.resultId);
      if (
        !row ||
        row.revision !== entry.revision ||
        row.preparationRule.legalRuleId !== entry.ruleId ||
        row.preparationRun.executionState !==
          PrismaAgentExecutionState.SUCCEEDED ||
        row.inputFingerprint !== entry.inputFingerprint ||
        !row.output ||
        (context?.legalSourceVersionId &&
          row.preparationRun.legalSourceVersionId !==
            context.legalSourceVersionId)
      ) {
        return false;
      }
      const parsedInput = preparationRuleInputSchema.safeParse(row.inputSnapshot);
      const parsedOutput = preparationRuleOutputSchema.safeParse(row.output);
      if (
        !parsedInput.success ||
        parsedInput.data.ruleId !== entry.ruleId ||
        parsedInput.data.legalSourceVersionId !== row.preparationRun.legalSourceVersionId ||
        preparationInputFingerprint(parsedInput.data) !== entry.inputFingerprint ||
        !parsedOutput.success ||
        sha256Hex(canonicalJson(parsedOutput.data)) !== entry.outputDigest
      ) {
        return false;
      }
      // A syntactically valid but substituted authorization key must not hide a
      // revoked approval. V1 keys are accepted only with the original exact review.
      const materialKey = selectedScopeKey(parsedInput.data, parsedOutput.data);
      if (entry.scopeAuthorizationKey !== materialKey) {
        if (
          entry.scopeAuthorizationKey !== selectedScopeKey(parsedInput.data, parsedOutput.data, 1) ||
          !tx.selectedRuleScopeAuthorization?.findUnique
        ) return false;
        const review = await tx.selectedRuleScopeAuthorization.findUnique({
          where: { scopeKey: entry.scopeAuthorizationKey },
        });
        const reviewed = preparationRuleOutputSchema.safeParse(review?.output);
        if (
          !review ||
          review.state !== PreparationScopeReviewState.APPROVED ||
          review.ruleId !== entry.ruleId ||
          review.catalogId !== parsedInput.data.catalogVersionId ||
          review.legalSourceVersionId !== parsedInput.data.legalSourceVersionId ||
          !review.approvedBy || review.approvedBy === review.submittedBy ||
          !review.approvedAt || !reviewed.success ||
          selectedScopeKey(parsedInput.data, reviewed.data) !== materialKey
        ) return false;
      }
    }
  }
  if (!tx.selectedRuleScopeAuthorization?.count) return false;
  {
    const blocked = await tx.selectedRuleScopeAuthorization.count({
      where: {
        scopeKey: { in: keys },
        state: {
          in: [
            PreparationScopeReviewState.REJECTED,
            PreparationScopeReviewState.DRAFT,
          ],
        },
      },
    });
    if (blocked > 0) return false;
  }
  return true;
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
    if (decisions.data.some((decision) => decision.stage === unresolved)) {
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
