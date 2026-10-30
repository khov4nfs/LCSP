import { z } from "zod";

export const ROOT_CAPACITY_ID = "ASSESSMENT_ROOT";
export const ROOT_CAPACITY_REASONS = {
  initial: "INITIAL",
  disabled: "ADAPTIVE_DISABLED",
  emergency: "EMERGENCY_DISABLED",
  draining: "SERVER_DRAINING",
  stale: "METRICS_STALE_OR_MISSING",
  inconsistent: "METRICS_INCONSISTENT",
  memory: "MEMORY_PRESSURE",
  disk: "DISK_PRESSURE",
  cpu: "CPU_PRESSURE",
  database: "DATABASE_PRESSURE",
  checkpoint: "CHECKPOINT_PRESSURE",
  provider: "PROVIDER_PRESSURE",
  budget: "BUDGET_ADMISSION_DENIED",
  unknownProvider: "PROVIDER_LIMIT_UNKNOWN",
  physical: "PHYSICAL_CAPACITY",
  backlog: "BACKLOG_HEADROOM",
  idle: "LOW_DEMAND",
  cooldown: "COOLDOWN_OR_HYSTERESIS",
  override: "MANUAL_OVERRIDE",
  full: "GLOBAL_CAPACITY_FULL",
  fairness: "OWNER_FAIRNESS",
  held: "ASSESSMENT_ALREADY_ADMITTED",
  fenced: "SERVER_INCARNATION_FENCED",
  host: "SERVER_HOST_MISMATCH",
} as const;
export type RootCapacityReason =
  (typeof ROOT_CAPACITY_REASONS)[keyof typeof ROOT_CAPACITY_REASONS];

export const ROOT_CAPACITY_ERROR_CODES = {
  invalid: "ASSESSMENT_ROOT_CAPACITY_REQUEST_INVALID",
  unavailable: "ASSESSMENT_ROOT_CAPACITY_UNAVAILABLE",
  stale: "ASSESSMENT_ROOT_CAPACITY_STALE_OWNER",
  conflict: "ASSESSMENT_ROOT_CAPACITY_VERSION_CONFLICT",
  obsolete: "ASSESSMENT_ROOT_COMMAND_OBSOLETE",
} as const;

export const ROOT_CAPACITY_METRIC_SOURCES = {
  runtime: "PROCFS_CGROUP_DOCKER_NATIVE_CHECKPOINTER",
  database: "API_POSTGRES_USAGE_JOURNAL_OUTBOX",
  broker: "RABBITMQ_MANAGEMENT",
} as const;

const slot = z.number().int().min(0).max(64);
const positive = z.number().finite().positive();
const measure = z.number().finite().nonnegative().nullable();

export const rootCapacityPolicySchema = z
  .strictObject({
    enabled: z.boolean().default(false),
    minimum: slot.min(1).default(1),
    maximum: slot.min(1).default(2),
    initial: slot.min(1).default(2),
    scaleUpStep: slot.min(1).default(1),
    scaleDownStep: slot.min(1).default(1),
    evaluationSeconds: positive.min(5).max(300).default(15),
    scaleUpCooldownSeconds: positive.default(90),
    scaleDownCooldownSeconds: positive.default(60),
    hysteresisSamples: z.number().int().min(1).max(20).default(3),
    metricTtlSeconds: positive.min(10).max(600).default(60),
    memoryHeadroomBytes: positive.default(2 * 1024 ** 3),
    rootMemoryReserveBytes: positive.default(2 * 1024 ** 3),
    diskHeadroomBytes: positive.default(4 * 1024 ** 3),
    cpuPressureLimit: positive.max(1).default(0.75),
    diskPressureLimit: positive.max(1).default(0.25),
    dbConnectionLimitRatio: positive.max(1).default(0.75),
    rootDatabaseConnectionsReserve: z.number().int().min(1).max(64).default(4),
    checkpointLatencyLimitMs: positive.default(1000),
    providerConcurrentLimit: slot.min(1).nullable().default(null),
    providerRpmLimit: positive.nullable().default(null),
    providerTpmLimit: positive.nullable().default(null),
    manualOverride: slot.nullable().default(null),
    emergencyDisabled: z.boolean().default(false),
  })
  .refine(
    (p) =>
      p.minimum <= p.initial &&
      p.initial <= p.maximum &&
      p.metricTtlSeconds >= 2 * p.evaluationSeconds &&
      (p.manualOverride === null || p.manualOverride <= p.maximum),
    {
      message:
        "Capacity bounds must satisfy minimum <= initial <= maximum, bound the override, and allow two metric intervals",
    },
  );
