import { AUDIT_ACTOR_TYPES } from "@lcsp/contracts/audit";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { ASSESSMENT_PIPELINE_CONTINUE_PROBLEM_CODES } from "@lcsp/contracts/evidence";
import {
  HttpException,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  EvidenceAcceptanceStatus,
  RepositoryScanJobStatus,
  type Prisma,
} from "@prisma/client";
import { randomUUID } from "node:crypto";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { toPrismaAssessmentStatus } from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import {
  AssessmentPipelineContinuationService,
  FINISHED_ASSESSMENT_STATUSES,
} from "./assessment-pipeline-continuation.service.js";

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_QUIET_PERIOD_MS = 15 * 60_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const BATCH_SIZE = 50;
const SYSTEM_ACTOR_ID = "assessment-pipeline-reconciliation";
const NO_ATTEMPT_PROBLEM_CODES = new Set<string>([
  ASSESSMENT_PIPELINE_CONTINUE_PROBLEM_CODES.alreadyRunning,
  ASSESSMENT_PIPELINE_CONTINUE_PROBLEM_CODES.waitingForCustomer,
  ASSESSMENT_PIPELINE_CONTINUE_PROBLEM_CODES.completed,
]);

@Injectable()
export class AssessmentPipelineReconciliationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    AssessmentPipelineReconciliationService.name,
  );
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private cursorId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly continuation: AssessmentPipelineContinuationService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => {
        void this.poll();
      },
      this.config.get<number>(
        "pipelineReconciliation.pollIntervalMs",
        DEFAULT_POLL_INTERVAL_MS,
      ),
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const now = new Date();
      const quietPeriodMs = this.config.get<number>(
        "pipelineReconciliation.quietPeriodMs",
        DEFAULT_QUIET_PERIOD_MS,
      );
      const maxAttempts = this.config.get<number>(
        "pipelineReconciliation.maxAttempts",
        DEFAULT_MAX_ATTEMPTS,
      );
      const quietBefore = new Date(now.getTime() - quietPeriodMs);
      const eligibleAssessment: Prisma.AssessmentWhereInput = {
        status: {
          notIn: [...FINISHED_ASSESSMENT_STATUSES].map(
            toPrismaAssessmentStatus,
          ),
        },
        updatedAt: { lte: quietBefore },
        technicalEvidenceReports: {
          some: { status: EvidenceAcceptanceStatus.ACCEPTED },
          none: { createdAt: { gt: quietBefore } },
        },
        runtimeEvents: { none: { createdAt: { gt: quietBefore } } },
        repositoryScanJobs: {
          none: {
            status: {
              notIn: [
                RepositoryScanJobStatus.COMPLETED,
                RepositoryScanJobStatus.FAILED,
                RepositoryScanJobStatus.BLOCKED,
              ],
            },
          },
        },
        OR: [
          { pipelineReconciliation: { is: null } },
          {
            pipelineReconciliation: {
              is: { attemptCount: { lt: maxAttempts } },
            },
          },
        ],
      };
      const candidates = await this.prisma.assessment.findMany({
        where: {
          ...eligibleAssessment,
          ...(this.cursorId ? { id: { gt: this.cursorId } } : {}),
        },
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
        select: {
          id: true,
          technicalEvidenceReports: {
            where: { status: EvidenceAcceptanceStatus.ACCEPTED },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { scanJobId: true },
          },
          repositoryScanJobs: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true },
          },
        },
      });
      if (candidates.length === 0) {
        this.cursorId = null;
        return;
      }
      this.cursorId = candidates.at(-1)?.id ?? null;
      for (const candidate of candidates) {
        if (
          candidate.technicalEvidenceReports[0]?.scanJobId !==
          candidate.repositoryScanJobs[0]?.id
        ) {
          continue;
        }
        // The customer stopped this pipeline; only their Continue resumes it.
        if (await this.continuation.isStoppedByCustomer(candidate.id)) {
          continue;
        }
        await this.reconcile(candidate.id, now, quietPeriodMs, maxAttempts);
      }
    } catch (error) {
      this.logger.error(
        `Assessment pipeline reconciliation poll failed (${error instanceof Error ? error.name : "unknown error"}).`,
      );
    } finally {
      this.polling = false;
    }
  }

  private async reconcile(
    assessmentId: string,
    now: Date,
    quietPeriodMs: number,
    maxAttempts: number,
  ): Promise<void> {
    const cooldownBefore = new Date(now.getTime() - quietPeriodMs);
    try {
      await this.prisma.pipelineReconciliation.createMany({
        data: [{ assessmentId }],
        skipDuplicates: true,
      });
      const claim = await this.prisma.pipelineReconciliation.updateMany({
        where: {
          assessmentId,
          attemptCount: { lt: maxAttempts },
          OR: [
            { lastAttemptAt: null },
            { lastAttemptAt: { lte: cooldownBefore } },
          ],
        },
        data: { attemptCount: { increment: 1 }, lastAttemptAt: now },
      });
      if (claim.count !== 1) return;

      try {
        await this.continuation.continuePipeline({
          assessmentId,
          actor: {
            userId: SYSTEM_ACTOR_ID,
            sessionId: SYSTEM_ACTOR_ID,
            role: AUTH_USER_ROLES.admin,
            scope: null,
          },
          actorType: AUDIT_ACTOR_TYPES.service,
          correlationId: `pipeline-reconciliation:${randomUUID()}`,
        });
        this.logger.log(`Resumed stalled assessment pipeline ${assessmentId}.`);
      } catch (error) {
        if (this.isNoAttemptConflict(error)) {
          await this.prisma.pipelineReconciliation.updateMany({
            where: { assessmentId, lastAttemptAt: now },
            data: { attemptCount: { decrement: 1 }, lastAttemptAt: null },
          });
          this.logger.debug(
            `Assessment pipeline ${assessmentId} needs no reconciliation.`,
          );
          return;
        }
        this.logger.warn(
          `Assessment pipeline ${assessmentId} reconciliation attempt failed (${error instanceof Error ? error.name : "unknown error"}).`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Assessment pipeline ${assessmentId} reconciliation claim failed (${error instanceof Error ? error.name : "unknown error"}).`,
      );
    }
  }

  private isNoAttemptConflict(error: unknown): boolean {
    if (!(error instanceof HttpException) || error.getStatus() !== 409)
      return false;
    const response = error.getResponse();
    if (typeof response !== "object" || response === null) return false;
    const problem = "problem" in response ? response.problem : null;
    return (
      typeof problem === "object" &&
      problem !== null &&
      "code" in problem &&
      typeof problem.code === "string" &&
      NO_ATTEMPT_PROBLEM_CODES.has(problem.code)
    );
  }
}
