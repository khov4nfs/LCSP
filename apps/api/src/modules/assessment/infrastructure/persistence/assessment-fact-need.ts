import { createHash, randomUUID } from "node:crypto";

import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  FACT_NEED_VALUE_KINDS,
  HUMAN_RESOLUTION_CONTROL_TYPES,
  computeRepositoryDiscoveryDigest,
  factNeedDiscoveryRefSchema,
  factNeedViewSchema,
  repositoryDiscoverySchema,
  type FactNeedDiscoveryRef,
  type FactNeedInput,
  type FactNeedView,
} from "@lcsp/contracts/assessment-domain";
import { HttpStatus } from "@nestjs/common";
import {
  AssessmentFactNeedStatus,
  AssessmentRecordState,
  type Prisma,
} from "@prisma/client";

import { problemException } from "../../../../platform/http/filters/error.factory.js";

type FactNeedRow = {
  factNeedId: string;
  identityDigest: string;
  subjectKind: string;
  subjectKey: string;
  predicate: string;
  operationalScope: string;
  environment: string;
  deploymentKey: string | null;
  timeframeKind: string;
  timeframeFrom: Date | null;
  timeframeTo: Date | null;
  valueKind: string;
  valueSchemaVersion: string;
  allowedValues: unknown;
  sourceInvestigationAttempts: unknown;
  acceptedEvidenceIds: unknown;
  investigationDiscoveryRefs?: unknown;
  investigatedRangeIds: unknown;
  status: string;
  resolvedFactId: string | null;
};

/**
 * Business purpose: Canonicalize a semantic identity coordinate independently of presentation language and harmless casing.
 *
 * Business rules:
 * - Unicode compatibility-equivalent text, surrounding whitespace and casing must not create separate FactNeeds.
 * - Callers provide identifier-like contract values, so normalization must not translate or infer business meaning.
 *
 * Execution flow:
 * 1. Apply Unicode compatibility normalization.
 * 2. Trim surrounding whitespace and convert to uppercase.
 *
 * Failure cases:
 * - Malformed or blank values are rejected by the FactNeed contract before this helper is called.
 *
 * Side effects:
 * - Pure string normalization without persistence or factual authority.
 */
function normalizeFactNeedSemanticKey(value: string): string {
  return value.normalize("NFKC").trim().toUpperCase();
}

/**
 * Business purpose: Produce one stable representation of a FactNeed's allowed canonical values for identity and control comparison.
 *
 * Business rules:
 * - Equivalent value casing and order must compare equal.
 * - Duplicate values cannot affect identity.
 *
 * Execution flow:
 * 1. Normalize every semantic value.
 * 2. Deduplicate and sort the values deterministically.
 *
 * Failure cases:
 * - Invalid semantic values are rejected by the FactNeed contract before this helper is called.
 *
 * Side effects:
 * - Pure collection normalization without database changes.
 */
function canonicalFactNeedValues(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeFactNeedSemanticKey))].sort(
    (left, right) => left.localeCompare(right),
  );
}

/**
 * Business purpose: Read persisted provenance arrays without interpreting malformed non-string entries as valid investigation history.
 *
 * Business rules:
 * - Only string entries are eligible for bounded provenance merging.
 * - A non-array persisted value contributes no entries and is later exposed as invalid by strict read projection.
 *
 * Execution flow:
 * 1. Check whether the persisted JSON value is an array.
 * 2. Retain string entries only.
 *
 * Failure cases:
 * - This helper does not repair invalid persisted JSON; strict API projection still fails closed.
 *
 * Side effects:
 * - Pure JSON filtering without persistence.
 */
function persistedStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Business purpose: Canonicalize immutable discovery references used to justify one source investigation.
 *
 * Business rules:
 * - Exact record/digest pairs are deduplicated and deterministically sorted.
 * - Invalid persisted or caller values fail closed and never become trusted provenance.
 *
 * Execution flow:
 * 1. Parse every candidate through the strict discovery-reference contract.
 * 2. Deduplicate exact pairs and sort by record identity and digest.
 * 3. Return the bounded canonical references.
 *
 * Failure cases:
 * - Malformed non-null entries throw before projection or persistence can continue.
 *
 * Side effects:
 * - Pure in-memory parsing without persistence or assessment authority.
 */
