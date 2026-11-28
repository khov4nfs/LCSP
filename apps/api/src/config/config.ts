import Joi from "joi";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MODEL_USAGE_DEBIT_MODES,
  type ModelUsageDebitMode,
} from "@lcsp/contracts/billing";

import { NODE_ENVS, type AppConfig, type NodeEnv } from "./config.types.js";

export const CONFIG_WORKSPACE_ROOT = findWorkspaceRoot(
  dirname(fileURLToPath(import.meta.url)),
);

function findWorkspaceRoot(startDir: string): string {
  let currentDir = resolve(startDir);

  while (true) {
    const packageJsonPath = resolve(currentDir, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(
          readFileSync(packageJsonPath, "utf8"),
        ) as {
          name?: unknown;
        };
        if (packageJson.name === "lcsp") return currentDir;
      } catch {
        // Keep walking up; malformed intermediate package files are not roots.
      }
    }

    const parentDir = resolve(currentDir, "..");
    if (parentDir === currentDir) return startDir;
    currentDir = parentDir;
  }
}

const SMTP_MAILBOX_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const SMTP_DISPLAY_NAME_PATTERN = /^([^<>]+)<\s*([^<>]+)\s*>$/;

function paymentQrTemplateSchema() {
  return Joi.string()
    .trim()
    .custom((value: string, helpers): string => {
      if (!value.includes("{amountVnd}") || !value.includes("{paymentCode}"))
        return helpers.error("string.paymentQrTemplate") as unknown as string;
      try {
        const rendered = value
          .replaceAll("{amountVnd}", "10000")
          .replaceAll("{paymentCode}", "LCSPTEST");
        if (new URL(rendered).protocol === "https:") return value;
      } catch {
        // Report the stable payment-template validation error below.
      }
      return helpers.error("string.paymentQrTemplate") as unknown as string;
    });
}

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

