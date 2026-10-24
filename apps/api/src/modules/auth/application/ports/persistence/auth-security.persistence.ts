import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";

export const AUTH_SECURITY_PERSISTENCE = Symbol("AUTH_SECURITY_PERSISTENCE");

export type PasswordRecoveryCommit = {
  requestId: string;
  userId: string;
  passwordHash: string;
  now: number;
  correlationId: string;
};

export type DisableMfaCommit = {
  userId: string;
  sessionId: string;
  now: number;
  correlationId: string;
};

export type DisableMfaResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | typeof AUTH_ERROR_CODES.sessionInvalid
        | typeof AUTH_ERROR_CODES.mfaRequired;
    };

/** Atomic multi-record authentication operations. Prisma remains an infrastructure detail. */
export interface AuthSecurityPersistence {
  completePasswordRecovery(input: PasswordRecoveryCommit): Promise<boolean>;
  disableMfa(input: DisableMfaCommit): Promise<DisableMfaResult>;
}
