import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import { AUTH_LEGACY_AUDIT_EVENT_TYPES } from "@lcsp/contracts/auth";

import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { fingerprintToken } from "../../../infrastructure/security/security.utils.ts";
import type { RevokeSessionSuccess } from "../../contracts/auth/revoke-session.contract.ts";
import {
  AUTH_SESSION_REPOSITORY,
  type SessionRepository,
} from "../../ports/persistence/index.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { RevokeSessionCommand } from "./revoke-session.command.ts";

@CommandHandler(RevokeSessionCommand)
export class RevokeSessionHandler implements ICommandHandler<RevokeSessionCommand> {
  constructor(
    private readonly support: AuthSupportService,
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: SessionRepository,
  ) {}

  async execute(command: RevokeSessionCommand): Promise<RevokeSessionSuccess> {
    const { sessionToken, requestMeta } = command;
    const { sessions } = this;
    const correlationId =
      requestMeta.correlationId ?? this.support.createCorrelationId();
    const session = await sessions.findByFingerprint(
      fingerprintToken(sessionToken),
    );
    if (session) {
      session.revoke(this.support.now());
      await sessions.save(session);
    }
    await this.support.recordAudit({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.sessionRevoked,
      actor_id: session?.userId ?? null,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
    });
    return { ok: true, correlationId: correlationId };
  }
}
