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

export interface AzureDevOpsCliConfig {
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
}

export interface PipelineReconciliationConfig {
  pollIntervalMs: number;
  quietPeriodMs: number;
  maxAttempts: number;
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

export interface VerifiedEpisodesConfig {
  consolidationIntervalMs: number;
}

export interface BillingConfig {
  sePayBankName: string;
  sePayBankAccountNumber: string;
  sePayAccountHolder: string;
  sePayQrUrlTemplate: string;
}

export const NODE_ENVS = {
  development: "development",
  production: "production",
  test: "test",
} as const;

export type NodeEnv = (typeof NODE_ENVS)[keyof typeof NODE_ENVS];

export interface AppConfig {
  nodeEnv: NodeEnv;
  database: DatabaseConfig;
  oauth: OAuthConfig;
  githubCli: GithubCliConfig;
  gitlabCli: GitlabCliConfig;
  bitbucketCli: BitbucketCliConfig;
  azureDevOpsCli: AzureDevOpsCliConfig;
  githubCredentialPersistence: GithubCredentialPersistenceConfig;
  rabbitmq: RabbitMqConfig;
  outbox: OutboxConfig;
  pipelineReconciliation: PipelineReconciliationConfig;
  sepay: SePayConfig;
  worker: WorkerConfig;
  email: EmailConfig;
  orchestration: OrchestrationConfig;
  verifiedEpisodes: VerifiedEpisodesConfig;
  billing: BillingConfig;
}
