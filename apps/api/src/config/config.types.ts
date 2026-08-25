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
  rabbitmq: RabbitMqConfig;
  outbox: OutboxConfig;
  crypto: CryptoConfig;
  worker: WorkerConfig;
  internal: InternalConfig;
  email: EmailConfig;
  orchestration: OrchestrationConfig;
}
