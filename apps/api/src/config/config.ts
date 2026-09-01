import Joi from "joi";
import { isAbsolute } from "node:path";

import { NODE_ENVS, type AppConfig, type NodeEnv } from "./config.types.js";

const SMTP_MAILBOX_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const SMTP_DISPLAY_NAME_PATTERN = /^([^<>]+)<\s*([^<>]+)\s*>$/;

/**
 * Validates the supported SMTP sender formats: an empty value, a mailbox, or a display-name mailbox.
 *
 * @param value - SMTP sender value to validate.
 * @returns True when the sender is empty or matches a supported email-address format.
 */
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
    .valid(...Object.values(NODE_ENVS))
    .default(NODE_ENVS.development),
  DATABASE_URL: Joi.string().required(),
  AUTH_BCRYPT_COST: Joi.number().integer().min(10).default(12),
  AUTH_SESSION_TTL_SECONDS: Joi.number().integer().positive().default(86400),
  JWT_SECRET: Joi.string().min(32).required(),
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
  GITHUB_CLI_EXECUTABLE_PATH: Joi.string()
    .trim()
    .allow("")
    .default("")
    .custom((value: string, helpers): string =>
      !value || isAbsolute(value)
        ? value
        : (helpers.error("string.absolutePath") as unknown as string),
    )
    .messages({
      "string.absolutePath": '"GITHUB_CLI_EXECUTABLE_PATH" must be absolute',
    }),
  GITHUB_CLI_METADATA_TIMEOUT_MS: Joi.number()
    .integer()
    .positive()
    .default(15000),
  GITHUB_CLI_DISCOVERY_TIMEOUT_MS: Joi.number()
    .integer()
    .positive()
    .default(30000),
  GITHUB_CLI_ARCHIVE_TIMEOUT_MS: Joi.number()
    .integer()
    .positive()
    .default(120000),
  GITHUB_CLI_MAX_JSON_OUTPUT_BYTES: Joi.number()
    .integer()
    .positive()
    .default(1048576),
  GITHUB_CLI_MAX_DISCOVERY_OUTPUT_BYTES: Joi.number()
    .integer()
    .positive()
    .default(10485760),
  GITHUB_CLI_MAX_STDERR_BYTES: Joi.number().integer().positive().default(8192),
  GITHUB_CLI_MAX_ARCHIVE_BYTES: Joi.number()
    .integer()
    .positive()
    .default(104857600),
  GITHUB_CLI_MAX_CONCURRENT_METADATA_PROCESSES: Joi.number()
    .integer()
    .positive()
    .default(8),
  GITHUB_CLI_MAX_CONCURRENT_ARCHIVE_PROCESSES: Joi.number()
    .integer()
    .positive()
    .default(2),
  GITLAB_CLI_EXECUTABLE_PATH: Joi.string()
    .trim()
    .allow("")
    .default("")
    .custom((value: string, helpers): string =>
      !value || isAbsolute(value)
        ? value
        : (helpers.error("string.absolutePath") as unknown as string),
    )
    .messages({
      "string.absolutePath": '"GITLAB_CLI_EXECUTABLE_PATH" must be absolute',
    }),
  GITLAB_PROVIDER_ENABLED: Joi.boolean().default(false),
  GITLAB_CLI_TIMEOUT_MS: Joi.number().integer().positive().default(30000),
  GITLAB_CLI_MAX_JSON_OUTPUT_BYTES: Joi.number()
    .integer()
    .positive()
    .default(1048576),
  GITHUB_CLI_CREDENTIAL_PERSISTENCE_ENABLED: Joi.boolean().default(false),
  GITHUB_CLI_SNAPSHOT_PINNING_ENABLED: Joi.boolean().default(false),
  GITHUB_CLI_ARCHIVE_RETRIEVAL_ENABLED: Joi.boolean().default(false),
  GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION: Joi.string()
    .trim()
    .allow("")
    .default(""),
  GITHUB_CLI_CREDENTIAL_KEK_KEYRING: Joi.string().trim().default("{}"),
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
  WORKER_API_KEY: Joi.string().min(32).required(),
  ORCHESTRATION_DEBUG: Joi.boolean().default(false),
  VERIFIED_EPISODE_CONSOLIDATION_INTERVAL_MS: Joi.number()
    .integer()
    .min(0)
    .default(0),
})
  .unknown(true)
  .custom((env: Record<string, unknown>, helpers) => {
    if (
      env.GITHUB_CLI_SNAPSHOT_PINNING_ENABLED === true &&
      env.GITHUB_CLI_CREDENTIAL_PERSISTENCE_ENABLED !== true
    ) {
      return helpers.error("credentialKek.snapshotPinning");
    }
    if (
      env.GITHUB_CLI_ARCHIVE_RETRIEVAL_ENABLED === true &&
      (env.GITHUB_CLI_CREDENTIAL_PERSISTENCE_ENABLED !== true ||
        env.GITHUB_CLI_SNAPSHOT_PINNING_ENABLED !== true)
    ) {
      return helpers.error("credentialKek.archiveRetrieval");
    }
    if (env.GITHUB_CLI_CREDENTIAL_PERSISTENCE_ENABLED !== true) return env;
    const activeVersion = env.GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION;
    const encodedKeyring = env.GITHUB_CLI_CREDENTIAL_KEK_KEYRING;
    if (typeof activeVersion !== "string" || activeVersion.length === 0) {
      return helpers.error("credentialKek.activeVersion");
    }
    try {
      const parsed: unknown = JSON.parse(String(encodedKeyring));
      if (!isValidKekKeyring(parsed, activeVersion)) {
        return helpers.error("credentialKek.keyring");
      }
    } catch {
      return helpers.error("credentialKek.keyring");
    }
    return env;
  })
  .messages({
    "credentialKek.activeVersion":
      "GitHub CLI credential persistence requires an active KEK version",
    "credentialKek.keyring":
      "GitHub CLI credential persistence requires a valid 32-byte base64 KEK keyring containing the active version",
    "credentialKek.snapshotPinning":
      "GitHub CLI snapshot pinning requires credential persistence",
    "credentialKek.archiveRetrieval":
      "GitHub CLI archive retrieval requires credential persistence and snapshot pinning",
  });