export type RootCapacityPolicy = z.infer<typeof rootCapacityPolicySchema>;

export const rootCapacityRuntimeMetricsSchema = z.strictObject({
  sampledAt: z.iso.datetime(),
  source: z.literal(ROOT_CAPACITY_METRIC_SOURCES.runtime),
  workerSlots: slot.min(1),
  serverSlots: slot.min(1),
  activeNativeRuns: slot,
  activeNativeRoots: slot,
  reservedRootRuns: slot,
  draining: z.boolean(),
  cpuPressure: measure,
  memoryAvailableBytes: measure,
  cgroupMemoryAvailableBytes: measure,
  cgroupMemoryLimitBytes: measure,
  cgroupCpuLimitCores: measure,
  cgroupObserved: z.boolean(),
  processRssBytes: measure,
  diskAvailableBytes: measure,
  diskPressure: measure,
  sandboxMemoryBytes: measure,
  largestSandboxMemoryBytes: measure,
  sandboxCpuCores: measure,
  activeSandboxes: z.number().int().nonnegative().nullable(),
  sandboxSamples: z
    .array(
      z.strictObject({
        sandboxId: z.string().regex(/^[a-f0-9]{16}$/),
        threadHash: z
          .string()
          .regex(/^[a-f0-9]{24}$/)
          .nullable(),
        memoryBytes: z.number().finite().nonnegative(),
        memoryLimitBytes: z.number().finite().nonnegative(),
        cpuCores: z.number().finite().nonnegative(),
      }),
    )
    .max(256)
    .nullable(),
  brokerReady: z.number().int().nonnegative().nullable(),
  brokerUnacknowledged: z.number().int().nonnegative().nullable(),
  brokerOtherReady: z.number().int().nonnegative().nullable(),
  brokerObservedAt: z.iso.datetime().nullable(),
  brokerSource: z.literal(ROOT_CAPACITY_METRIC_SOURCES.broker),
  checkpointLatencyMs: measure,
  checkpointFailureRate: measure,
  checkpointObservedAt: z.iso.datetime().nullable(),
  provider429Count: measure,
  budgetDenialCount: measure,
});
export type RootCapacityRuntimeMetrics = z.infer<
  typeof rootCapacityRuntimeMetricsSchema
>;

export const rootCapacityServerSchema = z.strictObject({
  hostId: z.string().regex(/^[a-f0-9]{64}$/),
  incarnationId: z.uuid(),
});
const rootCapacityLiveSchema = rootCapacityServerSchema.extend({
  liveRunIds: z.array(z.uuid()).max(64),
});
export const rootCapacityRegisterSchema = rootCapacityLiveSchema.extend({
  expectedVersion: z.number().int().nonnegative(),
});
export const rootCapacityReportSchema = rootCapacityLiveSchema.extend({
  expectedVersion: z.number().int().nonnegative(),
  metrics: rootCapacityRuntimeMetricsSchema,
});
export const rootCapacityReserveSchema = rootCapacityServerSchema.extend({
  assessmentId: z.string().min(1).max(200),
  runId: z.uuid(),
  commandKey: z.string().min(1).max(500),
});
export const rootCapacityReleaseSchema = rootCapacityServerSchema.extend({
  runId: z.uuid(),
});
export const rootCapacityControlSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(8).max(500),
  policy: rootCapacityPolicySchema,
});

export interface RootCapacityDatabaseMetrics {
  sampledAt: string;
  source: typeof ROOT_CAPACITY_METRIC_SOURCES.database;
  queued: number;
  oldestWaitingSeconds: number;
  activeReservations: number;
  activeModelRequests: number;
  unknownModelOutcomes: number;
  providerRequestsLastMinute: number;
  providerTokensLastMinute: number | null;
  dbConnectionRatio: number;
  dbMaxConnections: number;
  dbUsedConnections: number;
  dbRootConnections: number;
  activeSandboxMemoryBytes: number | null;
  dbLatencyMs: number;
  completionsLastMinute: number;
  dispatchWaitP50Ms: number | null;
  dispatchWaitP95Ms: number | null;
  reservedCredits: string;
  settledCredits: string | null;
}
