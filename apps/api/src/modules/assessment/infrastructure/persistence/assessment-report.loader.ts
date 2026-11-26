import { Injectable, HttpStatus, HttpException } from "@nestjs/common";
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
import { buildCanonicalRepositoryUrl } from "@lcsp/contracts/github-integration";

/** Reads the existing immutable artifact. This path never generates a report. */
@Injectable()
export class AssessmentReportLoader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ArtifactStorageService,
    private readonly projectionService: LocalePresentationProjectionService,
  ) {}

  async load(input: {
    assessmentId: string;
    artifactId: string;
    sessionUserId: string;
    subjectRole: AuthUserRole;
    correlationId: string;
    locale?: string | null;
  }) {
    const artifact = await this.prisma.assessmentArtifact.findUnique({
      where: { artifactId: input.artifactId },
      include: { assessmentCase: { include: { assessment: true } } },
    });
    if (
      !artifact ||
      artifact.assessmentId !== input.assessmentId ||
      input.subjectRole !== AUTH_USER_ROLES.customer ||
      artifact.assessmentCase.assessment.ownerId !== input.sessionUserId
    ) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    // Rationale (Why): Enforce runtime capability policy at the artifact download boundary so disabling artifacts cannot be bypassed via direct API calls.
    // Mechanism (How): Queries the owner's CapabilitySetting row and rejects with 403 Forbidden (fail closed) if artifactsEnabled is explicitly false.
    // Invariants (What): Unconfigured accounts default to artifactsEnabled=true; existing ownership checks remain intact.
    if (this.prisma.capabilitySetting) {
      const capabilitySetting = await this.prisma.capabilitySetting.findUnique({
        where: { userId: input.sessionUserId },
        select: { artifactsEnabled: true },
      });
      if (capabilitySetting && capabilitySetting.artifactsEnabled === false) {
        throw problemException(
          AUTH_ERROR_CODES.rbacDenied,
          input.correlationId,
          { status: HttpStatus.FORBIDDEN },
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
    try {
      const manifest = chunkedManifestSchema.parse(
        JSON.parse(artifact.storageRef),
      );
      const content = await this.storage.readAndReconstruct(manifest);
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
          throw new Error("Final report pinned rule-set integrity mismatch");
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
          throw new Error("Final report pinned repository snapshot not found");
        }
        const authoritativePrefix = snapshot.sourcePathPrefix ?? null;
        if (report.pins.sourcePathPrefix !== authoritativePrefix) {
          throw new Error(
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
        report.pins.repositoryCommit !== artifact.repositoryCommit ||
        report.caseRevision !== artifact.caseRevision ||
        report.decisionFingerprint !== fingerprint ||
        sha256Hex(content) !==
          artifact.contentSha256?.replace(/^sha256:/u, "") ||
        Buffer.byteLength(content) !== artifact.sizeBytes ||
        report.caseRevision !== domainCase.caseRevision ||
        report.pins.ruleSetVersionId !== domainCase.ruleSetVersionId ||
        report.pins.repositorySnapshotId !== domainCase.repositorySnapshotId ||
        report.pins.repositoryScanJobId !== domainCase.repositoryScanJobId ||
        report.pins.repositoryCommit !== domainCase.repositoryCommit
      ) {
        throw new Error("Final report integrity mismatch");
      }
      const repositorySource = await this.loadRepositorySource({
        assessmentId: input.assessmentId,
        snapshotId: report.pins.repositorySnapshotId,
        commitSha: report.pins.repositoryCommit,
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
      if (error instanceof HttpException) throw error;
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_INVALID,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
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
