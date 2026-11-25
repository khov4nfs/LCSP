import type { ToolAccessMode } from "@lcsp/contracts/auth";

export const AUTH_CAPABILITY_SETTINGS_REPOSITORY = Symbol(
  "AUTH_CAPABILITY_SETTINGS_REPOSITORY",
);

export type CapabilitySettingsRecord = {
  id: string;
  userId: string;
  toolAccessMode: ToolAccessMode;
  connectorSearch: boolean;
  artifactsEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type CapabilitySettingsUpdate = {
  toolAccessMode?: ToolAccessMode;
  connectorSearch?: boolean;
  artifactsEnabled?: boolean;
};

/**
 * Persistence contract for customer-configurable runtime capability settings.
 *
 * Rationale (Why): Isolates the auth/settings application layer from Prisma types and enforces user-scoped queries.
 * Mechanism (How): Exposes single-record lookup and atomic upsert keyed by unique userId.
 * Invariants (What): All operations are strictly scoped to the authenticated userId (BOLA prevention).
 */
export interface CapabilitySettingsRepository {
  findByUserId(userId: string): Promise<CapabilitySettingsRecord | null>;
  upsert(
    userId: string,
    update: CapabilitySettingsUpdate,
  ): Promise<CapabilitySettingsRecord>;
}