export function createConfigValidationSchema(workspaceRoot = process.cwd()) {
  void workspaceRoot;
  return Joi.object({
    NODE_ENV: Joi.string()
      .valid(...Object.values(NODE_ENVS))
      .default(NODE_ENVS.development),
    PORT: Joi.number().port().default(3000),
    DATABASE_URL: Joi.string()
      .trim()
      .pattern(/^postgres(ql)?:\/\//)
      .required()
      .messages({
        "string.pattern.base":
          '"DATABASE_URL" must be a valid postgresql:// URI',
      }),
    OAUTH_GOOGLE_CLIENT_ID: Joi.string().allow("").default(""),
    OAUTH_GOOGLE_CLIENT_SECRET: Joi.string().allow("").default(""),
    OAUTH_ALLOWED_REDIRECT_ORIGINS: Joi.string().allow("").default(""),
    CORS_ALLOWED_ORIGINS: Joi.string().allow("").default(""),
    GITHUB_CLI_EXECUTABLE_PATH: cliExecutablePathSchema(
      "GITHUB_CLI_EXECUTABLE_PATH",
    ),
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
    GITHUB_CLI_MAX_STDERR_BYTES: Joi.number()
      .integer()
      .positive()
      .default(8192),
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
    GITLAB_CLI_EXECUTABLE_PATH: cliExecutablePathSchema(
      "GITLAB_CLI_EXECUTABLE_PATH",
    ),
    GITLAB_CLI_TIMEOUT_MS: Joi.number().integer().positive().default(30000),
    GITLAB_CLI_MAX_JSON_OUTPUT_BYTES: Joi.number()
      .integer()
      .positive()
      .default(1048576),
    BITBUCKET_CLI_EXECUTABLE_PATH: cliExecutablePathSchema(
      "BITBUCKET_CLI_EXECUTABLE_PATH",
    ),
    BITBUCKET_CLI_TIMEOUT_MS: Joi.number().integer().positive().default(30000),
    BITBUCKET_CLI_MAX_JSON_OUTPUT_BYTES: Joi.number()
      .integer()
      .positive()
      .default(1048576),
    AZURE_DEVOPS_CLI_EXECUTABLE_PATH: cliExecutablePathSchema(
      "AZURE_DEVOPS_CLI_EXECUTABLE_PATH",
    ),
    AZURE_DEVOPS_CLI_TIMEOUT_MS: Joi.number()
      .integer()
      .positive()
      .default(30000),
    AZURE_DEVOPS_CLI_MAX_JSON_OUTPUT_BYTES: Joi.number()
      .integer()
      .positive()
      .default(1048576),
    GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION: Joi.string().trim().required(),
    GITHUB_CLI_CREDENTIAL_KEK_KEYRING: Joi.string().trim().required(),
    RABBITMQ_URL: Joi.string()
      .trim()
      .pattern(/^amqps?:\/\//)
      .required()
      .messages({
        "string.pattern.base":
          '"RABBITMQ_URL" must be a valid amqp:// or amqps:// URI',
      }),
    RABBITMQ_EXCHANGE: Joi.string().default("lcsp.events"),
    OUTBOX_POLL_INTERVAL_MS: Joi.number().integer().positive().default(1000),
    OUTBOX_BATCH_SIZE: Joi.number().integer().positive().default(50),
    OUTBOX_MAX_ATTEMPTS: Joi.number().integer().positive().default(5),
    OUTBOX_BROKER_CONNECT_TIMEOUT_MS: Joi.number()
      .integer()
      .positive()
      .default(5000),
    OUTBOX_BROKER_PUBLISH_TIMEOUT_MS: Joi.number()
      .integer()
      .positive()
      .default(5000),
    SEPAY_WEBHOOK_SECRET: Joi.alternatives().conditional("NODE_ENV", {
      is: NODE_ENVS.production,
      then: Joi.string().min(16).required(),
      otherwise: Joi.string().min(16).allow("").default(""),
    }),
    SEPAY_WEBHOOK_TIMESTAMP_SKEW_SECONDS: Joi.number()
      .integer()
      .positive()
      .default(300),
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
    LCSP_AGENT_SERVER_URL: Joi.alternatives().conditional("NODE_ENV", {
      is: NODE_ENVS.production,
      then: Joi.string()
        .uri({ scheme: ["http", "https"] })
        .required(),
      otherwise: Joi.string()
        .uri({ scheme: ["http", "https"] })
        .optional(),
    }),
    ORCHESTRATION_DEBUG: Joi.boolean().default(false),
    BILLING_SEPAY_BANK_NAME: Joi.alternatives().conditional("NODE_ENV", {
      is: NODE_ENVS.production,
      then: Joi.string().trim().min(1).required(),
      otherwise: Joi.string().trim().allow("").default(""),
    }),
    BILLING_ADMISSION_MASTER_KEY: Joi.string().trim().allow("").default(""),
    BILLING_SEPAY_BANK_ACCOUNT_NUMBER: Joi.alternatives().conditional(
      "NODE_ENV",
      {
        is: NODE_ENVS.production,
        then: Joi.string()
          .trim()
          .pattern(/^[A-Za-z0-9-]+$/)
          .min(4)
          .max(34)
          .required(),
        otherwise: Joi.string()
          .trim()
          .allow("")
          .pattern(/^[A-Za-z0-9-]*$/)
          .max(34)
          .default(""),
      },
    ),
    BILLING_SEPAY_ACCOUNT_HOLDER: Joi.alternatives().conditional("NODE_ENV", {
      is: NODE_ENVS.production,
      then: Joi.string().trim().min(1).required(),
      otherwise: Joi.string().trim().allow("").default(""),
    }),
    BILLING_SEPAY_QR_URL_TEMPLATE: Joi.alternatives().conditional("NODE_ENV", {
      is: NODE_ENVS.production,
      then: paymentQrTemplateSchema().min(1).required(),
      otherwise: paymentQrTemplateSchema().allow("").default(""),
    }),
    // Why: Dedicated background sweeper recovers abandoned in-flight model leases.
    // How: Validate enabled boolean (default true) and positive integer interval (minimum 1000ms, default 60000ms).
    // Invariants: Sweeper timing is fully configurable and validated during boot.
    BILLING_RECONCILIATION_SWEEPER_ENABLED: Joi.boolean().default(true),
    BILLING_RECONCILIATION_SWEEPER_INTERVAL_MS: Joi.number()
      .integer()
      .min(1000)
      .default(60_000),
    LCSP_ARTIFACT_STORAGE_PATH: Joi.string().trim().allow("").default(""),
    LCSP_SNAPSHOT_ARCHIVE_CACHE_DIR: Joi.string().trim().allow("").default(""),
    // Why: WP8 Phase A/A2 keeps live model-usage debiting gated OFF by default while allowing
    // SHADOW calculations and failing closed if ON is configured prematurely.
    // How: Trim and empty-default MODEL_USAGE_DEBIT to OFF; allow only OFF or SHADOW.
    // Invariants: Production cannot boot with MODEL_USAGE_DEBIT=ON in Phase A/A2.
    MODEL_USAGE_DEBIT: Joi.string()
      .trim()
      .empty("")
      .valid(MODEL_USAGE_DEBIT_MODES.OFF, MODEL_USAGE_DEBIT_MODES.SHADOW)
      .default(MODEL_USAGE_DEBIT_MODES.OFF)
      .messages({
        "any.only":
          '"MODEL_USAGE_DEBIT" must be OFF or SHADOW (ON is blocked until WP8 enablement gates are closed)',
      }),
  })
    .unknown(true)
    .custom((env: Record<string, unknown>, helpers) => {
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
        "Repository credential storage requires an active KEK version",
      "credentialKek.keyring":
        "Repository credential storage requires a valid 32-byte base64 KEK keyring containing the active version",
      "string.paymentQrTemplate":
        '"BILLING_SEPAY_QR_URL_TEMPLATE" must include {amountVnd} and {paymentCode} placeholders',
    });
}

export const configValidationSchema = createConfigValidationSchema();

function cliExecutablePathSchema(variableName: string) {
  // Rationale: Preservation of relative CLI paths is validated at runtime rather than Joi schema time.
  return Joi.string()
    .trim()
    .allow("")
    .default("")
    .description(
      `${variableName} accepts an absolute path or a path relative to the LCSP workspace root`,
    );
}

function resolveCliExecutablePath(value: string | undefined): string {
  return value?.trim() ?? "";
}

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
 * Deduplicates origin entries to avoid redundant checking in CORS middleware.
 *
 * @param value - Comma-separated redirect URL string.
 * @returns Unique origins extracted from valid URL entries.
 */
function parseRedirectOrigins(value: string): string[] {
  const origins = parseRedirectUris(value).flatMap((entry) => {
    try {
      return [new URL(entry).origin];
    } catch {
      return [];
    }
  });
  return Array.from(new Set(origins));
}

/**
 * Parses positive integers safely without coercing empty strings or whitespace to 0.
 *
 * Rationale: Prevents the JavaScript pitfall where Number("") evaluates to 0, which breaks timeout defaults.
 * Mechanism: Validates that the input is a non-empty string or finite number > 0; falls back to default if invalid.
 * Invariants: Always returns a positive integer >= 0.
 *
 * @param value - Environment string or number to parse.
 * @param defaultValue - Fallback integer when value is undefined, empty, or invalid.
 * @returns Validated positive integer.
 */
function parsePositiveInteger(
  value: string | number | undefined,
  defaultValue: number,
): number {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0
      ? Math.floor(value)
      : defaultValue;
  }
  const trimmed = String(value).trim();
  if (trimmed.length === 0) {
    return defaultValue;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.floor(parsed)
    : defaultValue;
}

/**
 * Parses boolean environment variables safely, aligning with Joi's boolean coercion rules.
 *
 * Rationale: Ensures flags like "1" or "yes" evaluate to true, identical to Joi schema validation.
 * Mechanism: Evaluates string variants ("true", "1", "yes") to true; ("false", "0", "no") to false.
 * Invariants: Defaults safely to provided defaultValue when unconfigured or unrecognized.
 *
 * @param value - Raw environment value.
 * @param defaultValue - Fallback boolean when value is undefined or blank.
 * @returns Evaluated boolean value.
 */
function parseBoolean(
  value: string | boolean | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const trimmed = String(value).trim().toLowerCase();
  if (trimmed.length === 0) {
    return defaultValue;
  }
  if (trimmed === "true" || trimmed === "1" || trimmed === "yes") {
    return true;
  }
  if (trimmed === "false" || trimmed === "0" || trimmed === "no") {
    return false;
  }
  return defaultValue;
}

/**
 * Parses WP8 MODEL_USAGE_DEBIT rollout mode and fails closed on ON or invalid strings.
 *
 * Why: Direct config() callers (including unit tests and non-Joi harnesses) must enforce
 * the same Phase A/A2 MODEL_USAGE_DEBIT = OFF gate as Joi schema validation.
 * How: Trims input, defaults unset/blank values to OFF, accepts OFF or SHADOW, and throws on ON/unknown values.
 * Invariants: Never returns MODEL_USAGE_DEBIT_MODES.ON in Phase A/A2.
 */
function parseModelUsageDebitMode(
  value: string | undefined,
): ModelUsageDebitMode {
  if (value === undefined) {
    return MODEL_USAGE_DEBIT_MODES.OFF;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return MODEL_USAGE_DEBIT_MODES.OFF;
  }
  if (
    trimmed === MODEL_USAGE_DEBIT_MODES.OFF ||
    trimmed === MODEL_USAGE_DEBIT_MODES.SHADOW
  ) {
    return trimmed;
  }
  throw new Error(
    '"MODEL_USAGE_DEBIT" must be OFF or SHADOW (ON is blocked until WP8 enablement gates are closed)',
  );
}

/**
 * Business purpose:
 * Builds the typed application configuration object from validated process environment variables.
 *
 * Business rules:
 * 1. Default to development when NODE_ENV is unset.
 * 2. Sanitize and trim all string-based credentials and endpoints.
 * 3. Deduplicate CORS origins and fall back to OAuth redirect origins when CORS origins are unconfigured.
 * 4. Parse numeric timeouts and intervals defensively to prevent 0-value bugs from empty strings.
 * 5. Synchronize boolean flags with Joi schema coercion.
 * 6. Centralize all infrastructure and runtime credentials to prevent unvalidated process.env reads across modules.
 *
 * Execution flow:
 * 1. Read environment variables from process.env.
 * 2. Parse and normalize network, OAuth, CLI, messaging, payment, and security configurations.
 * 3. Return immutable-ready AppConfig contract.
 *
 * Failure cases:
 * - Falls back to safe defaults when optional environment variables are missing or empty.
 *
 * Side effects:
 * - Pure mapping function reading process.env; no external side effects.
 *
 * @returns Runtime configuration grouped by infrastructure and application concern.
 */
export function config(): AppConfig {
  const env = process.env;

  return {
    nodeEnv: (env.NODE_ENV as NodeEnv | undefined) ?? NODE_ENVS.development,
    port: parsePositiveInteger(env.PORT, 3000),
    agentServerUrl: env.LCSP_AGENT_SERVER_URL?.trim() ?? "",
    database: {
      url: env.DATABASE_URL ?? "",
    },
    oauth: {
      googleClientId: env.OAUTH_GOOGLE_CLIENT_ID ?? "",
      googleClientSecret: env.OAUTH_GOOGLE_CLIENT_SECRET ?? "",
      allowedRedirectOrigins: parseRedirectOrigins(
        env.OAUTH_ALLOWED_REDIRECT_ORIGINS ?? "",
      ),
    },
    cors: {
      allowedOrigins: parseRedirectOrigins(
        env.CORS_ALLOWED_ORIGINS || env.OAUTH_ALLOWED_REDIRECT_ORIGINS || "",
      ),
    },
    githubCli: {
      executablePath: resolveCliExecutablePath(env.GITHUB_CLI_EXECUTABLE_PATH),
      metadataTimeoutMs: parsePositiveInteger(
        env.GITHUB_CLI_METADATA_TIMEOUT_MS,
        15000,
      ),
      discoveryTimeoutMs: parsePositiveInteger(
        env.GITHUB_CLI_DISCOVERY_TIMEOUT_MS,
        30000,
      ),
      archiveTimeoutMs: parsePositiveInteger(
        env.GITHUB_CLI_ARCHIVE_TIMEOUT_MS,
        120000,
      ),
      maxJsonOutputBytes: parsePositiveInteger(
        env.GITHUB_CLI_MAX_JSON_OUTPUT_BYTES,
        1048576,
      ),
      maxDiscoveryOutputBytes: parsePositiveInteger(
        env.GITHUB_CLI_MAX_DISCOVERY_OUTPUT_BYTES,
        10485760,
      ),
      maxStderrBytes: parsePositiveInteger(
        env.GITHUB_CLI_MAX_STDERR_BYTES,
        8192,
      ),
      maxArchiveBytes: parsePositiveInteger(
        env.GITHUB_CLI_MAX_ARCHIVE_BYTES,
        104857600,
      ),
      maxConcurrentMetadataProcesses: parsePositiveInteger(
        env.GITHUB_CLI_MAX_CONCURRENT_METADATA_PROCESSES,
        8,
      ),
      maxConcurrentArchiveProcesses: parsePositiveInteger(
        env.GITHUB_CLI_MAX_CONCURRENT_ARCHIVE_PROCESSES,
        2,
      ),
    },
    gitlabCli: {
      executablePath: resolveCliExecutablePath(env.GITLAB_CLI_EXECUTABLE_PATH),
      timeoutMs: parsePositiveInteger(env.GITLAB_CLI_TIMEOUT_MS, 30000),
      maxJsonOutputBytes: parsePositiveInteger(
        env.GITLAB_CLI_MAX_JSON_OUTPUT_BYTES,
        1048576,
      ),
    },
    bitbucketCli: {
      executablePath: resolveCliExecutablePath(
        env.BITBUCKET_CLI_EXECUTABLE_PATH,
      ),
      timeoutMs: parsePositiveInteger(env.BITBUCKET_CLI_TIMEOUT_MS, 30000),
      maxJsonOutputBytes: parsePositiveInteger(
        env.BITBUCKET_CLI_MAX_JSON_OUTPUT_BYTES,
        1048576,
      ),
    },
    azureDevOpsCli: {
      executablePath: resolveCliExecutablePath(
        env.AZURE_DEVOPS_CLI_EXECUTABLE_PATH,
      ),
      timeoutMs: parsePositiveInteger(env.AZURE_DEVOPS_CLI_TIMEOUT_MS, 30000),
      maxJsonOutputBytes: parsePositiveInteger(
        env.AZURE_DEVOPS_CLI_MAX_JSON_OUTPUT_BYTES,
        1048576,
      ),
    },
    githubCredentialPersistence: {
      activeKekVersion:
        env.GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION?.trim() ?? "",
      encodedKekKeyring: env.GITHUB_CLI_CREDENTIAL_KEK_KEYRING ?? "{}",
    },
    rabbitmq: {
      url: env.RABBITMQ_URL ?? "",
      exchange: env.RABBITMQ_EXCHANGE ?? "lcsp.events",
    },
    outbox: {
      pollIntervalMs: parsePositiveInteger(env.OUTBOX_POLL_INTERVAL_MS, 1000),
      batchSize: parsePositiveInteger(env.OUTBOX_BATCH_SIZE, 50),
      maxAttempts: parsePositiveInteger(env.OUTBOX_MAX_ATTEMPTS, 5),
      brokerConnectTimeoutMs: parsePositiveInteger(
        env.OUTBOX_BROKER_CONNECT_TIMEOUT_MS,
        5000,
      ),
      brokerPublishTimeoutMs: parsePositiveInteger(
        env.OUTBOX_BROKER_PUBLISH_TIMEOUT_MS,
        5000,
      ),
    },
    sepay: {
      webhookSecret: env.SEPAY_WEBHOOK_SECRET ?? "",
      timestampSkewSeconds: parsePositiveInteger(
        env.SEPAY_WEBHOOK_TIMESTAMP_SKEW_SECONDS,
        300,
      ),
    },
    worker: {
      apiKey: env.WORKER_API_KEY ?? "",
    },
    email: {
      smtpHost: env.SMTP_HOST?.trim() ?? "",
      smtpPort: parsePositiveInteger(env.SMTP_PORT, 587),
      smtpSecure: parseBoolean(env.SMTP_SECURE, false),
      smtpUser: env.SMTP_USER?.trim() ?? "",
      smtpPass: env.SMTP_PASS?.trim() ?? "",
      smtpFrom: env.SMTP_FROM?.trim() ?? "",
    },
    orchestration: {
      debug: parseBoolean(env.ORCHESTRATION_DEBUG, false),
    },
    billing: {
      sePayBankName: env.BILLING_SEPAY_BANK_NAME?.trim() ?? "",
      sePayBankAccountNumber:
        env.BILLING_SEPAY_BANK_ACCOUNT_NUMBER?.trim() ?? "",
      sePayAccountHolder: env.BILLING_SEPAY_ACCOUNT_HOLDER?.trim() ?? "",
      sePayQrUrlTemplate: env.BILLING_SEPAY_QR_URL_TEMPLATE?.trim() ?? "",
      admissionMasterKey: env.BILLING_ADMISSION_MASTER_KEY?.trim() ?? "",
      reconciliationSweeper: {
        enabled: parseBoolean(env.BILLING_RECONCILIATION_SWEEPER_ENABLED, true),
        intervalMs:
          parseInt(
            String(env.BILLING_RECONCILIATION_SWEEPER_INTERVAL_MS ?? "60000"),
            10,
          ) || 60_000,
      },
    },
    modelUsageDebit: {
      mode: parseModelUsageDebitMode(env.MODEL_USAGE_DEBIT),
    },
    mfa: {
      secretEncryptionKey: env.MFA_SECRET_ENCRYPTION_KEY?.trim() ?? "",
    },
    storage: {
      artifactStoragePath: env.LCSP_ARTIFACT_STORAGE_PATH?.trim() ?? "",
      snapshotArchiveCacheDir:
        env.LCSP_SNAPSHOT_ARCHIVE_CACHE_DIR?.trim() ?? "",
    },
  };
}
