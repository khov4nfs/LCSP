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
  githubCredentialPersistence: GithubCredentialPersistenceConfig;
  rabbitmq: RabbitMqConfig;
  outbox: OutboxConfig;
  crypto: CryptoConfig;
  worker: WorkerConfig;
  internal: InternalConfig;
  email: EmailConfig;
  orchestration: OrchestrationConfig;
}
