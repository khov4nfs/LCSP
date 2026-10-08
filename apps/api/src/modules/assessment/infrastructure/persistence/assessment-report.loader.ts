import { Injectable, HttpStatus } from "@nestjs/common";
import { AUTH_USER_ROLES, type AuthUserRole } from "@lcsp/contracts/auth";
import {
  ARTIFACT_LIFECYCLE_STATES,
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  assessmentFinalReportArtifactSchema,
} from "@lcsp/contracts/assessment-domain";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import {
  ArtifactStorageService,
  chunkedManifestSchema,
} from "../../../../platform/storage/artifact-storage.service.js";
import { canonicalJson, sha256Hex } from "../../domain/domain-ids.js";

/** Reads the existing immutable artifact. This path never generates a report. */
@Injectable()
export class AssessmentReportLoader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ArtifactStorageService,
  ) {}

  async load(input: {
    assessmentId: string;
    artifactId: string;
    sessionUserId: string;
    subjectRole: AuthUserRole;
    correlationId: string;
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
      const report = assessmentFinalReportArtifactSchema.parse(
        JSON.parse(content),
      );
      const fingerprint = `sha256:${sha256Hex(canonicalJson(report.findings.map(({ decisionId, decisionRevision, decision }) => ({ decisionId, decisionRevision, decision }))))}`;
      if (
        manifest.artifact_id !== artifact.artifactId ||
        report.artifactId !== artifact.artifactId ||
        report.assessmentId !== artifact.assessmentId ||
        report.kind !== artifact.kind ||
        report.schemaVersion !== artifact.schemaVersion ||
        report.pins.legalPortfolioVersionId !==
          artifact.legalPortfolioVersionId ||
        report.pins.repositorySnapshotId !== artifact.repositorySnapshotId ||
        report.pins.repositoryCommit !== artifact.repositoryCommit ||
        report.caseRevision !== artifact.caseRevision ||
        report.decisionFingerprint !== fingerprint ||
        sha256Hex(content) !==
          artifact.contentSha256?.replace(/^sha256:/u, "") ||
        Buffer.byteLength(content) !== artifact.sizeBytes ||
        report.caseRevision !== domainCase.caseRevision ||
        report.pins.legalPortfolioVersionId !==
          domainCase.legalPortfolioVersionId ||
        report.pins.repositorySnapshotId !== domainCase.repositorySnapshotId ||
        report.pins.repositoryScanJobId !== domainCase.repositoryScanJobId ||
        report.pins.repositoryCommit !== domainCase.repositoryCommit
      ) {
        throw new Error("Final report integrity mismatch");
      }
      return {
        artifactId: artifact.artifactId,
        content: Buffer.from(content),
        contentSha256: sha256Hex(content),
      };
    } catch {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_INVALID,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
  }
}
