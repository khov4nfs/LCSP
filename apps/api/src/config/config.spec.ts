import { resolve } from "node:path";
import { config, createConfigValidationSchema } from "./config.js";

const VALIDATION_WORKSPACE_ROOT = resolve("test-workspace");
const configValidationSchema = createConfigValidationSchema(
  VALIDATION_WORKSPACE_ROOT,
);

const VALID_ENV = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/lcsp",
  OAUTH_GOOGLE_CLIENT_ID: "google-client-id",
  OAUTH_GOOGLE_CLIENT_SECRET: "google-client-secret",
  OAUTH_ALLOWED_REDIRECT_ORIGINS: "http://localhost:3000",
  GITHUB_CLI_EXECUTABLE_PATH: resolve("tools", "gh"),
  RABBITMQ_URL: "amqp://guest:guest@localhost:5672",
  RABBITMQ_EXCHANGE: "lcsp.events",
  SEPAY_WEBHOOK_SECRET: "s".repeat(32),
  OUTBOX_POLL_INTERVAL_MS: "1000",
  OUTBOX_BATCH_SIZE: "50",
  OUTBOX_MAX_ATTEMPTS: "5",
  MFA_SECRET_ENCRYPTION_KEY: "0123456789abcdef".repeat(4),
  GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION: "kek-v1",
  GITHUB_CLI_CREDENTIAL_KEK_KEYRING: JSON.stringify({
    "kek-v1": Buffer.alloc(32, 1).toString("base64"),
  }),
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "587",
  SMTP_SECURE: "false",
  SMTP_USER: "smtp-user",
  SMTP_PASS: "smtp-pass",
  SMTP_FROM: "lcsp@example.com",
  WORKER_API_KEY: "w".repeat(32),
  BILLING_SEPAY_BANK_NAME: "Test Bank",
  BILLING_SEPAY_BANK_ACCOUNT_NUMBER: "1234567890",
  BILLING_SEPAY_ACCOUNT_HOLDER: "LCSP TEST",
  BILLING_SEPAY_QR_URL_TEMPLATE:
    "https://payments.test/qr?amount={amountVnd}&content={paymentCode}",
};

const PUBLIC_BILLING_KEYS = [
  "BILLING_SEPAY_BANK_NAME",
  "BILLING_SEPAY_BANK_ACCOUNT_NUMBER",
  "BILLING_SEPAY_ACCOUNT_HOLDER",
  "BILLING_SEPAY_QR_URL_TEMPLATE",
] as const;

function validate(env: Record<string, string | undefined>) {
  return configValidationSchema.validate(env, {
    abortEarly: false,
    allowUnknown: true,
  });
}

function withoutKeys(
  env: Record<string, string | undefined>,
  keys: string[],
): Record<string, string | undefined> {
  const result = { ...env };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}