function canonicalDiscoveryRefs(value: unknown): FactNeedDiscoveryRef[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error("invalid persisted FactNeed discovery references");
  }
  const refs = new Map<string, FactNeedDiscoveryRef>();
  for (const candidate of value) {
    const parsed = factNeedDiscoveryRefSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error("invalid persisted FactNeed discovery reference");
    }
    refs.set(
      `${parsed.data.recordId}:${parsed.data.contentDigest}`,
      parsed.data,
    );
  }
  return [...refs.values()].sort(
    (left, right) =>
      left.recordId.localeCompare(right.recordId) ||
      left.contentDigest.localeCompare(right.contentDigest),
  );
}

/**
 * Business purpose: Prove that source ranges claimed in a FactNeed came from immutable Discovery records at the assessment's current repository pins.
 *
 * Business rules:
 * - Every investigated range requires at least one exact assessment-owned discovery record/digest reference.
 * - Discovery records must match the pinned snapshot, commit and source scope, retain valid payload integrity, and contain every claimed range ID.
 * - Discovery findings remain investigation provenance only; validation never accepts a source fact or legal conclusion.
 *
 * Execution flow:
 * 1. Canonicalize supplied references and reject unbound range identifiers.
 * 2. Load only exact referenced records under current assessment repository pins.
 * 3. Revalidate each immutable payload digest and collect its source-range identities.
 * 4. Reject missing/foreign ranges and return canonical references for persistence.
 *
 * Failure cases:
 * - Missing records, stale pins, malformed payloads, digest mismatch or absent ranges fail atomically with PROVENANCE_INTEGRITY_MISMATCH.
 *
 * Side effects:
 * - Read-only discovery queries; creates no FactNeed, evidence, fact, decision or audit scope.
 */
export async function validateFactNeedDiscoveryProvenanceInTx(
  tx: Prisma.TransactionClient,
  input: {
    assessmentId: string;
    repositorySnapshotId: string;
    repositoryCommit: string;
    sourcePathPrefix: string | null;
    investigationDiscoveryRefs?: readonly FactNeedDiscoveryRef[];
    investigatedRangeIds: readonly string[];
    correlationId: string;
  },
): Promise<FactNeedDiscoveryRef[]> {
  const refs = canonicalDiscoveryRefs(input.investigationDiscoveryRefs ?? []);
  const fail = () =>
    problemException(
      ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
      input.correlationId,
      { status: HttpStatus.UNPROCESSABLE_ENTITY },
    );
  if (input.investigatedRangeIds.length > 0 && refs.length === 0) {
    throw fail();
  }
  if (refs.length === 0) return [];

  const rows = await tx.assessmentRepositoryDiscovery.findMany({
    where: {
      assessmentId: input.assessmentId,
      repositorySnapshotId: input.repositorySnapshotId,
      repositoryCommit: input.repositoryCommit.toLowerCase(),
      sourcePathPrefix: input.sourcePathPrefix,
      OR: refs.map((ref) => ({
        recordId: ref.recordId,
        contentDigest: ref.contentDigest,
      })),
    },
    select: { recordId: true, contentDigest: true, payload: true },
  });
  if (rows.length !== refs.length) throw fail();

  const expectedRefs = new Set(
    refs.map((ref) => `${ref.recordId}:${ref.contentDigest}`),
  );
  const rangeIds = new Set<string>();
  for (const row of rows) {
    if (!expectedRefs.has(`${row.recordId}:${row.contentDigest}`)) throw fail();
    const parsed = repositoryDiscoverySchema.safeParse(row.payload);
    if (
      !parsed.success ||
      parsed.data.contentDigest !== row.contentDigest ||
      parsed.data.discoveryId !== row.contentDigest ||
      parsed.data.commitSha !== input.repositoryCommit.toLowerCase() ||
      parsed.data.sourcePathPrefix !== input.sourcePathPrefix ||
      computeRepositoryDiscoveryDigest(parsed.data) !== row.contentDigest
    ) {
      throw fail();
    }
    for (const range of parsed.data.sourceRanges) rangeIds.add(range.rangeId);
  }
  if (input.investigatedRangeIds.some((rangeId) => !rangeIds.has(rangeId))) {
    throw fail();
  }
  return refs;
}

