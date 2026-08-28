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
  const value = authRecordMetadataString(record, key);
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function authRecordDateMetadata(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
