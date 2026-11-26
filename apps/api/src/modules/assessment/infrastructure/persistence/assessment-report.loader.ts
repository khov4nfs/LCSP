import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import {
  AUTH_ERROR_CODES,
  AUTH_USER_ROLES,
  type AuthUserRole,
} from "@lcsp/contracts/auth";
import {
  ARTIFACT_LIFECYCLE_STATES,
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import { ASSESSMENT_DOMAIN_ERROR_CODES } from "@lcsp/contracts/assessment-domain";
import {
  ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION,
  ASSESSMENT_FINAL_REPORT_V4_SCHEMA_VERSION,
  assessmentFinalReportArtifactVersionedSchema,
} from "@lcsp/contracts/assessment-report";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { resolveResponseLanguage } from "@lcsp/contracts/shared/locale";
import { LocalePresentationProjectionService } from "../presentation/locale-presentation-projection.service.js";
import {
  ArtifactStorageService,
  chunkedManifestSchema,
} from "../../../../platform/storage/artifact-storage.service.js";
import { sha256Hex } from "../../domain/domain-ids.js";
import { decisionFingerprint } from "../../domain/decision-fingerprint.js";
import {
  classifyFinalReportFailure,
  FinalReportIntegrityError,
  finalReportFailureCode,
  withFinalReportDependencyDeadline,
} from "../../application/services/final-report-error-classifier.js";
import { buildCanonicalRepositoryUrl } from "@lcsp/contracts/github-integration";
import {
  assertReportRepositorySetCurrent,
  reportIdentityMatchesPins,
  reportPrimaryPin,
} from "../../domain/final-report-repository-pins.js";

/** Reads the existing immutable artifact. This path never generates a report. */
@Injectable()
export class AssessmentReportLoader {
  private readonly logger = new Logger(AssessmentReportLoader.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ArtifactStorageService,
    private readonly projectionService: LocalePresentationProjectionService,
  ) {}

  /**
   * Business purpose: Return a customer-owned ACTIVE final report after proving its immutable integrity.
   *
   * Business rules:
   * - Only the owning Customer may read a report and the Assessment must already be COMPLETE.
   * - Only ACTIVE artifacts are served; BUILDING, INVALID, and SUPERSEDED artifacts never reach storage.
   * - Manifest, schema, pins, decision fingerprint, hash, size, and frozen case identity must agree.
   *
   * Execution flow:
   * 1. Load the artifact with its Assessment ownership and lifecycle authority.
   * 2. Enforce owner, role, COMPLETE, ACTIVE, and storage-reference guards.
   * 3. Reconstruct and validate immutable bytes plus authoritative rule-set and snapshot pins.
   * 4. Optionally project an approved locale overlay and return content with source digests.
   *
   * Failure cases:
   * - Access failures are 404, inactive/corrupt artifacts are 409, dependency outages are 503,
   *   and unexpected internal failures are masked as 500.
   *
   * Side effects:
   * - Read-only database and storage access; locale projection may read durable localization overlays.
   */
  async load(input: {
    assessmentId: string;
    artifactId: string;
    sessionUserId: string;
    subjectRole: AuthUserRole;
    correlationId: string;
    locale?: string | null;
  }) {
    try {
      // The read, authorization, lifecycle gate, storage reconstruction, and
      // pin checks share one classification boundary so DB outages cannot leak.
      if (input.subjectRole !== AUTH_USER_ROLES.customer) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.notFound,
          input.correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }
      const artifact = await this.prisma.assessmentArtifact.findFirst({
        where: {
          artifactId: input.artifactId,
          assessmentId: input.assessmentId,
          assessmentCase: { assessment: { ownerId: input.sessionUserId } },
        },
        include: { assessmentCase: { include: { assessment: true } } },
      });
      if (!artifact) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.notFound,
          input.correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }
      // Why: A direct artifact read must obey the owner's capability setting after
      // ownership is proven. How: Check the setting before storage access.
      // Invariant: Missing settings retain the default enabled behavior.
      if (this.prisma.capabilitySetting) {
        const capabilitySetting =
          await this.prisma.capabilitySetting.findUnique({
            where: { userId: input.sessionUserId },
            select: { artifactsEnabled: true },
          });
        if (capabilitySetting?.artifactsEnabled === false) {
          throw problemException(
            AUTH_ERROR_CODES.rbacDenied,
            input.correlationId,
            {
              status: HttpStatus.FORBIDDEN,
            },
          );
        }
      }
      const domainCase = artifact.assessmentCase;
      if (
        domainCase.assessment.lifecycleState !==
          ASSESSMENT_LIFECYCLE_STATES.COMPLETE ||
        artifact.lifecycleState !== ARTIFACT_LIFECYCLE_STATES.ACTIVE ||
        !artifact.storageRef
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_INVALID,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      const manifest = chunkedManifestSchema.parse(
        JSON.parse(artifact.storageRef),
      );
      let content: string;
      try {
        content = await withFinalReportDependencyDeadline(
          this.storage.readAndReconstruct(manifest),
        );
      } catch (error) {
        // The manifest is server-owned, so storage BadRequest means persisted
        // corruption and must be reported as integrity conflict, not client 400.
        if (error instanceof BadRequestException) {
          throw new FinalReportIntegrityError(
            "Final-report storage integrity mismatch",
          );
        }
        throw error;
      }
      const report = assessmentFinalReportArtifactVersionedSchema.parse(
        JSON.parse(content),
      );
      if ("identity" in report) {
        const pinnedRuleSet =
          await this.prisma.complianceRuleSetVersion.findUnique({
            where: { id: artifact.ruleSetVersionId },
            select: {
              id: true,
              version: true,
              ruleSetDigest: true,
              legalSourceVersion: { select: { id: true, version: true } },
            },
          });
        if (
          !pinnedRuleSet ||
          !reportIdentityMatchesPins(report) ||
          report.pins.ruleSetVersionId !== pinnedRuleSet.id ||
          report.pins.ruleSetVersion !== pinnedRuleSet.version ||
          report.pins.ruleSetDigest !== pinnedRuleSet.ruleSetDigest ||
          report.pins.legalSourceVersionId !==
            pinnedRuleSet.legalSourceVersion.id ||
          report.pins.legalSourceVersion !==
            pinnedRuleSet.legalSourceVersion.version
        ) {
          throw new FinalReportIntegrityError(
            "Final report pinned rule-set integrity mismatch",
          );
        }
      }
      if (
        report.schemaVersion === ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION &&
        "sourcePathPrefix" in report.pins
      ) {
        const snapshot = await this.prisma.repositorySnapshot.findUnique({
          where: { id: report.pins.repositorySnapshotId },
          select: { id: true, sourcePathPrefix: true },
        });
        if (!snapshot) {
          throw new FinalReportIntegrityError(
            "Final report pinned repository snapshot not found",
          );
        }
        const authoritativePrefix = snapshot.sourcePathPrefix ?? null;
        if (report.pins.sourcePathPrefix !== authoritativePrefix) {
          throw new FinalReportIntegrityError(
            "Final report source path prefix does not match authoritative repository snapshot",
          );
        }
      }
      if (report.schemaVersion === ASSESSMENT_FINAL_REPORT_V4_SCHEMA_VERSION) {
        try {
          await assertReportRepositorySetCurrent(
            report,
            [artifact.repositorySetDigest, domainCase.repositorySetDigest],
            (snapshotId) =>
              this.prisma.repositorySnapshot.findUnique({
                where: { id: snapshotId },
                select: { sourcePathPrefix: true },
              }),
          );
        } catch (error) {
          // A drifted or foreign repository set is persisted damage, not a server fault.
          throw new FinalReportIntegrityError(
            error instanceof Error
              ? error.message
              : "Final report repository set mismatch",
          );
        }
      }
      const primaryPin = reportPrimaryPin(report);
      const reportDecisions =
        "ruleDetails" in report ? report.ruleDetails : report.findings;
      const fingerprint = decisionFingerprint(reportDecisions);
      if (
        manifest.artifact_id !== artifact.artifactId ||
        report.artifactId !== artifact.artifactId ||
        report.assessmentId !== artifact.assessmentId ||
        report.kind !== artifact.kind ||
        report.schemaVersion !== artifact.schemaVersion ||
        report.pins.ruleSetVersionId !== artifact.ruleSetVersionId ||
        primaryPin.repositorySnapshotId !== artifact.repositorySnapshotId ||
        // Git object IDs are hexadecimal identifiers, so letter casing is not
        // semantic. Normalize both persisted boundaries before comparison.
        primaryPin.repositoryCommit.toLowerCase() !==
          artifact.repositoryCommit.toLowerCase() ||
        report.caseRevision !== artifact.caseRevision ||
        report.decisionFingerprint !== fingerprint ||
        sha256Hex(content) !==
          artifact.contentSha256?.replace(/^sha256:/u, "") ||
        Buffer.byteLength(content) !== artifact.sizeBytes ||
        report.caseRevision !== domainCase.caseRevision ||
        report.pins.ruleSetVersionId !== domainCase.ruleSetVersionId ||
        primaryPin.repositorySnapshotId !== domainCase.repositorySnapshotId ||
        primaryPin.repositoryScanJobId !== domainCase.repositoryScanJobId ||
        primaryPin.repositoryCommit.toLowerCase() !==
          domainCase.repositoryCommit?.toLowerCase()
      ) {
        throw new FinalReportIntegrityError("Final report integrity mismatch");
      }
      const repositorySource = await this.loadRepositorySource({
        assessmentId: input.assessmentId,
        snapshotId: primaryPin.repositorySnapshotId,
        commitSha: primaryPin.repositoryCommit,
      });
      const locale = input.locale
        ? resolveResponseLanguage(input.locale)
        : null;
      if (locale) {
        const localized = assessmentFinalReportArtifactVersionedSchema.parse(
          await this.projectionService.localizedReportDocument(
            input.assessmentId,
            artifact.artifactId,
            sha256Hex(content),
            report,
            locale,
          ),
        );
        const localizedContent = Buffer.from(JSON.stringify(localized), "utf8");
        return {
          artifactId: artifact.artifactId,
          content: localizedContent,
          contentSha256: sha256Hex(localizedContent.toString("utf8")),
          sourceArtifactSha256: sha256Hex(content),
          repositorySource,
        };
      }
      return {
        artifactId: artifact.artifactId,
        content: Buffer.from(content),
        contentSha256: sha256Hex(content),
        sourceArtifactSha256: sha256Hex(content),
        repositorySource,
      };
    } catch (error) {
      const failureCode = finalReportFailureCode(error);
      // Expected access/integrity problems are already structured outcomes;
      // only operational failures need a bounded correlation-safe log record.
      if (!(error instanceof HttpException)) {
        this.logger.error(
          `Final report read failed; correlationId=${input.correlationId}; failure=${error instanceof Error ? error.name : typeof error}; code=${typeof failureCode === "string" ? failureCode : "UNCLASSIFIED"}`,
        );
      }
      throw classifyFinalReportFailure(
        error,
        input.correlationId,
        ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_INVALID,
      );
    }
  }

  /**
   * Business purpose: Resolve the pinned report's validated canonical repository identity for provider-correct PDF citations.
   * Business rules: The snapshot must belong to the authorized assessment, match the report commit, and agree with its connection's repository ID and full name.
   * Execution flow: 1. Load the exact snapshot and connection. 2. Verify immutable identity fields. 3. Build a provider-specific canonical URL from the persisted provider identity.
   * Failure cases: Missing or inconsistent provenance returns null, preserving the report and internal evidence without an external link.
   * Side effects: Performs a read-only database query; no report or evidence records are changed.
   */
  private async loadRepositorySource(input: {
    assessmentId: string;
    snapshotId: string;
    commitSha: string;
  }) {
    const snapshot = await this.prisma.repositorySnapshot.findFirst({
      where: { id: input.snapshotId, assessmentId: input.assessmentId },
      include: { connection: true },
    });
    if (
      !snapshot ||
      snapshot.commitSha.toLowerCase() !== input.commitSha.toLowerCase() ||
      snapshot.repositoryId !== snapshot.connection.repositoryId ||
      snapshot.repositoryFullName !== snapshot.connection.repositoryFullName
    ) {
      return null;
    }
    const canonicalRepositoryUrl = buildCanonicalRepositoryUrl(
      snapshot.connection.provider,
      snapshot.connection.repositoryFullName,
    );
    return canonicalRepositoryUrl
      ? {
          provider: snapshot.connection.provider,
          canonicalRepositoryUrl,
          commitSha: snapshot.commitSha,
        }
      : null;
  }
}
