import type { AuthRecord, Prisma } from "@prisma/client";

export const AUTH_RECORD_TYPES = {
  session: "SESSION",
  mfaOtpUse: "MFA_OTP_USE",
  mfaRecoveryCode: "MFA_RECOVERY_CODE",
  recoveryRequest: "RECOVERY_REQUEST",
  oauthIdentity: "OAUTH_IDENTITY",
  oauthState: "OAUTH_STATE",
} as const;

export type AuthRecordTypeValue =
  (typeof AUTH_RECORD_TYPES)[keyof typeof AUTH_RECORD_TYPES];

export function authRecordLookupKey(
  type: AuthRecordTypeValue,
  ...parts: readonly string[]
): string {
  return [type, ...parts].join(":");
}

export function authRecordMetadata(
  value: Prisma.JsonValue | null,
): Record<string, Prisma.JsonValue> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return {};
  }
  return value as Record<string, Prisma.JsonValue>;
}

export function authRecordMetadataString(
  record: Pick<AuthRecord, "metadata">,
  key: string,
): string | null {
  const value = authRecordMetadata(record.metadata)[key];
  return typeof value === "string" ? value : null;
}

export function authRecordMetadataDate(
  record: Pick<AuthRecord, "metadata">,
  key: string,
): Date | null {
  const value = authRecordMetadata(record.metadata)[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function authRecordDateMetadata(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
/**
 * Business purpose: Invalidate every account session's MFA and sensitive-action
 * proof together when the user's MFA generation changes.
 *
 * Business rules:
 * - Only the caller's locked User transaction may advance a proof generation.
 * - Preserve tokens/accessVersion and unrelated session metadata while clearing proofs.
 *
 * Execution flow:
 * 1. Select all session records belonging to the user inside the caller's transaction.
 * 2. Atomically null both proof timestamps and assign the new generation.
 *
 * Failure cases:
 * - Any SQL or transaction failure aborts the enclosing MFA change.
 *
 * Side effects:
 * - Updates persisted session metadata; does not revoke sessions or publish events.
 */
export async function invalidateSessionProofsInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  nextGenerationId: string,
): Promise<void> {
  // A single SQL UPDATE prevents partial cross-session invalidation. Both
  // the MFA lifecycle and session-save adapter take the User row lock first.
  await tx.$executeRaw`
    UPDATE "AuthRecord"
    SET "metadata" = COALESCE("metadata", '{}'::jsonb)
      || jsonb_build_object(
        'mfaVerifiedAt', NULL,
        'sensitiveActionVerifiedAt', NULL,
        'passwordReauthenticatedAt', NULL,
        'candidateMfaEnrollment', NULL,
        'mfaRotationInitiator', NULL,
        'mfaRotationGenerationId', NULL,
        'mfaGenerationId', ${nextGenerationId}::text
      ),
      "updatedAt" = (NOW() AT TIME ZONE 'UTC')
    WHERE "userId" = ${userId}
      AND "type" = 'SESSION'::"AuthRecordType"
  `;
}
