import { randomUUID } from "node:crypto";

import { WIZARD_STATUS_CODES } from "@lcsp/contracts/assessment";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import {
  RECONCILE_VERIFIED_PROFILE_STATUSES,
  RECONCILE_VERIFIED_PROFILE_TOOL,
  type ReconcileVerifiedProfileResult,
} from "@lcsp/contracts/evidence";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import {
  AI_USAGE_FLOW_STATUSES,
  CONFLICT_RECORD_STATUSES,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
  TECHNICAL_EVIDENCE_REPORT_STATUSES,
  VERIFIED_PROFILE_STATUSES,
} from "@lcsp/contracts/scan";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import type { Prisma } from "@prisma/client";

import {
  toPrismaConflictRecordStatus,
  toPrismaEvidenceAcceptanceStatus,
  toPrismaVerifiedProfileStatus,
  toPrismaWizardStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { ReconcileProfileToVerifiedProfileCommand } from "./reconcile-profile-to-verified-profile.command.js";

const DECISION_REF_PREFIX = "reconciliation:";
const MAX_DECISION_REFS = 50;
const MAX_FACT_REFS = 100;
const SERVICE_ACTOR_ID = "agentic-evidence-orchestrator";
const RAW_EVIDENCE_FIELD_NAMES = new Set([
  "ast",
  "astBody",
  "ast_body",
  "body",
  "prompt",
  "promptText",
  "prompt_text",
  "rawPrompt",
  "rawSource",
  "raw_prompt",
  "raw_source",
  "secret",
  "sourceCode",
  "source_code",
  "token",
]);

export type ReconcileProfileToVerifiedProfileDto = {
  status: typeof RECONCILE_VERIFIED_PROFILE_STATUSES.ready;
  result: ReconcileVerifiedProfileResult;
  correlationId: string;
};

@CommandHandler(ReconcileProfileToVerifiedProfileCommand)
export class ReconcileProfileToVerifiedProfileHandler implements ICommandHandler<ReconcileProfileToVerifiedProfileCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    private readonly outbox: OutboxRepository,
  ) {}

  async execute(
    command: ReconcileProfileToVerifiedProfileCommand,
  ): Promise<ReconcileProfileToVerifiedProfileDto> {
    this.assertInput(command);
    const input = command.input;
    const result = await this.prisma.$transaction(async (tx) => {
      const [
        wizard,
        report,
        flow,
        existingByIdempotencyKey,
        existingForAssessment,
      ] = await Promise.all([
        tx.wizardProfile.findFirst({
          where: {
            id: input.wizardProfileId,
            assessmentId: input.assessmentId,
            organizationId: command.organizationId,
            status: toPrismaWizardStatus(WIZARD_STATUS_CODES.submitted),
          },
          select: { id: true, version: true, answers: true },
        }),
        tx.technicalEvidenceReport.findFirst({
          where: {
            id: input.technicalEvidenceReportId,
            assessmentId: input.assessmentId,
            organizationId: command.organizationId,
            status: toPrismaEvidenceAcceptanceStatus(
              TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
            ),
          },
          select: { id: true },
        }),
        tx.aIUsageFlow.findFirst({
          where: {
            id: input.aiUsageFlowId,
            assessmentId: input.assessmentId,
            organizationId: command.organizationId,
            status: toPrismaEvidenceAcceptanceStatus(
              AI_USAGE_FLOW_STATUSES.accepted,
            ),
          },
          select: { id: true, schemaVersion: true, claims: true },
        }),
        tx.verifiedProfile.findFirst({
          where: {
            organizationId: command.organizationId,
            idempotencyKey: input.idempotencyKey,
          },
          select: {
            id: true,
            assessmentId: true,
            aiUsageFlowId: true,
            wizardProfileId: true,
            technicalEvidenceReportId: true,
            reconciliationDecisionRefs: true,
          },
        }),
        tx.verifiedProfile.findFirst({
          where: {
            assessmentId: input.assessmentId,
            organizationId: command.organizationId,
          },
          select: {
            id: true,
            aiUsageFlowId: true,
            wizardProfileId: true,
            technicalEvidenceReportId: true,
            reconciliationDecisionRefs: true,
          },
          orderBy: { createdAt: "desc" },
        }),
      ]);
      const existing = existingByIdempotencyKey ?? existingForAssessment;
      if (
        existingByIdempotencyKey &&
        existingByIdempotencyKey.assessmentId !== input.assessmentId
      ) {
        this.idempotencyConflict(command);
      }
      if (
        existing &&
        existing.aiUsageFlowId === input.aiUsageFlowId &&
        existing.wizardProfileId === input.wizardProfileId &&
        existing.technicalEvidenceReportId ===
          input.technicalEvidenceReportId &&
        sameRefs(
          refsFromJson(existing.reconciliationDecisionRefs),
          input.reconciliationDecisionRefs,
        )
      ) {
        return {
          profileId: existing.id,
          factEvidenceRefs: [] as string[],
          replay: true,
        };
      }
      if (
        existingByIdempotencyKey &&
        existingForAssessment?.id !== existingByIdempotencyKey.id
      ) {
        this.idempotencyConflict(command);
      }
      if (existing) {
        if (!wizard || !report || !flow) this.missingInput(command);
        const profile = await tx.technicalProfile.findFirst({
          where: {
            evidenceReportId: report.id,
            assessmentId: input.assessmentId,
            organizationId: command.organizationId,
          },
          select: { id: true },
        });
        if (
          !profile ||
          !(await tx.aIUsageFlow.findFirst({
            where: { id: flow.id, technicalProfileId: profile.id },
            select: { id: true },
          }))
        )
          this.missingInput(command);
        if (containsUnsafe(flow.claims)) this.invalid(command);
        const conflicts = await tx.conflictRecord.findMany({
          where: {
            aiUsageFlowId: flow.id,
            assessmentId: input.assessmentId,
            organizationId: command.organizationId,
          },
          select: { id: true, status: true },
        });
        if (
          conflicts.some(
            (item) =>
              item.status ===
              toPrismaConflictRecordStatus(CONFLICT_RECORD_STATUSES.pending),
          )
        )
          this.conflict(command);
        const expectedRefs = conflicts
          .map((item) => `${DECISION_REF_PREFIX}${item.id}`)
          .sort();
        if (!sameRefs(expectedRefs, input.reconciliationDecisionRefs))
          this.missingInput(command);
        const factEvidenceRefs = evidenceRefs(flow.claims).slice(
          0,
          MAX_FACT_REFS,
        );
        await tx.verifiedProfile.update({
          where: { id: existing.id },
          data: {
            aiUsageFlowId: flow.id,
            wizardProfileId: wizard.id,
            technicalEvidenceReportId: report.id,
            reconciliationDecisionRefs: expectedRefs,
            idempotencyKey: input.idempotencyKey,
            schemaVersion: flow.schemaVersion,
            providerVersion: RECONCILE_VERIFIED_PROFILE_TOOL.providerVersion,
            profileData: safeProfile(
              flow.claims,
              wizard.id,
              wizard.version,
              factEvidenceRefs,
            ) as Prisma.InputJsonValue,
            gatesPassedAt: {
              reconciliation_complete: new Date().toISOString(),
            },
            status: toPrismaVerifiedProfileStatus(
              VERIFIED_PROFILE_STATUSES.pendingApproval,
            ),
            approvedAt: null,
            approvedById: null,
            version: { increment: 1 },
          },
        });
        await this.auditWriter.writeInTx(
          {
            eventType: SCAN_EVENT_TYPES.verifiedProfilePersistedAudit,
            actorId: SERVICE_ACTOR_ID,
            organizationId: command.organizationId,
            assessmentId: input.assessmentId,
            resourceType: AUDIT_RESOURCE_TYPES.verifiedProfile,
            resourceId: existing.id,
            correlationId: command.correlationId,
            causationId: flow.id,
            decision: AUDIT_DECISIONS.allow,
            result: RECONCILE_VERIFIED_PROFILE_STATUSES.ready,
            redactionStatus: AUDIT_REDACTION_STATUSES.none,
            actor: { id: SERVICE_ACTOR_ID, type: AUDIT_ACTOR_TYPES.service },
            payload: {
              verifiedProfileId: existing.id,
              wizardProfileId: wizard.id,
              technicalEvidenceReportId: report.id,
              aiUsageFlowId: flow.id,
              factEvidenceRefCount: factEvidenceRefs.length,
              replacedExistingProfile: true,
            },
          },
          tx,
        );
        await this.outbox.enqueue(
          buildOutboxMessageInput({
            aggregateType: OUTBOX_AGGREGATE_TYPES.verifiedProfile,
            aggregateId: existing.id,
            eventType: SCAN_EVENT_TYPES.verifiedProfilePersisted,
            organizationId: command.organizationId,
            assessmentId: input.assessmentId,
            correlationId: command.correlationId,
            causationId: flow.id,
            actor: { id: SERVICE_ACTOR_ID, type: AUDIT_ACTOR_TYPES.service },
            result: RECONCILE_VERIFIED_PROFILE_STATUSES.ready,
            redactionStatus: AUDIT_REDACTION_STATUSES.none,
            idempotencyKey: `${existing.id}:${SCAN_EVENT_TYPES.verifiedProfilePersisted}:${flow.id}`,
            payload: {
              verifiedProfileId: existing.id,
              status: VERIFIED_PROFILE_STATUSES.pendingApproval,
              correlationId: command.correlationId,
              replacedExistingProfile: true,
            },
          }),
          tx,
        );
        return {
          profileId: existing.id,
          factEvidenceRefs,
          replay: false,
        };
      }
      if (!wizard || !report || !flow) this.missingInput(command);
      const profile = await tx.technicalProfile.findFirst({
        where: {
          evidenceReportId: report.id,
          assessmentId: input.assessmentId,
          organizationId: command.organizationId,
        },
        select: { id: true },
      });
      if (
        !profile ||
        !(await tx.aIUsageFlow.findFirst({
          where: { id: flow.id, technicalProfileId: profile.id },
          select: { id: true },
        }))
      )
        this.missingInput(command);
      if (containsUnsafe(flow.claims)) this.invalid(command);
      const conflicts = await tx.conflictRecord.findMany({
        where: {
          aiUsageFlowId: flow.id,
          assessmentId: input.assessmentId,
          organizationId: command.organizationId,
        },
        select: { id: true, status: true },
      });
      if (
        conflicts.some(
          (item) =>
            item.status ===
            toPrismaConflictRecordStatus(CONFLICT_RECORD_STATUSES.pending),
        )
      )
        this.conflict(command);
      const expectedRefs = conflicts
        .map((item) => `${DECISION_REF_PREFIX}${item.id}`)
        .sort();
      if (!sameRefs(expectedRefs, input.reconciliationDecisionRefs))
        this.missingInput(command);
      const factEvidenceRefs = evidenceRefs(flow.claims).slice(
        0,
        MAX_FACT_REFS,
      );
      const profileId = randomUUID();
      await tx.verifiedProfile.create({
        data: {
          id: profileId,
          aiUsageFlowId: flow.id,
          wizardProfileId: wizard.id,
          technicalEvidenceReportId: report.id,
          reconciliationDecisionRefs: expectedRefs,
          idempotencyKey: input.idempotencyKey,
          assessmentId: input.assessmentId,
          organizationId: command.organizationId,
          schemaVersion: flow.schemaVersion,
          providerVersion: RECONCILE_VERIFIED_PROFILE_TOOL.providerVersion,
          profileData: safeProfile(
            flow.claims,
            wizard.id,
            wizard.version,
            factEvidenceRefs,
          ) as Prisma.InputJsonValue,
          gatesPassedAt: {
            reconciliation_complete: new Date().toISOString(),
          },
          status: toPrismaVerifiedProfileStatus(
            VERIFIED_PROFILE_STATUSES.pendingApproval,
          ),
        },
      });
      await this.auditWriter.writeInTx(
        {
          eventType: SCAN_EVENT_TYPES.verifiedProfilePersistedAudit,
          actorId: SERVICE_ACTOR_ID,
          organizationId: command.organizationId,
          assessmentId: input.assessmentId,
          resourceType: AUDIT_RESOURCE_TYPES.verifiedProfile,
          resourceId: profileId,
          correlationId: command.correlationId,
          causationId: flow.id,
          decision: AUDIT_DECISIONS.allow,
          result: RECONCILE_VERIFIED_PROFILE_STATUSES.ready,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          actor: { id: SERVICE_ACTOR_ID, type: AUDIT_ACTOR_TYPES.service },
          payload: {
            verifiedProfileId: profileId,
            wizardProfileId: wizard.id,
            technicalEvidenceReportId: report.id,
            aiUsageFlowId: flow.id,
            factEvidenceRefCount: factEvidenceRefs.length,
          },
        },
        tx,
      );
      await this.outbox.enqueue(
        buildOutboxMessageInput({
          aggregateType: OUTBOX_AGGREGATE_TYPES.verifiedProfile,
          aggregateId: profileId,
          eventType: SCAN_EVENT_TYPES.verifiedProfilePersisted,
          organizationId: command.organizationId,
          assessmentId: input.assessmentId,
          correlationId: command.correlationId,
          causationId: flow.id,
          actor: { id: SERVICE_ACTOR_ID, type: AUDIT_ACTOR_TYPES.service },
          result: RECONCILE_VERIFIED_PROFILE_STATUSES.ready,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          idempotencyKey: `${profileId}:${SCAN_EVENT_TYPES.verifiedProfilePersisted}`,
          payload: {
            verifiedProfileId: profileId,
            status: VERIFIED_PROFILE_STATUSES.pendingApproval,
            correlationId: command.correlationId,
          },
        }),
        tx,
      );
      return { profileId, factEvidenceRefs, replay: false };
    });
    return {
      status: RECONCILE_VERIFIED_PROFILE_STATUSES.ready,
      correlationId: command.correlationId,
      result: {
        verifiedProfileId: result.profileId,
        lifecycleStatus: VERIFIED_PROFILE_STATUSES.pendingApproval,
        factEvidenceRefs: result.factEvidenceRefs,
        sourceArtifactRefs: [
          `wizard:${input.wizardProfileId}`,
          `ter:${input.technicalEvidenceReportId}`,
          `flow:${input.aiUsageFlowId}`,
        ],
        outboxEventRef: `outbox:${SCAN_EVENT_TYPES.verifiedProfilePersisted}:${result.profileId}`,
      },
    };
  }

  private assertInput(command: ReconcileProfileToVerifiedProfileCommand): void {
    const { input } = command;
    if (
      !input.assessmentId ||
      !input.wizardProfileId ||
      !input.technicalEvidenceReportId ||
      !input.aiUsageFlowId ||
      !input.idempotencyKey ||
      input.reconciliationDecisionRefs.length > MAX_DECISION_REFS ||
      new Set(input.reconciliationDecisionRefs).size !==
        input.reconciliationDecisionRefs.length ||
      input.reconciliationDecisionRefs.some(
        (ref) => !ref.startsWith(DECISION_REF_PREFIX),
      )
    )
      this.invalid(command);
  }
  private invalid(command: ReconcileProfileToVerifiedProfileCommand): never {
    throw problemException(
      SCAN_ERROR_CODES.verifiedProfileSchemaInvalid,
      command.correlationId,
      { status: HttpStatus.UNPROCESSABLE_ENTITY },
    );
  }
  private missingInput(
    command: ReconcileProfileToVerifiedProfileCommand,
  ): never {
    throw problemException(
      SCAN_ERROR_CODES.evidenceReportNotFound,
      command.correlationId,
      { status: HttpStatus.NOT_FOUND },
    );
  }
  private conflict(command: ReconcileProfileToVerifiedProfileCommand): never {
    throw problemException(
      SCAN_ERROR_CODES.pendingConflictsExist,
      command.correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  private idempotencyConflict(
    command: ReconcileProfileToVerifiedProfileCommand,
  ): never {
    throw problemException(
      SCAN_ERROR_CODES.profileAlreadyExists,
      command.correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
}

function sameRefs(expected: string[], provided: string[]): boolean {
  return JSON.stringify(expected) === JSON.stringify([...provided].sort());
}
function refsFromJson(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((ref): ref is string => typeof ref === "string").sort()
    : [];
}
function evidenceRefs(claims: unknown): string[] {
  if (!Array.isArray(claims)) return [];
  return [
    ...new Set(
      claims.flatMap((claim) =>
        isRecord(claim) && Array.isArray(claim.evidence_refs)
          ? claim.evidence_refs.filter(
              (ref): ref is string => typeof ref === "string",
            )
          : [],
      ),
    ),
  ].sort();
}
function safeProfile(
  claims: unknown,
  wizardProfileId: string,
  wizardVersion: number,
  refs: string[],
): Record<string, unknown> {
  return {
    verified_claims: Array.isArray(claims) ? claims : [],
    fact_evidence_refs: refs,
    verification_source: "TECHNICAL_PLUS_WIZARD",
    wizard_context: {
      wizard_profile_id: wizardProfileId,
      version: wizardVersion,
    },
    evidence_chain_integrity: true,
  };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function containsUnsafe(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsUnsafe);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, item]) => RAW_EVIDENCE_FIELD_NAMES.has(key) || containsUnsafe(item),
  );
}
