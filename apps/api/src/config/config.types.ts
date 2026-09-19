export interface DatabaseConfig {
  url: string;
}

export interface AuthConfig {
  bcryptCost: number;
  sessionTtlSeconds: number;
  jwtSecret: string;
}

export interface OAuthConfig {
  googleClientId: string;
  googleClientSecret: string;
  allowedRedirectOrigins: string[];
  allowedRedirectUris: string[];
}

export interface GithubConfig {
  appId: string;
  appSlug: string;
  allowedRedirectUris: string[];
  clientId: string;
  clientSecret: string;
  privateKey: string;
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
  enabled: boolean;
  executablePath: string;
  timeoutMs: number;
  maxJsonOutputBytes: number;
}

export interface BitbucketCliConfig {
  enabled: boolean;
  executablePath: string;
  timeoutMs: number;
  maxJsonOutputBytes: number;
}

export interface AzureDevOpsCliConfig {
  enabled: boolean;
  executablePath: string;
  timeoutMs: number;
  maxJsonOutputBytes: number;
}

export interface GithubCredentialPersistenceConfig {
  enabled: boolean;
  snapshotPinningEnabled: boolean;
  archiveRetrievalEnabled: boolean;
  activeKekVersion: string;
  encodedKekKeyring: string;
}

export interface RabbitMqConfig {
  url: string;
  exchange: string;
}

export interface OutboxConfig {
  enabled: boolean;
  pollIntervalMs: number;
  batchSize: number;
  maxAttempts: number;
}

export interface SePayConfig {
  webhookSecret: string;
  timestampSkewSeconds: number;
}

export interface CryptoConfig {
  mfaSecretEncryptionKey: string;
}

export interface WorkerConfig {
  apiKey: string;
}

export interface InternalConfig {
  apiToken: string;
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
  meteringEnabled: boolean;
  reservationCredits: string;
  maxInvocationChargeCredits: string;
  runtimeProvider: string;
  runtimeModel: string;
  maxInputTokens: string;
  maxInputBytes: string;
  maxOutputTokens: string;
  maxReasoningTokens: string;
  maxInvocationsPerGroup: string;
  authorizedRuntimeModels: string;
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
  auth: AuthConfig;
  oauth: OAuthConfig;
  github: GithubConfig;
  githubCli: GithubCliConfig;
  gitlabCli: GitlabCliConfig;
  bitbucketCli: BitbucketCliConfig;
  azureDevOpsCli: AzureDevOpsCliConfig;
  githubCredentialPersistence: GithubCredentialPersistenceConfig;
  rabbitmq: RabbitMqConfig;
  outbox: OutboxConfig;
  sepay: SePayConfig;
  crypto: CryptoConfig;
  worker: WorkerConfig;
  internal: InternalConfig;
  email: EmailConfig;
  orchestration: OrchestrationConfig;
  verifiedEpisodes: VerifiedEpisodesConfig;
  billing: BillingConfig;
  interview: InterviewConfig;
}

export interface InterviewConfig {
  guidanceVersion: string;
}