/**
 * Business purpose: Normalize one semantic FactNeed identity so wording, locale and harmless casing cannot create duplicate customer questions.
 *
 * Business rules:
 * - Tenant owner and assessment identity are mandatory identity boundaries.
 * - Subject, predicate, operational scope, environment, deployment, timeframe and value schema all participate.
 * - Presentation text, rule dependencies, investigation notes and supporting evidence do not change factual identity.
 * - Allowed enum values are case-normalized, deduplicated and sorted for stable comparison.
 *
 * Execution flow:
 * 1. Normalize canonical semantic keys and explicit temporal bounds.
 * 2. Sort canonical enum values while preserving every material scope coordinate.
 * 3. Return a stable JSON-compatible identity object.
 *
 * Failure cases:
 * - Contract validation rejects malformed keys or timeframe/value shapes before this function is called.
 *
 * Side effects:
 * - Pure normalization without persistence, fact acceptance or audit authorization.
 */
function canonicalFactNeedIdentity(input: {
  tenantOwnerId: string;
  assessmentId: string;
  factNeed: FactNeedInput;
}) {
  return {
    tenantOwnerId: input.tenantOwnerId,
    assessmentId: input.assessmentId,
    subject: {
      kind: input.factNeed.subject.kind,
      key: normalizeFactNeedSemanticKey(input.factNeed.subject.key),
    },
    predicate: normalizeFactNeedSemanticKey(input.factNeed.predicate),
    operationalScope: normalizeFactNeedSemanticKey(
      input.factNeed.operationalScope,
    ),
    environment: {
      kind: input.factNeed.environment.kind,
      deploymentKey: input.factNeed.environment.deploymentKey
        ? normalizeFactNeedSemanticKey(input.factNeed.environment.deploymentKey)
        : null,
    },
    timeframe: {
      kind: input.factNeed.timeframe.kind,
      from: input.factNeed.timeframe.from
        ? new Date(input.factNeed.timeframe.from).toISOString()
        : null,
      to: input.factNeed.timeframe.to
        ? new Date(input.factNeed.timeframe.to).toISOString()
        : null,
    },
    valueSchema: {
      kind: input.factNeed.valueSchema.kind,
      schemaVersion: normalizeFactNeedSemanticKey(
        input.factNeed.valueSchema.schemaVersion,
      ),
      allowedValues: canonicalFactNeedValues(
        input.factNeed.valueSchema.allowedValues,
      ),
    },
  };
}

/**
 * Business purpose: Compute the canonical cross-wording identity of one missing operational fact.
 *
 * Business rules:
 * - The digest covers every tenant, assessment, entity, scope, environment, timeframe and value-schema coordinate.
 * - Human wording, locale and rule order cannot affect the digest.
 *
 * Execution flow:
 * 1. Build the canonical semantic identity.
 * 2. Serialize it in its fixed construction order.
 * 3. Return a prefixed SHA-256 digest.
 *
 * Failure cases:
 * - Non-serializable input throws rather than creating an incomplete identity.
 *
 * Side effects:
 * - Pure hashing without database writes or accepted factual authority.
 */
