import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  computeRepositoryProfileDigest,
  REPOSITORY_SCANNER_VERSIONS,
  repositoryProfileSchema,
  type RepositoryProfile,
} from "@lcsp/contracts/assessment-domain";
import { ASSESSMENT_DOMAIN_ERROR_CODES } from "@lcsp/contracts/assessment-domain";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { AssessmentCaseSupport } from "../../infrastructure/persistence/assessment-case-support.service.js";

/**
 * Manages deterministic repository pre-scan profiles, caching, and scope verification.
 */
@Injectable()
export class AssessmentRepositoryProfileService {
  private readonly profileCache = new Map<string, RepositoryProfile>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly support: AssessmentCaseSupport,
  ) {}

  /**
   * Business purpose: Generate a deterministic cache key for a repository pre-scan profile.
   *
   * Business rules:
   * - Key binds repository identity, lowercase commit SHA, canonical source prefix, and scanner version.
   * - Different scanner versions, commits, or path prefixes yield distinct cache partitions.
   *
   * Execution flow:
   * 1. Normalize commit SHA to lowercase and source prefix to canonical form.
   * 2. Format deterministic composite string key.
   *
   * Failure cases:
   * - None: pure deterministic string formatting.
   *
   * Side effects:
   * - None: pure calculation without I/O.
   */
  buildCacheKey(
    repositoryId: string,
    commitSha: string,
    sourcePathPrefix: string | null | undefined,
    scannerVersion: string = REPOSITORY_SCANNER_VERSIONS.v1,
  ): string {
    const prefix = sourcePathPrefix ? sourcePathPrefix.trim() : "ROOT";
    return `${repositoryId}:${commitSha.toLowerCase()}:${prefix}:${scannerVersion}`;
  }

  /**
   * Business purpose: Store a verified repository pre-scan profile for an authorized assessment.
   *
   * Business rules:
   * - Caller must own the assessment or possess service-level execution authority.
   * - Pinned repository commit and source path prefix must match the profile exactly.
   * - Profile payload must pass schema validation and verify its cryptographic content digest.
   *
   * Execution flow:
   * 1. Validate profile structure with repositoryProfileSchema.
   * 2. Verify content digest integrity against computed digest.
   * 3. Validate assessment ownership and load pinned snapshot coordinates.
   * 4. Enforce strict equality between profile pins and server-owned snapshot pins.
   * 5. Populate cache entry keyed by immutable coordinates.
   *
   * Failure cases:
   * - Malformed schema or mismatched content digest throws UNPROCESSABLE_ENTITY problem exception.
   * - Pin mismatch (commit or source prefix) throws UNPROCESSABLE_ENTITY problem exception.
   *
   * Side effects:
   * - Mutates in-memory profile cache for subsequent instant reuse.
   */
  async saveProfileInTx(
    tx: Prisma.TransactionClient,
    input: {
      assessmentId: string;
      correlationId: string;
      profile: RepositoryProfile;
    },
  ): Promise<{ ok: true; cacheKey: string; contentDigest: string }> {
    const parsed = repositoryProfileSchema.safeParse(input.profile);
    if (!parsed.success) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
        input.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    const profile = parsed.data;

    const expectedDigest = computeRepositoryProfileDigest(profile);
    if (profile.contentDigest !== expectedDigest) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        input.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    const pins = await this.support.loadPins(
      tx,
      input.assessmentId,
      input.correlationId,
      true,
    );

    if (
      profile.commitSha.toLowerCase() !== pins.repositoryCommit.toLowerCase()
    ) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.EVIDENCE_PIN_MISMATCH,
        input.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    if (
      (profile.sourcePathPrefix ?? null) !== (pins.sourcePathPrefix ?? null)
    ) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.EVIDENCE_SOURCE_SCOPE_MISMATCH,
        input.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    const cacheKey = this.buildCacheKey(
      profile.repositoryId,
      profile.commitSha,
      profile.sourcePathPrefix,
      profile.scannerVersion,
    );

    this.profileCache.set(cacheKey, profile);
    return { ok: true, cacheKey, contentDigest: profile.contentDigest };
  }

  /**
   * Business purpose: Retrieve a cached repository pre-scan profile for an authorized assessment.
   *
   * Business rules:
   * - The assessment must exist and possess pinned repository snapshot coordinates.
   * - Only return profiles matching the exact current pinned commit and source path prefix.
   *
   * Execution flow:
   * 1. Load pinned assessment snapshot coordinates in transaction.
   * 2. Build cache key from current pins.
   * 3. Look up profile in cache; return null if absent or invalidated.
   *
   * Failure cases:
   * - Missing assessment or pins throws NOT_FOUND / CONFLICT.
   *
   * Side effects:
   * - Read-only lookup; no database or cache mutations.
   */
  async getProfileInTx(
    tx: Prisma.TransactionClient,
    input: {
      assessmentId: string;
      correlationId: string;
    },
  ): Promise<RepositoryProfile | null> {
    const pins = await this.support.loadPins(
      tx,
      input.assessmentId,
      input.correlationId,
      true,
    );

    const snapshot = await tx.repositorySnapshot.findUnique({
      where: { id: pins.repositorySnapshotId },
      select: { repositoryId: true },
    });

    if (!snapshot) {
      return null;
    }

    const cacheKey = this.buildCacheKey(
      snapshot.repositoryId,
      pins.repositoryCommit,
      pins.sourcePathPrefix,
      REPOSITORY_SCANNER_VERSIONS.v1,
    );

    return this.profileCache.get(cacheKey) ?? null;
  }

  /**
   * Business purpose: Invalidate cached repository pre-scan profiles for a repository or commit.
   *
   * Business rules:
   * - Purge all cache keys associated with the invalid repository or commit.
   *
   * Execution flow:
   * 1. Search cache keys matching the invalid commit or repository.
   * 2. Delete matched keys from in-memory cache.
   *
   * Failure cases:
   * - None: idempotent purge.
   *
   * Side effects:
   * - Deletes entries from in-memory cache.
   */
  invalidateCache(input: {
    repositoryId?: string;
    commitSha?: string;
  }): number {
    let evictedCount = 0;
    const commitLower = input.commitSha?.toLowerCase();

    for (const key of this.profileCache.keys()) {
      const matchRepo = input.repositoryId
        ? key.startsWith(`${input.repositoryId}:`)
        : true;
      const matchCommit = commitLower ? key.includes(`:${commitLower}:`) : true;
      if (matchRepo && matchCommit) {
        this.profileCache.delete(key);
        evictedCount += 1;
      }
    }
    return evictedCount;
  }
}
