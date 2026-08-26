import { randomUUID } from "node:crypto";

import {
  REPOSITORY_SCAN_JOB_STATUSES,
  type RepositoryScanJobStatus,
  type RepositoryScanTriggerSource,
} from "@lcsp/contracts/github-integration";

export type RepositoryScanJobProps = {
  id: string;
  assessmentId: string;
  snapshotId: string;
  idempotencyKey: string;
  triggerSource: RepositoryScanTriggerSource;
  status: RepositoryScanJobStatus;
  attemptCount: number;
  correlationId: string;
  blockedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type NewRepositoryScanJobProps = Omit<RepositoryScanJobProps, "id">;

/**
 * Represents a repository scan job bound to one immutable snapshot, assessment, organization, and idempotent trigger.
 */
export class RepositoryScanJob {
  private props: RepositoryScanJobProps;

  /**
   * Creates a scan-job aggregate with a generated identifier from prepared properties.
   *
   * @param props - Scan-job properties excluding the generated identifier.
   */
  private constructor(props: NewRepositoryScanJobProps) {
    this.props = { ...props, id: randomUUID() };
  }

  /**
   * Creates a standard queued scan job with zero attempts and no blocked reason.
   *
   * @param input - Assessment/snapshot/tenant identity, trigger provenance, idempotency key, and correlation ID.
   * @returns Newly queued repository scan job.
   */
  static create(
    input: Omit<
      RepositoryScanJobProps,
      | "id"
      | "status"
      | "attemptCount"
      | "blockedReason"
      | "createdAt"
      | "updatedAt"
    >,
  ): RepositoryScanJob {
    const now = new Date();
    return new RepositoryScanJob({
      ...input,
      status: REPOSITORY_SCAN_JOB_STATUSES.queued,
      attemptCount: 0,
      blockedReason: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Creates a scan job in a caller-selected lifecycle state while initializing attempt/timestamp fields.
   *
   * @param input - Scan-job fields including explicit status and blocked reason.
   * @returns Newly created repository scan job using the supplied initial status.
   */
  static createWithStatus(
    input: Omit<
      RepositoryScanJobProps,
      "id" | "attemptCount" | "createdAt" | "updatedAt"
    >,
  ): RepositoryScanJob {
    const now = new Date();
    return new RepositoryScanJob({
      ...input,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Reconstructs a scan-job aggregate from persisted state without regenerating identity or lifecycle metadata.
   *
   * @param props - Fully populated persisted scan-job properties.
   * @returns Rehydrated repository scan job.
   */
  static rehydrate(props: RepositoryScanJobProps): RepositoryScanJob {
    const entity = new RepositoryScanJob(props);
    entity.props = props;
    return entity;
  }

  /** @returns The scan-job identifier. */
  get id(): string {
    return this.props.id;
  }

  /** @returns The assessment that owns the scan job. */
  get assessmentId(): string {
    return this.props.assessmentId;
  }

  /** @returns The immutable repository snapshot being scanned. */
  get snapshotId(): string {
    return this.props.snapshotId;
  }

  /** @returns The organization that owns the scan job. */

  /** @returns The trigger idempotency key. */
  get idempotencyKey(): string {
    return this.props.idempotencyKey;
  }

  /** @returns The source that initiated the scan. */
  get triggerSource(): RepositoryScanTriggerSource {
    return this.props.triggerSource;
  }

  /** @returns The current scan-job lifecycle status. */
  get status(): RepositoryScanJobStatus {
    return this.props.status;
  }

  /** @returns The number of worker execution attempts recorded for the job. */
  get attemptCount(): number {
    return this.props.attemptCount;
  }

  /** @returns The correlation identifier associated with scan creation. */
  get correlationId(): string {
    return this.props.correlationId;
  }

  /** @returns The business-safe blocked reason, or null when the job is not blocked. */
  get blockedReason(): string | null {
    return this.props.blockedReason;
  }

  /** @returns The scan-job creation timestamp. */
  get createdAt(): Date {
    return this.props.createdAt;
  }

  /** @returns The most recent scan-job update timestamp. */
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