describe("configValidationSchema", () => {
  it("T01: passes when all required vars are set", () => {
    const { error } = validate(VALID_ENV);

    expect(error).toBeUndefined();
  });

  it("T02: fails with a descriptive error when DATABASE_URL is missing", () => {
    const { error } = validate(withoutKeys(VALID_ENV, ["DATABASE_URL"]));

    expect(error?.message).toContain("DATABASE_URL");
  });

  it("T03: validates without the removed dead/flag keys", () => {
    const { error } = validate({
      ...withoutKeys(VALID_ENV, [
        "OUTBOX_ENABLED",
        "GITHUB_CLI_CREDENTIAL_PERSISTENCE_ENABLED",
        "GITHUB_CLI_SNAPSHOT_PINNING_ENABLED",
        "GITHUB_CLI_ARCHIVE_RETRIEVAL_ENABLED",
        "GITLAB_PROVIDER_ENABLED",
        "BITBUCKET_PROVIDER_ENABLED",
        "AZURE_DEVOPS_PROVIDER_ENABLED",
        "BILLING_METERING_ENABLED",
        "JWT_SECRET",
        "AUTH_BCRYPT_COST",
        "AUTH_SESSION_TTL_SECONDS",
        "OAUTH_ALLOWED_REDIRECT_URIS",
        "INTERVIEW_GUIDANCE_VERSION",
        "REPOSITORY_SCAN_STALE_AFTER_MS",
        "MFA_ENCRYPTION_KEY",
      ]),
    });

    expect(error).toBeUndefined();
  });

  it("lists every missing required key in a single error (not just the first)", () => {
    const { error } = validate(
      withoutKeys(VALID_ENV, ["DATABASE_URL", "WORKER_API_KEY"]),
    );

    expect(error?.message).toContain("DATABASE_URL");
    expect(error?.message).toContain("WORKER_API_KEY");
  });

  it("T04: fails when MFA_SECRET_ENCRYPTION_KEY is the wrong length", () => {
    const { error } = validate({
      ...VALID_ENV,
      MFA_SECRET_ENCRYPTION_KEY: "too-short",
    });

    expect(error?.message).toContain("MFA_SECRET_ENCRYPTION_KEY");
  });

  it("T05: ORCHESTRATION_DEBUG is off by default and opt-in", () => {
    const previous = process.env.ORCHESTRATION_DEBUG;
    try {
      delete process.env.ORCHESTRATION_DEBUG;
      expect(config().orchestration.debug).toBe(false);
      process.env.ORCHESTRATION_DEBUG = "true";
      expect(config().orchestration.debug).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.ORCHESTRATION_DEBUG;
      else process.env.ORCHESTRATION_DEBUG = previous;
    }
  });

  it("preserves relative CLI executable paths from env config", () => {
    const result = validate({
      ...VALID_ENV,
      GITHUB_CLI_EXECUTABLE_PATH: "./tools/gh",
      GITLAB_CLI_EXECUTABLE_PATH: "./.cache/lcsp-cli/gitlab-cli/bin/glab",
      BITBUCKET_CLI_EXECUTABLE_PATH: "./.cache/lcsp-cli/bitbucket-cli/bin/bb",
    });

    expect(result.error).toBeUndefined();
    const validated = result.value as Record<string, unknown>;
    expect(validated["GITHUB_CLI_EXECUTABLE_PATH"]).toBe("./tools/gh");
    expect(validated["GITLAB_CLI_EXECUTABLE_PATH"]).toBe(
      "./.cache/lcsp-cli/gitlab-cli/bin/glab",
    );
    expect(validated["BITBUCKET_CLI_EXECUTABLE_PATH"]).toBe(
      "./.cache/lcsp-cli/bitbucket-cli/bin/bb",
    );
  });

  it.each(PUBLIC_BILLING_KEYS)(
    "rejects a missing %s value in production",
    (key) => {
      const result = validate(
        withoutKeys({ ...VALID_ENV, NODE_ENV: "production" }, [key]),
      );
      expect(result.error?.message).toContain(key);
    },
  );

  it("allows payment configuration to be absent outside production", () => {
    const result = validate(
      withoutKeys({ ...VALID_ENV, NODE_ENV: "test" }, [...PUBLIC_BILLING_KEYS]),
    );
    expect(result.error).toBeUndefined();
  });

  it.each(PUBLIC_BILLING_KEYS)(
    "rejects a blank %s value in production",
    (key) => {
      const result = validate({
        ...VALID_ENV,
        NODE_ENV: "production",
        [key]: "",
      });
      expect(result.error?.message).toContain(key);
    },
  );

  it("fails closed when credential persistence lacks a valid KEK keyring", () => {
    const recognizableKey = "recognizable-invalid-kek";
    const result = validate({
      ...VALID_ENV,
      NODE_ENV: "production",
      GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION: "kek-v1",
      GITHUB_CLI_CREDENTIAL_KEK_KEYRING: recognizableKey,
    });
    expect(result.error?.message).toContain("valid 32-byte base64 KEK keyring");
    expect(result.error?.message).not.toContain(recognizableKey);
  });

  it("allows credential persistence without an explicit CLI executable path", () => {
    const result = validate({
      ...VALID_ENV,
      GITHUB_CLI_EXECUTABLE_PATH: "",
      GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION: "kek-v1",
      GITHUB_CLI_CREDENTIAL_KEK_KEYRING: JSON.stringify({
        "kek-v1": Buffer.alloc(32, 1).toString("base64"),
      }),
    });

    expect(result.error).toBeUndefined();
  });

  it("accepts a versioned 32-byte keyring when persistence is enabled", () => {
    const result = validate({
      ...VALID_ENV,
      GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION: "kek-v2",
      GITHUB_CLI_CREDENTIAL_KEK_KEYRING: JSON.stringify({
        "kek-v1": Buffer.alloc(32, 1).toString("base64"),
        "kek-v2": Buffer.alloc(32, 2).toString("base64"),
      }),
    });
    expect(result.error).toBeUndefined();
  });

  it("requires the credential KEK (credential storage is always on)", () => {
    const result = validate(
      withoutKeys(VALID_ENV, [
        "GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION",
        "GITHUB_CLI_CREDENTIAL_KEK_KEYRING",
      ]),
    );
    expect(result.error?.message).toContain(
      "GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION",
    );
  });

  it("boots in production without any model-billing envs", () => {
    const result = validate({ ...VALID_ENV, NODE_ENV: "production" });
    expect(result.error?.message ?? "").not.toMatch(
      /BILLING_(METERING|RESERVATION|MAX_)/,
    );
  });

  it("does not require, default or expose removed model-billing envs", () => {
    const result = validate(VALID_ENV);
    expect(result.error).toBeUndefined();
    for (const removed of [
      "BILLING_METERING_ENABLED",
      "BILLING_RESERVATION_CREDITS",
      "BILLING_MAX_INVOCATION_CHARGE_CREDITS",
      "BILLING_MAX_INPUT_TOKENS",
      "BILLING_MAX_INPUT_BYTES",
      "BILLING_MAX_OUTPUT_TOKENS",
      "BILLING_MAX_REASONING_TOKENS",
      "BILLING_MAX_INVOCATIONS_PER_GROUP",
    ])
      expect(result.value).not.toHaveProperty(removed);
  });

  it("keeps only customer-payment keys in the billing config", () => {
    const previous = process.env;
    process.env = { ...VALID_ENV };
    try {
      expect(Object.keys(config().billing).sort()).toEqual([
        "sePayAccountHolder",
        "sePayBankAccountNumber",
        "sePayBankName",
        "sePayQrUrlTemplate",
      ]);
    } finally {
      process.env = previous;
    }
  });

  it("allows SMTP_FROM to be blank or whitespace when SMTP is disabled", () => {
    const blank = validate({ ...VALID_ENV, SMTP_FROM: "" });
    const whitespace = validate({ ...VALID_ENV, SMTP_FROM: "   " });

    expect(blank.error).toBeUndefined();
    expect(whitespace.error).toBeUndefined();
  });

  it('allows SMTP_FROM in display-name format like "LCSP <noreply@lcsp.com>"', () => {
    const result = validate({
      ...VALID_ENV,
      SMTP_FROM: "LCSP <noreply@lcsp.com>",
    });

    expect(result.error).toBeUndefined();
  });

  it("rejects malformed SMTP_FROM display-name values", () => {
    const result = validate({
      ...VALID_ENV,
      SMTP_FROM: "LCSP <noreply>@lcsp.com>",
    });

    expect(result.error?.message).toContain("SMTP_FROM");
  });

  it("allows SMTP_HOST, SMTP_USER, and SMTP_PASS to be blank or whitespace", () => {
    const result = validate({
      ...VALID_ENV,
      SMTP_HOST: "   ",
      SMTP_USER: "   ",
      SMTP_PASS: "   ",
    });

    expect(result.error).toBeUndefined();
  });
});

