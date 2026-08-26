import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  createProblemResult,
} from "@lcsp/contracts/auth";

import {
  generateMfaRecoveryCodes,
  hashMfaRecoveryCode,
} from "../../../infrastructure/security/mfa-recovery-code.utils.ts";
import type { AuthProblemResult } from "../../contracts/auth-workspace/common.contract.ts";
import type { GenerateMfaRecoveryCodesSuccess } from "../../contracts/auth-workspace/mfa.contract.ts";
import type { AuthWorkspaceRepositories } from "../../ports/persistence/auth-workspace-repositories.ts";
import { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
import { GenerateMfaRecoveryCodesCommand } from "./generate-mfa-recovery-codes.command.ts";

export class GenerateMfaRecoveryCodesHandler {
  constructor(
    private readonly support: AuthWorkspaceSupportService,
    private readonly repositories: AuthWorkspaceRepositories,
  ) {}

  async execute(
    command: GenerateMfaRecoveryCodesCommand,
  ): Promise<AuthProblemResult | GenerateMfaRecoveryCodesSuccess> {
    const { sessionToken, requestMeta } = command;
    const correlationId =
      requestMeta.correlationId ?? this.support.createCorrelationId();

    const session = await this.support.findValidSession(
      this.repositories,
      sessionToken,
    );
    if (!session) {
      return createProblemResult(
        AUTH_ERROR_CODES.sessionInvalid,
        correlationId,
      );
    }

    if (!session.isMfaVerified()) {
      return createProblemResult(AUTH_ERROR_CODES.mfaRequired, correlationId);
    }

    const enrollment = await this.repositories.mfaEnrollments.findByUserId(
      session.userId,
    );
    if (!enrollment) {
      return createProblemResult(AUTH_ERROR_CODES.mfaRequired, correlationId);
    }

    const now = this.support.now();
    const recoveryCodes = generateMfaRecoveryCodes();
    const batchId = this.repositories.mfaRecoveryCodes.nextBatchId();
    await this.repositories.mfaRecoveryCodes.replaceForUser(
      session.userId,
      recoveryCodes.map((code) => ({
        id: this.repositories.mfaRecoveryCodes.nextId(),
        codeHash: hashMfaRecoveryCode(code),
      })),
      batchId,
      now,
    );

    await this.support.recordAudit(this.repositories, {
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRecoveryCodesGenerated,
      actor_id: session.userId,
      resource_type: AUDIT_RESOURCE_TYPES.authMfaRecoveryCode,
      resource_id: batchId,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
      session_id: session.id,
      batch_id: batchId,
      code_count: recoveryCodes.length,
    });
    await this.support.recordAudit(this.repositories, {
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRecoveryCodeViewed,
      actor_id: session.userId,
      resource_type: AUDIT_RESOURCE_TYPES.authMfaRecoveryCode,
      resource_id: batchId,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
      session_id: session.id,
      batch_id: batchId,
    });

    return {
      ok: true,
      correlationId: correlationId,
      recovery_codes: recoveryCodes,
    };
  }
}
