import Joi from "joi";

import type { AppConfig, NodeEnv } from "./config.types.js";

const SMTP_MAILBOX_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const SMTP_DISPLAY_NAME_PATTERN = /^([^<>]+)<\s*([^<>]+)\s*>$/;

function isValidSmtpFrom(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return true;
  }

  if (SMTP_MAILBOX_PATTERN.test(trimmed)) {
    return true;
  }

  const displayNameMatch = SMTP_DISPLAY_NAME_PATTERN.exec(trimmed);
  if (!displayNameMatch) {
    return false;
  }

  const [, displayName, mailbox] = displayNameMatch;
  return (
    displayName.trim().length > 0 && SMTP_MAILBOX_PATTERN.test(mailbox.trim())
  );
}

export const configValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "production", "test")
    .default("development"),
  DATABASE_URL: Joi.string().required(),
  AUTH_BCRYPT_COST: Joi.number().integer().min(10).default(12),
  AUTH_SESSION_TTL_SECONDS: Joi.number().integer().positive().default(86400),
  JWT_SECRET: Joi.string().min(32).required(),
  OAUTH_GITHUB_CLIENT_ID: Joi.string().required(),
  OAUTH_GITHUB_CLIENT_SECRET: Joi.string().required(),
  OAUTH_GOOGLE_CLIENT_ID: Joi.string().allow("").default(""),
  OAUTH_GOOGLE_CLIENT_SECRET: Joi.string().allow("").default(""),
  OAUTH_ALLOWED_REDIRECT_ORIGINS: Joi.string().allow("").default(""),
  OAUTH_ALLOWED_REDIRECT_URIS: Joi.string().required(),
  GITHUB_APP_SLUG: Joi.string().required(),
  GITHUB_APP_ID: Joi.string().required(),
  GITHUB_APP_PRIVATE_KEY: Joi.string().required(),
  GITHUB_APP_ALLOWED_REDIRECT_URIS: Joi.string().required(),
  GITHUB_APP_CLIENT_ID: Joi.string().required(),
  GITHUB_APP_CLIENT_SECRET: Joi.string().required(),
  RABBITMQ_URL: Joi.string().required(),
  RABBITMQ_EXCHANGE: Joi.string().default("lcsp.events"),
  OUTBOX_ENABLED: Joi.boolean().default(true),
  OUTBOX_POLL_INTERVAL_MS: Joi.number().integer().positive().default(1000),
  OUTBOX_BATCH_SIZE: Joi.number().integer().positive().default(50),
  OUTBOX_MAX_ATTEMPTS: Joi.number().integer().positive().default(5),
  MFA_SECRET_ENCRYPTION_KEY: Joi.string()
    .pattern(/^[0-9a-fA-F]{64}$/)
    .required()
    .messages({
      "string.pattern.base":
        '"MFA_SECRET_ENCRYPTION_KEY" must be exactly 64 hex characters (32 bytes)',
    }),
  SMTP_HOST: Joi.string().trim().allow("").default(""),
  SMTP_PORT: Joi.number().integer().positive().default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().trim().allow("").default(""),
  SMTP_PASS: Joi.string().trim().allow("").default(""),
  SMTP_FROM: Joi.string()
    .trim()
    .allow("")
    .default("")
    .custom((value: string, helpers): string => {
      if (isValidSmtpFrom(value)) {
        return value;
      }

      return helpers.error("string.smtpFrom") as unknown as string;
    })
    .messages({
      "string.smtpFrom":
        '"SMTP_FROM" must be a valid email or display-name address like "LCSP <noreply@lcsp.com>"',
    }),
  PYTHON_WORKER_BASE_URL: Joi.string().required(),
  WORKER_API_KEY: Joi.string().min(32).required(),
  ORCHESTRATION_DEBUG: Joi.boolean().default(false),
}).unknown(true);

function parseRedirectUris(value: string): string[] {
  return value
    .split(",")
    .map((uri) => uri.trim())
    .filter((uri) => uri.length > 0);
}

function parseRedirectOrigins(value: string): string[] {
  return parseRedirectUris(value).flatMap((entry) => {
    try {
      return [new URL(entry).origin];
    } catch {
      return [];
    }
  });
}

export function config(): AppConfig {
  const env = process.env;

  return {
    nodeEnv: (env.NODE_ENV as NodeEnv | undefined) ?? "development",
    database: {
      url: env.DATABASE_URL ?? "",
    },
    auth: {
      bcryptCost: Number(env.AUTH_BCRYPT_COST ?? 12),
      sessionTtlSeconds: Number(env.AUTH_SESSION_TTL_SECONDS ?? 86400),
      jwtSecret: env.JWT_SECRET ?? "",
    },
    oauth: {
      githubClientId: env.OAUTH_GITHUB_CLIENT_ID ?? "",
      githubClientSecret: env.OAUTH_GITHUB_CLIENT_SECRET ?? "",
      googleClientId: env.OAUTH_GOOGLE_CLIENT_ID ?? "",
      googleClientSecret: env.OAUTH_GOOGLE_CLIENT_SECRET ?? "",
      allowedRedirectOrigins: parseRedirectOrigins(
        env.OAUTH_ALLOWED_REDIRECT_ORIGINS ||
          env.OAUTH_ALLOWED_REDIRECT_URIS ||
          "",
      ),
      allowedRedirectUris: parseRedirectUris(
        env.OAUTH_ALLOWED_REDIRECT_URIS ?? "",
      ),
    },
    github: {
      appId: env.GITHUB_APP_ID ?? "",
      appSlug: env.GITHUB_APP_SLUG ?? "",
      allowedRedirectUris: parseRedirectUris(
        env.GITHUB_APP_ALLOWED_REDIRECT_URIS ?? "",
      ),
      clientId: env.GITHUB_APP_CLIENT_ID ?? "",
      clientSecret: env.GITHUB_APP_CLIENT_SECRET ?? "",
      privateKey: env.GITHUB_APP_PRIVATE_KEY ?? "",
    },
    rabbitmq: {
      url: env.RABBITMQ_URL ?? "",
      exchange: env.RABBITMQ_EXCHANGE ?? "lcsp.events",
    },
    outbox: {
      enabled: env.OUTBOX_ENABLED !== "false",
      pollIntervalMs: Number(env.OUTBOX_POLL_INTERVAL_MS ?? 1000),
      batchSize: Number(env.OUTBOX_BATCH_SIZE ?? 50),
      maxAttempts: Number(env.OUTBOX_MAX_ATTEMPTS ?? 5),
    },
    crypto: {
      mfaSecretEncryptionKey: env.MFA_SECRET_ENCRYPTION_KEY ?? "",
    },
    pythonWorker: {
      baseUrl: env.PYTHON_WORKER_BASE_URL ?? "",
    },
    worker: {
      apiKey: env.WORKER_API_KEY ?? "",
    },
    internal: {
      apiToken: env.INTERNAL_API_TOKEN ?? "test-internal-token",
    },
    email: {
      smtpHost: env.SMTP_HOST?.trim() ?? "",
      smtpPort: Number(env.SMTP_PORT ?? 587),
      smtpSecure: (env.SMTP_SECURE ?? "false").toLowerCase() === "true",
      smtpUser: env.SMTP_USER?.trim() ?? "",
      smtpPass: env.SMTP_PASS?.trim() ?? "",
      smtpFrom: env.SMTP_FROM?.trim() ?? "",
    },
    orchestration: {
      debug: (env.ORCHESTRATION_DEBUG ?? "false").toLowerCase() === "true",
    },
  };
}
