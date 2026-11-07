import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_EVENT_ACTOR_TYPES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_EVIDENCE_TYPES,
} from "@lcsp/contracts/assessment-domain";
import {
  isCanonicalRepositorySourcePath,
  isRepositoryPathInSourceScope,
} from "@lcsp/contracts/github-integration";
import { HttpStatus } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  canonicalJson,
  deterministicUuid,
  sha256Hex,
} from "../../../domain/domain-ids.js";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { AssessmentEventAppender } from "../../services/assessment-event-appender.service.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import {
  AssessmentCaseSupport,
  ROOT_AUDIT_ACTOR,
} from "../../../infrastructure/persistence/assessment-case-support.service.js";
import {
  AcceptAssessmentEvidenceCommand,
  type AcceptAssessmentEvidenceResult,
} from "./accept-assessment-evidence.command.js";

@CommandHandler(AcceptAssessmentEvidenceCommand)
export class AcceptAssessmentEvidenceHandler implements ICommandHandler<AcceptAssessmentEvidenceCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: AssessmentRuntimeAuthority,
    private readonly support: AssessmentCaseSupport,
    private readonly events: AssessmentEventAppender,
  ) {}

  /**
   * Business purpose: Accept source or search evidence only for the assessment's immutable commit and approved source directory.
   *
   * Business rules:
   * - The current Root lease and complete server-owned snapshot pins authorize the write.
   * - Every source path and every search scope, inspected entry point and fallback path must be canonical and inside the pinned directory.
   * - Scope validation precedes replay lookup so an existing evidence identifier cannot bypass the boundary.
   *
   * Execution flow:
   * 1. Authorize the Root and load the case's exact snapshot scope.
   * 2. Reject a commit mismatch or any out-of-scope evidence path.
   * 3. Derive the evidence identity and return its existing receipt or atomically persist the evidence and event.
   *
   * Failure cases:
   * - Invalid lease or pins, a wrong commit, ambiguous path or sibling/outside directory rejects before replay or persistence.
   *
   * Side effects:
   * - A new accepted evidence row and audit/event are written transactionally; a valid replay is read-only.
   */
  async execute(
    input: AcceptAssessmentEvidenceCommand,
  ): Promise<AcceptAssessmentEvidenceResult> {
    const request = input.request;
    return this.prisma.$transaction(async (tx) => {
      const run = await this.authority.authorizeInTx(tx, input);
      const pins = await this.support.loadPins(
        tx,
        input.assessmentId,
        input.correlationId,
        true,
      );
      if (request.repositoryCommit !== pins.repositoryCommit) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.EVIDENCE_PIN_MISMATCH,
          input.correlationId,
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }
      const pathsAllowed =
        request.type === ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE
          ? isCanonicalRepositorySourcePath(request.path) &&
            isRepositoryPathInSourceScope(request.path, pins.sourcePathPrefix)
          : request.scopes.every((scope) =>
              isRepositoryPathInSourceScope(scope.path, pins.sourcePathPrefix),
            ) &&
            request.inspectedEntryPoints.every((path) =>
              isRepositoryPathInSourceScope(path, pins.sourcePathPrefix),
            ) &&
            request.directSourceFallbacks.every((fallback) =>
              isRepositoryPathInSourceScope(
                fallback.path,
                pins.sourcePathPrefix,
              ),
            );
      if (!pathsAllowed) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.EVIDENCE_SOURCE_SCOPE_MISMATCH,
          input.correlationId,
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }
      let contentSha256: string;
      let payload: Prisma.InputJsonObject;
      let identity: string;
      if (request.type === ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE) {
        contentSha256 = request.excerptSha256;
        payload = {
          path: request.path,
          startLine: request.startLine,
          endLine: request.endLine,
        };
        identity = `${request.type}|${request.path}|${request.startLine}|${request.endLine}|${contentSha256}`;
      } else {
        const { type: _type, repositoryCommit: _commit, ...coverage } = request;
        void _type;
        void _commit;
        contentSha256 = `sha256:${sha256Hex(canonicalJson(coverage))}`;
        payload = coverage;
        identity = `${request.type}|${contentSha256}`;
      }
      const evidenceId = deterministicUuid(
        `${input.assessmentId}|${pins.repositoryCommit}|${identity}`,
      );
      const existing = await tx.assessmentEvidence.findUnique({
        where: { evidenceId },
      });
      if (existing) {
        return toEvidenceResult(existing, pins.caseRevision, true);
      }
      const created = await tx.assessmentEvidence.create({
        data: {
          evidenceId,
          assessmentId: input.assessmentId,
          type: request.type,
          repositoryCommit: pins.repositoryCommit,
          contentSha256,
          payload,
        },
      });
      await this.events.appendInTx(tx, {
        assessmentId: input.assessmentId,
        correlationId: input.correlationId,
        eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.EVIDENCE_ACCEPTED,
        actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
        executionId: run.executionId,
        payload: { evidenceId, caseRevision: pins.caseRevision },
        auditActor: ROOT_AUDIT_ACTOR,
      });
      return toEvidenceResult(created, pins.caseRevision, false);
    });
  }
}

function toEvidenceResult(
  row: {
    evidenceId: string;
    type: string;
    state: string;
    contentSha256: string;
  },
  caseRevision: number,
  replayed: boolean,
) {
  return {
    evidenceId: row.evidenceId,
    type: row.type,
    state: row.state,
    contentSha256: row.contentSha256,
    caseRevision,
    replayed,
  };
}