describe("config()", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, ...VALID_ENV };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("preserves relative CLI paths in the typed runtime config", () => {
    process.env.GITHUB_CLI_EXECUTABLE_PATH =
      "./.cache/lcsp-cli/github-cli/2.98.0/bin/gh";
    process.env.GITLAB_CLI_EXECUTABLE_PATH =
      "./.cache/lcsp-cli/gitlab-cli/1.113.0/bin/glab";
    process.env.BITBUCKET_CLI_EXECUTABLE_PATH =
      "./.cache/lcsp-cli/bitbucket-cli/0.1.0/bin/bb";

    const result = config();

    expect(result.githubCli.executablePath).toBe(
      "./.cache/lcsp-cli/github-cli/2.98.0/bin/gh",
    );
    expect(result.gitlabCli.executablePath).toBe(
      "./.cache/lcsp-cli/gitlab-cli/1.113.0/bin/glab",
    );
    expect(result.bitbucketCli.executablePath).toBe(
      "./.cache/lcsp-cli/bitbucket-cli/0.1.0/bin/bb",
    );
  });

  it("T06: parses OAUTH_ALLOWED_REDIRECT_ORIGINS into origins", () => {
    process.env.OAUTH_ALLOWED_REDIRECT_ORIGINS =
      " http://a.test/cb , http://b.test ,,";

    expect(config().oauth.allowedRedirectOrigins).toEqual([
      "http://a.test",
      "http://b.test",
    ]);
  });

  it("trims SMTP string values in config output", () => {
    process.env.SMTP_HOST = " smtp.example.test ";
    process.env.SMTP_USER = " smtp-user ";
    process.env.SMTP_PASS = " smtp-pass ";
    process.env.SMTP_FROM = " lcsp@example.com ";

    expect(config().email).toEqual({
      smtpHost: "smtp.example.test",
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: "smtp-user",
      smtpPass: "smtp-pass",
      smtpFrom: "lcsp@example.com",
    });
  });

  it("maps every env var to its typed config group", () => {
    const result = config();

    expect(result).toEqual({
      nodeEnv: "test",
      database: { url: VALID_ENV.DATABASE_URL },
      oauth: {
        googleClientId: VALID_ENV.OAUTH_GOOGLE_CLIENT_ID,
        googleClientSecret: VALID_ENV.OAUTH_GOOGLE_CLIENT_SECRET,
        allowedRedirectOrigins: [VALID_ENV.OAUTH_ALLOWED_REDIRECT_ORIGINS],
      },
      githubCli: {
        executablePath: VALID_ENV.GITHUB_CLI_EXECUTABLE_PATH,
        metadataTimeoutMs: 15000,
        discoveryTimeoutMs: 30000,
        archiveTimeoutMs: 120000,
        maxJsonOutputBytes: 1048576,
        maxDiscoveryOutputBytes: 10485760,
        maxStderrBytes: 8192,
        maxArchiveBytes: 104857600,
        maxConcurrentMetadataProcesses: 8,
        maxConcurrentArchiveProcesses: 2,
      },
      gitlabCli: {
        executablePath: "",
        timeoutMs: 30000,
        maxJsonOutputBytes: 1048576,
      },
      bitbucketCli: {
        executablePath: "",
        timeoutMs: 30000,
        maxJsonOutputBytes: 1048576,
      },
      azureDevOpsCli: {
        executablePath: "",
        timeoutMs: 30000,
        maxJsonOutputBytes: 1048576,
      },
      rabbitmq: {
        url: VALID_ENV.RABBITMQ_URL,
        exchange: VALID_ENV.RABBITMQ_EXCHANGE,
      },
      sepay: {
        webhookSecret: VALID_ENV.SEPAY_WEBHOOK_SECRET,
        timestampSkewSeconds: 300,
      },
      outbox: {
        pollIntervalMs: 1000,
        batchSize: 50,
        maxAttempts: 5,
      },
      pipelineReconciliation: {
        pollIntervalMs: 60000,
        quietPeriodMs: 900000,
        maxAttempts: 3,
      },
      githubCredentialPersistence: {
        activeKekVersion: VALID_ENV.GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION,
        encodedKekKeyring: VALID_ENV.GITHUB_CLI_CREDENTIAL_KEK_KEYRING,
      },
      email: {
        smtpHost: VALID_ENV.SMTP_HOST,
        smtpPort: 587,
        smtpSecure: false,
        smtpUser: VALID_ENV.SMTP_USER,
        smtpPass: VALID_ENV.SMTP_PASS,
        smtpFrom: VALID_ENV.SMTP_FROM,
      },
      worker: { apiKey: VALID_ENV.WORKER_API_KEY },
      orchestration: { debug: false },
      verifiedEpisodes: {
        consolidationIntervalMs: 0,
      },
      billing: {
        sePayBankName: "Test Bank",
        sePayBankAccountNumber: "1234567890",
        sePayAccountHolder: "LCSP TEST",
        sePayQrUrlTemplate:
          "https://payments.test/qr?amount={amountVnd}&content={paymentCode}",
      },
    });
  });

  it("T07: fails when WORKER_API_KEY is missing", () => {
    const { error } = validate(withoutKeys(VALID_ENV, ["WORKER_API_KEY"]));

    expect(error?.message).toContain("WORKER_API_KEY");
  });
});
