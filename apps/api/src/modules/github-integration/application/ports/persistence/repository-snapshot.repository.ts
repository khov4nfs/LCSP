import type { OutboxMessageInput } from "@lcsp/contracts/outbox";
import type { AuditEventInput } from "@lcsp/contracts/audit";

import type { RepositorySnapshot } from "../../../domain/entities/repository-snapshot.entity.js";

export const REPOSITORY_SNAPSHOT_REPOSITORY = Symbol(
  "REPOSITORY_SNAPSHOT_REPOSITORY",
);

export interface RepositorySnapshotRepository {
  saveWithCreatedEvent(
    snapshot: RepositorySnapshot,
    event: OutboxMessageInput,
    audit: AuditEventInput,
  ): Promise<void>;
}

export class RepositorySnapshotAuthorityChangedError extends Error {
  constructor() {
    super("repository_snapshot_authority_changed");
  }
}
