import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import { AUTH_USER_ROLES, type AuthUserRole } from "@lcsp/contracts/auth";
import {
  ARTIFACT_LIFECYCLE_STATES,
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import { ASSESSMENT_DOMAIN_ERROR_CODES } from "@lcsp/contracts/assessment-domain";
import {
  ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION,
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
          report.identity.repositorySnapshotId !==
            report.pins.repositorySnapshotId ||
          report.identity.repositoryCommit.toLowerCase() !==
            report.pins.repositoryCommit.toLowerCase() ||
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
        report.pins.repositorySnapshotId !== artifact.repositorySnapshotId ||
        // Git object IDs are hexadecimal identifiers, so letter casing is not
        // semantic. Normalize both persisted boundaries before comparison.
        report.pins.repositoryCommit.toLowerCase() !==
          artifact.repositoryCommit.toLowerCase() ||
        report.caseRevision !== artifact.caseRevision ||
        report.decisionFingerprint !== fingerprint ||
        sha256Hex(content) !==
          artifact.contentSha256?.replace(/^sha256:/u, "") ||
        Buffer.byteLength(content) !== artifact.sizeBytes ||
        report.caseRevision !== domainCase.caseRevision ||
        report.pins.ruleSetVersionId !== domainCase.ruleSetVersionId ||
        report.pins.repositorySnapshotId !== domainCase.repositorySnapshotId ||
        report.pins.repositoryScanJobId !== domainCase.repositoryScanJobId ||
        report.pins.repositoryCommit.toLowerCase() !==
          domainCase.repositoryCommit?.toLowerCase()
      ) {
        throw new FinalReportIntegrityError("Final report integrity mismatch");
      }
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
        };
      }
      return {
        artifactId: artifact.artifactId,
        content: Buffer.from(content),
        contentSha256: sha256Hex(content),
        sourceArtifactSha256: sha256Hex(content),
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
}