export function computeFactNeedIdentityDigest(input: {
  tenantOwnerId: string;
  assessmentId: string;
  factNeed: FactNeedInput;
}): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalFactNeedIdentity(input)), "utf-8")
    .digest("hex")}`;
}

/**
 * Business purpose: Ensure the customer answer control represents the FactNeed's declared typed value schema.
 *
 * Business rules:
 * - ENUM needs use SINGLE_SELECT and exactly the same canonical choice values.
 * - Non-ENUM needs use FREE_TEXT and cannot smuggle a separate fixed value set through labels.
 *
 * Execution flow:
 * 1. Canonicalize the request choice values.
 * 2. Compare control type and values with the typed value schema.
 * 3. Reject incompatible representations.
 *
 * Failure cases:
 * - Any control/schema mismatch raises HUMAN_REQUEST_INVALID before persistence.
 *
 * Side effects:
 * - Pure validation without changing requests, facts or coverage.
 */
export function assertFactNeedControlCompatibility(input: {
  factNeed: FactNeedInput;
  controlType: string;
  choices: readonly { value: string }[];
  correlationId: string;
}): void {
  const enumNeed =
    input.factNeed.valueSchema.kind === FACT_NEED_VALUE_KINDS.enumeration;
  const valid = enumNeed
    ? input.controlType === HUMAN_RESOLUTION_CONTROL_TYPES.SINGLE_SELECT &&
      canonicalFactNeedValues(input.factNeed.valueSchema.allowedValues).join(
        "\u0000",
      ) ===
        canonicalFactNeedValues(
          input.choices.map((choice) => choice.value),
        ).join("\u0000")
    : input.controlType === HUMAN_RESOLUTION_CONTROL_TYPES.FREE_TEXT &&
      input.choices.length === 0;
  if (!valid) {
    throw problemException(
      ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_REQUEST_INVALID,
      input.correlationId,
      { status: HttpStatus.UNPROCESSABLE_ENTITY },
    );
  }
}

/**
 * Business purpose: Create or reuse one durable semantic FactNeed while retaining all bounded investigation provenance.
 *
 * Business rules:
 * - Identity is scoped by tenant owner and assessment and cannot merge different subjects, deployments, environments, timeframes or value schemas.
 * - Only ACCEPTED evidence from the same assessment and pinned repository commit may be recorded as supporting evidence.
 * - Claimed discovery ranges must resolve through exact immutable discovery record/digest references at current repository pins.
 * - Equivalent identity reuses the existing need and unions notes/evidence/ranges without changing its immutable semantic coordinates.
 * - A resolved or superseded need is never reopened or silently reinterpreted.
 *
 * Execution flow:
 * 1. Validate control/value compatibility plus accepted evidence and discovery-range provenance.
 * 2. Compute the canonical digest and load the assessment-owned need.
 * 3. Merge bounded investigation provenance when it exists, otherwise append a new OPEN need.
 * 4. Return its identity and any already-linked request for governed reuse.
 *
 * Failure cases:
 * - Foreign, invalidated, commit-mismatched or provenance-overflow evidence/discovery data rejects the whole transaction.
 * - Tenant mismatch or malformed persisted arrays fails closed as HUMAN_REQUEST_INVALID.
 *
 * Side effects:
 * - May insert one AssessmentFactNeed or update only its bounded investigation provenance; creates no accepted fact, decision or audit scope.
 */
export async function resolveAssessmentFactNeedInTx(
  tx: Prisma.TransactionClient,
  input: {
    assessmentId: string;
    tenantOwnerId: string;
    repositorySnapshotId: string;
    repositoryCommit: string;
    sourcePathPrefix: string | null;
    factNeed: FactNeedInput;
    controlType: string;
    choices: readonly { value: string }[];
    correlationId: string;
  },
): Promise<{ factNeedId: string; linkedRequestId: string | null }> {
  assertFactNeedControlCompatibility(input);
  const discoveryRefs = await validateFactNeedDiscoveryProvenanceInTx(tx, {
    assessmentId: input.assessmentId,
    repositorySnapshotId: input.repositorySnapshotId,
    repositoryCommit: input.repositoryCommit,
    sourcePathPrefix: input.sourcePathPrefix,
    investigationDiscoveryRefs: input.factNeed.investigationDiscoveryRefs,
    investigatedRangeIds: input.factNeed.investigatedRangeIds,
    correlationId: input.correlationId,
  });
  const evidenceIds = [...new Set(input.factNeed.acceptedEvidenceIds)].sort();
  if (evidenceIds.length > 0) {
    const accepted = await tx.assessmentEvidence.count({
      where: {
        assessmentId: input.assessmentId,
        evidenceId: { in: evidenceIds },
        state: AssessmentRecordState.ACCEPTED,
        repositoryCommit: input.repositoryCommit,
      },
    });
    if (accepted !== evidenceIds.length) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.EVIDENCE_REFERENCE_INVALID,
        input.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
  }

  const identityDigest = computeFactNeedIdentityDigest(input);
  const existing = await tx.assessmentFactNeed.findUnique({
    where: {
      assessmentId_identityDigest: {
        assessmentId: input.assessmentId,
        identityDigest,
      },
    },
    include: { humanRequest: { select: { requestId: true } } },
  });
  if (existing) {
    if (existing.tenantOwnerId !== input.tenantOwnerId) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_REQUEST_INVALID,
        input.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    const mergedDiscoveryRefs = canonicalDiscoveryRefs([
      ...canonicalDiscoveryRefs(existing.investigationDiscoveryRefs),
      ...discoveryRefs,
    ]);
    const mergedRangeIds = [
      ...new Set([
        ...persistedStringArray(existing.investigatedRangeIds),
        ...input.factNeed.investigatedRangeIds,
      ]),
    ];
    if (mergedDiscoveryRefs.length > 20 || mergedRangeIds.length > 500) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        input.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    await tx.assessmentFactNeed.update({
      where: { factNeedId: existing.factNeedId },
      data: {
        sourceInvestigationAttempts: [
          ...new Set([
            ...persistedStringArray(existing.sourceInvestigationAttempts),
            ...input.factNeed.sourceInvestigationAttempts,
          ]),
        ].slice(0, 100),
        acceptedEvidenceIds: [
          ...new Set([
            ...persistedStringArray(existing.acceptedEvidenceIds),
            ...evidenceIds,
          ]),
        ].slice(0, 100),
        investigationDiscoveryRefs: mergedDiscoveryRefs,
        investigatedRangeIds: mergedRangeIds,
      },
    });
    return {
      factNeedId: existing.factNeedId,
      linkedRequestId: existing.humanRequest?.requestId ?? null,
    };
  }

  const factNeedId = randomUUID();
  await tx.assessmentFactNeed.create({
    data: {
      factNeedId,
      assessmentId: input.assessmentId,
      tenantOwnerId: input.tenantOwnerId,
      identityDigest,
      subjectKind: input.factNeed.subject.kind,
      subjectKey: input.factNeed.subject.key,
      predicate: input.factNeed.predicate,
      operationalScope: input.factNeed.operationalScope,
      environment: input.factNeed.environment.kind,
      deploymentKey: input.factNeed.environment.deploymentKey,
      timeframeKind: input.factNeed.timeframe.kind,
      timeframeFrom: input.factNeed.timeframe.from
        ? new Date(input.factNeed.timeframe.from)
        : null,
      timeframeTo: input.factNeed.timeframe.to
        ? new Date(input.factNeed.timeframe.to)
        : null,
      valueKind: input.factNeed.valueSchema.kind,
      valueSchemaVersion: input.factNeed.valueSchema.schemaVersion,
      allowedValues: input.factNeed.valueSchema.allowedValues,
      sourceInvestigationAttempts: input.factNeed.sourceInvestigationAttempts,
      acceptedEvidenceIds: evidenceIds,
      investigationDiscoveryRefs: discoveryRefs,
      investigatedRangeIds: input.factNeed.investigatedRangeIds,
      status: AssessmentFactNeedStatus.OPEN,
    },
  });
  return { factNeedId, linkedRequestId: null };
}

/**
 * Business purpose: Project one persisted FactNeed into its strict API view without granting factual authority.
 *
 * Business rules:
 * - Persisted semantic coordinates and provenance lists are returned exactly under the typed contract.
 * - Historical rows without discovery references project an empty reference list without reinterpreting their stored attempts or ranges.
 * - The status reports lifecycle only; OPEN is not a negative fact and RESOLVED points to an accepted fact identity.
 *
 * Execution flow:
 * 1. Convert temporal values to ISO text.
 * 2. Reconstruct the typed identity and provenance collections, defaulting only the new nullable discovery-reference field.
 * 3. Validate and return the strict view.
 *
 * Failure cases:
 * - Malformed historical/persisted values fail schema validation rather than being silently repaired.
 *
 * Side effects:
 * - Pure projection without persistence or localization changes.
 */
export function factNeedViewOf(row: FactNeedRow): FactNeedView {
  return factNeedViewSchema.parse({
    factNeedId: row.factNeedId,
    identityDigest: row.identityDigest,
    status: row.status,
    resolvedFactId: row.resolvedFactId,
    subject: { kind: row.subjectKind, key: row.subjectKey },
    predicate: row.predicate,
    operationalScope: row.operationalScope,
    environment: {
      kind: row.environment,
      deploymentKey: row.deploymentKey,
    },
    timeframe: {
      kind: row.timeframeKind,
      from: row.timeframeFrom?.toISOString() ?? null,
      to: row.timeframeTo?.toISOString() ?? null,
    },
    valueSchema: {
      kind: row.valueKind,
      schemaVersion: row.valueSchemaVersion,
      allowedValues: row.allowedValues,
    },
    sourceInvestigationAttempts: row.sourceInvestigationAttempts,
    acceptedEvidenceIds: row.acceptedEvidenceIds,
    investigationDiscoveryRefs: canonicalDiscoveryRefs(
      row.investigationDiscoveryRefs,
    ),
    investigatedRangeIds: row.investigatedRangeIds,
  });
}