function isValidKekKeyring(value: unknown, activeVersion: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0 || !Object.hasOwn(value, activeVersion))
    return false;
  return entries.every(([version, encoded]) => {
    if (!version || /[\r\n]/u.test(version) || typeof encoded !== "string") {
      return false;
    }
    const decoded = Buffer.from(encoded, "base64");
    const valid =
      decoded.length === 32 && decoded.toString("base64") === encoded;
    decoded.fill(0);
    return valid;
  });
}

/**
 * Parses a comma-separated redirect URI environment value into trimmed non-empty entries.
 *
 * @param value - Comma-separated redirect URI string.
 * @returns Ordered list of non-empty redirect URI values.
 */
function parseRedirectUris(value: string): string[] {
  return value
    .split(",")
    .map((uri) => uri.trim())
    .filter((uri) => uri.length > 0);
}

/**
 * Converts configured redirect URLs into unique-origin-compatible URL origins while ignoring invalid entries.
 *
 * @param value - Comma-separated redirect URL string.
 * @returns Origins extracted from valid URL entries.
 */
function parseRedirectOrigins(value: string): string[] {
  return parseRedirectUris(value).flatMap((entry) => {
    try {
      return [new URL(entry).origin];
    } catch {
      return [];
    }
  });
}

/**
 * Builds the typed application configuration object from validated process environment variables.
 *
 * @returns Runtime configuration grouped by infrastructure and application concern.
 */
export function config(): AppConfig {
  const env = process.env;

  return {
    nodeEnv: (env.NODE_ENV as NodeEnv | undefined) ?? NODE_ENVS.development,
    database: {
      url: env.DATABASE_URL ?? "",
    },
    auth: {
      bcryptCost: Number(env.AUTH_BCRYPT_COST ?? 12),
      sessionTtlSeconds: Number(env.AUTH_SESSION_TTL_SECONDS ?? 86400),
      jwtSecret: env.JWT_SECRET ?? "",
    },
    oauth: {
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
    githubCli: {
      executablePath: env.GITHUB_CLI_EXECUTABLE_PATH?.trim() ?? "",
      metadataTimeoutMs: Number(env.GITHUB_CLI_METADATA_TIMEOUT_MS ?? 15000),
      discoveryTimeoutMs: Number(env.GITHUB_CLI_DISCOVERY_TIMEOUT_MS ?? 30000),
      archiveTimeoutMs: Number(env.GITHUB_CLI_ARCHIVE_TIMEOUT_MS ?? 120000),
      maxJsonOutputBytes: Number(
        env.GITHUB_CLI_MAX_JSON_OUTPUT_BYTES ?? 1048576,
      ),
      maxDiscoveryOutputBytes: Number(
        env.GITHUB_CLI_MAX_DISCOVERY_OUTPUT_BYTES ?? 10485760,
      ),
      maxStderrBytes: Number(env.GITHUB_CLI_MAX_STDERR_BYTES ?? 8192),
      maxArchiveBytes: Number(env.GITHUB_CLI_MAX_ARCHIVE_BYTES ?? 104857600),
      maxConcurrentMetadataProcesses: Number(
        env.GITHUB_CLI_MAX_CONCURRENT_METADATA_PROCESSES ?? 8,
      ),
      maxConcurrentArchiveProcesses: Number(
        env.GITHUB_CLI_MAX_CONCURRENT_ARCHIVE_PROCESSES ?? 2,
      ),
    },
    gitlabCli: {
      enabled:
        (env.GITLAB_PROVIDER_ENABLED ?? "false").toLowerCase() === "true",
      executablePath: env.GITLAB_CLI_EXECUTABLE_PATH?.trim() ?? "",
      timeoutMs: Number(env.GITLAB_CLI_TIMEOUT_MS ?? 30000),
      maxJsonOutputBytes: Number(
        env.GITLAB_CLI_MAX_JSON_OUTPUT_BYTES ?? 1048576,
      ),
    },
    githubCredentialPersistence: {
      enabled:
        (
          env.GITHUB_CLI_CREDENTIAL_PERSISTENCE_ENABLED ?? "false"
        ).toLowerCase() === "true",
      snapshotPinningEnabled:
        (env.GITHUB_CLI_SNAPSHOT_PINNING_ENABLED ?? "false").toLowerCase() ===
        "true",
      archiveRetrievalEnabled:
        (env.GITHUB_CLI_ARCHIVE_RETRIEVAL_ENABLED ?? "false").toLowerCase() ===
        "true",
      activeKekVersion:
        env.GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION?.trim() ?? "",
      encodedKekKeyring: env.GITHUB_CLI_CREDENTIAL_KEK_KEYRING ?? "{}",
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
    verifiedEpisodes: {
      consolidationIntervalMs: Number(
        env.VERIFIED_EPISODE_CONSOLIDATION_INTERVAL_MS ?? 0,
      ),
    },
  };
}
