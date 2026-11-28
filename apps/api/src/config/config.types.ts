import type { ModelUsageDebitMode } from "@lcsp/contracts/billing";

export interface DatabaseConfig {
  url: string;
}

export interface OAuthConfig {
  googleClientId: string;
  googleClientSecret: string;
  allowedRedirectOrigins: string[];
}

export interface GithubCliConfig {
  executablePath: string;
  metadataTimeoutMs: number;
  discoveryTimeoutMs: number;
  archiveTimeoutMs: number;
  maxJsonOutputBytes: number;
  maxDiscoveryOutputBytes: number;
  maxStderrBytes: number;
  maxArchiveBytes: number;
  maxConcurrentMetadataProcesses: number;
  maxConcurrentArchiveProcesses: number;
}

export interface GitlabCliConfig {
  executablePath: string;
  timeoutMs: number;
  maxJsonOutputBytes: number;
}

export interface BitbucketCliConfig {
  executablePath: string;
  timeoutMs: number;
  maxJsonOutputBytes: number;
}

export interface GithubCredentialPersistenceConfig {
  activeKekVersion: string;
  encodedKekKeyring: string;
}

export interface RabbitMqConfig {
  url: string;
  exchange: string;
}

export interface OutboxConfig {
  pollIntervalMs: number;
  batchSize: number;
  maxAttempts: number;
  brokerConnectTimeoutMs: number;
  brokerPublishTimeoutMs: number;
}

export interface SePayConfig {
  webhookSecret: string;
  timestampSkewSeconds: number;
}

export interface WorkerConfig {
  apiKey: string;
}

export interface EmailConfig {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
}

export interface OrchestrationConfig {
  debug: boolean;
}

export interface BillingReconciliationSweeperConfig {
  enabled: boolean;
  intervalMs: number;
}

export interface BillingConfig {
  sePayBankName: string;
  sePayBankAccountNumber: string;
  sePayAccountHolder: string;
  sePayQrUrlTemplate: string;
  admissionMasterKey: string;
  reconciliationSweeper: BillingReconciliationSweeperConfig;
}

/**
 * WP8 model-usage microcredit debit rollout gate configuration.
 * Rationale: Isolated from customer-payment BillingConfig so SePay config invariants stay intact
 * while keeping MODEL_USAGE_DEBIT=OFF enforced until Phase B+ gates are closed.
 */
export interface ModelUsageDebitConfig {
  mode: ModelUsageDebitMode;
}

/**
 * MFA security encryption key configuration.
 * Rationale: Injected into Auth security utilities via ConfigService to eliminate unvalidated process.env reads.
 */
export interface MfaConfig {
  secretEncryptionKey: string;
}

/**
 * Platform file and snapshot storage configuration.
 * Rationale: Centralizes artifact paths and temporary snapshot directories for GitHub integration and document storage.
 */
export interface StorageConfig {
  artifactStoragePath: string;
  snapshotArchiveCacheDir: string;
}

export const NODE_ENVS = {
  development: "development",
  production: "production",
  test: "test",
} as const;

export type NodeEnv = (typeof NODE_ENVS)[keyof typeof NODE_ENVS];

export interface CorsConfig {
  allowedOrigins: string[];
}

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  agentServerUrl: string;
  database: DatabaseConfig;
  oauth: OAuthConfig;
  cors: CorsConfig;
  githubCli: GithubCliConfig;
  gitlabCli: GitlabCliConfig;
  bitbucketCli: BitbucketCliConfig;
  providerAvailability: {
    bitbucketRestEnabled: boolean;
    azureDevOpsRestEnabled: boolean;
    externalIdentitySchemaReady: boolean;
  };
  githubCredentialPersistence: GithubCredentialPersistenceConfig;
  rabbitmq: RabbitMqConfig;
  outbox: OutboxConfig;
  sepay: SePayConfig;
  worker: WorkerConfig;
  email: EmailConfig;
  orchestration: OrchestrationConfig;
  billing: BillingConfig;
  modelUsageDebit: ModelUsageDebitConfig;
  mfa: MfaConfig;
  storage: StorageConfig;
}
