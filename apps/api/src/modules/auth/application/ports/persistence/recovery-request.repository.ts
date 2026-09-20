import type { RecoveryRequest } from "../../../domain/models/auth.models.ts";

export const AUTH_RECOVERY_REQUEST_REPOSITORY = Symbol(
  "AUTH_RECOVERY_REQUEST_REPOSITORY",
);

export interface RecoveryRequestRepository {
  nextId(): string;
  save(request: RecoveryRequest, fingerprint?: string): Promise<void>;
  findByFingerprint(fingerprint: string): Promise<RecoveryRequest | null>;
}
