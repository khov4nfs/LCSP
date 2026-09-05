import { config, configValidationSchema } from "./config.js";
import { resolve } from "node:path";

const VALID_ENV = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/lcsp",
  AUTH_BCRYPT_COST: "12",
  AUTH_SESSION_TTL_SECONDS: "86400",
  JWT_SECRET: "a".repeat(32),
  OAUTH_GOOGLE_CLIENT_ID: "google-client-id",
  OAUTH_GOOGLE_CLIENT_SECRET: "google-client-secret",
  OAUTH_ALLOWED_REDIRECT_ORIGINS: "http://localhost:3000",
  OAUTH_ALLOWED_REDIRECT_URIS: "http://localhost:3000/callback",
  GITHUB_APP_SLUG: "lcsp-app",
  GITHUB_APP_ID: "123456",
  GITHUB_APP_PRIVATE_KEY: "test-private-key",
  GITHUB_APP_ALLOWED_REDIRECT_URIS:
    "http://localhost:3000/api/github/app/callback",
  GITHUB_APP_CLIENT_ID: "gh-app-client-id",
  GITHUB_APP_CLIENT_SECRET: "gh-app-client-secret",
  GITHUB_CLI_EXECUTABLE_PATH: resolve("tools", "gh"),
  RABBITMQ_URL: "amqp://guest:guest@localhost:5672",
  RABBITMQ_EXCHANGE: "lcsp.events",
  OUTBOX_ENABLED: "true",
  OUTBOX_POLL_INTERVAL_MS: "1000",
  OUTBOX_BATCH_SIZE: "50",
  OUTBOX_MAX_ATTEMPTS: "5",
  MFA_SECRET_ENCRYPTION_KEY: "0123456789abcdef".repeat(4),
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "587",
  SMTP_SECURE: "false",
  SMTP_USER: "smtp-user",
  SMTP_PASS: "smtp-pass",
  SMTP_FROM: "lcsp@example.com",
  WORKER_API_KEY: "w".repeat(32),
  INTERVIEW_GUIDANCE_VERSION: "interview-context-test-v1",
};

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

  it("T03: fails when JWT_SECRET is missing", () => {
    const { error } = validate(withoutKeys(VALID_ENV, ["JWT_SECRET"]));

    expect(error?.message).toContain("JWT_SECRET");
  });

  it("lists every missing required key in a single error (not just the first)", () => {
    const { error } = validate(
      withoutKeys(VALID_ENV, ["DATABASE_URL", "JWT_SECRET"]),
    );

    expect(error?.message).toContain("DATABASE_URL");
    expect(error?.message).toContain("JWT_SECRET");
  });

  it("T04: fails when MFA_SECRET_ENCRYPTION_KEY is the wrong length", () => {
    const { error } = validate({
      ...VALID_ENV,
      MFA_SECRET_ENCRYPTION_KEY: "too-short",
    });

    expect(error?.message).toContain("MFA_SECRET_ENCRYPTION_KEY");
  });

  it("T05: fails when AUTH_BCRYPT_COST is below 10", () => {
    const { error } = validate({ ...VALID_ENV, AUTH_BCRYPT_COST: "9" });

    expect(error?.message).toContain("AUTH_BCRYPT_COST");
  });

  it("rejects a relative GitHub CLI executable path", () => {
    const result = validate({
      ...VALID_ENV,
      GITHUB_CLI_EXECUTABLE_PATH: "tools/gh",
    });

    expect(result.error?.message).toContain("GITHUB_CLI_EXECUTABLE_PATH");
  });

  it("allows App-only startup without credential KEK configuration", () => {
    const result = validate({
      ...VALID_ENV,
      NODE_ENV: "production",
      GITHUB_CLI_CREDENTIAL_PERSISTENCE_ENABLED: "false",
    });
    expect(result.error).toBeUndefined();
  });

  it("fails closed when credential persistence lacks a valid KEK keyring", () => {
    const recognizableKey = "recognizable-invalid-kek";
    const result = validate({
      ...VALID_ENV,
      NODE_ENV: "production",
      GITHUB_CLI_CREDENTIAL_PERSISTENCE_ENABLED: "true",
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
      GITHUB_CLI_CREDENTIAL_PERSISTENCE_ENABLED: "true",
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
      GITHUB_CLI_CREDENTIAL_PERSISTENCE_ENABLED: "true",
      GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION: "kek-v2",
      GITHUB_CLI_CREDENTIAL_KEK_KEYRING: JSON.stringify({
        "kek-v1": Buffer.alloc(32, 1).toString("base64"),
        "kek-v2": Buffer.alloc(32, 2).toString("base64"),
      }),
    });
    expect(result.error).toBeUndefined();
  });

  it("rejects CLI snapshot pinning when credential persistence is disabled", () => {
    const result = validate({
      ...VALID_ENV,
      GITHUB_CLI_CREDENTIAL_PERSISTENCE_ENABLED: "false",
      GITHUB_CLI_SNAPSHOT_PINNING_ENABLED: "true",
    });
    expect(result.error?.message).toContain(
      "snapshot pinning requires credential persistence",
    );
  });

  it("rejects CLI archive retrieval unless persistence and snapshot pinning are enabled", () => {
    const result = validate({
      ...VALID_ENV,
      GITHUB_CLI_ARCHIVE_RETRIEVAL_ENABLED: "true",
    });
    expect(result.error?.message).toContain(
      "archive retrieval requires credential persistence and snapshot pinning",
    );
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

  it("T06: parses OAUTH_ALLOWED_REDIRECT_URIS into a string array", () => {
    process.env.OAUTH_ALLOWED_REDIRECT_URIS = "a,b,c";

    expect(config().oauth.allowedRedirectUris).toEqual(["a", "b", "c"]);
  });

  it("trims whitespace and drops empty entries from redirect URIs", () => {
    process.env.OAUTH_ALLOWED_REDIRECT_URIS = " a , b ,,c ";

    expect(config().oauth.allowedRedirectUris).toEqual(["a", "b", "c"]);
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
      auth: {
        bcryptCost: 12,
        sessionTtlSeconds: 86400,
        jwtSecret: VALID_ENV.JWT_SECRET,
      },
      oauth: {
        googleClientId: VALID_ENV.OAUTH_GOOGLE_CLIENT_ID,
        googleClientSecret: VALID_ENV.OAUTH_GOOGLE_CLIENT_SECRET,
        allowedRedirectOrigins: [VALID_ENV.OAUTH_ALLOWED_REDIRECT_ORIGINS],
        allowedRedirectUris: [VALID_ENV.OAUTH_ALLOWED_REDIRECT_URIS],
      },
      github: {
        appId: VALID_ENV.GITHUB_APP_ID,
        appSlug: VALID_ENV.GITHUB_APP_SLUG,
        allowedRedirectUris: [VALID_ENV.GITHUB_APP_ALLOWED_REDIRECT_URIS],
        clientId: VALID_ENV.GITHUB_APP_CLIENT_ID,
        clientSecret: VALID_ENV.GITHUB_APP_CLIENT_SECRET,
        privateKey: VALID_ENV.GITHUB_APP_PRIVATE_KEY,
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
        enabled: false,
      },
      bitbucketCli: {
        executablePath: "",
        timeoutMs: 30000,
        maxJsonOutputBytes: 1048576,
        enabled: false,
      },
      azureDevOpsCli: {
        executablePath: "",
        timeoutMs: 30000,
        maxJsonOutputBytes: 1048576,
        enabled: false,
      },
      rabbitmq: {
        url: VALID_ENV.RABBITMQ_URL,
        exchange: VALID_ENV.RABBITMQ_EXCHANGE,
      },
      outbox: {
        enabled: true,
        pollIntervalMs: 1000,
        batchSize: 50,
        maxAttempts: 5,
      },
      crypto: { mfaSecretEncryptionKey: VALID_ENV.MFA_SECRET_ENCRYPTION_KEY },
      githubCredentialPersistence: {
        enabled: false,
        snapshotPinningEnabled: false,
        archiveRetrievalEnabled: false,
        activeKekVersion: "",
        encodedKekKeyring: "{}",
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
      internal: { apiToken: "test-internal-token" },
      orchestration: { debug: false },
      verifiedEpisodes: {
        consolidationIntervalMs: 0,
      },
      interview: {
        guidanceVersion: "interview-context-test-v1",
      },
    });
  });

  it("T07: fails when WORKER_API_KEY is missing", () => {
    const { error } = validate(withoutKeys(VALID_ENV, ["WORKER_API_KEY"]));

    expect(error?.message).toContain("WORKER_API_KEY");
  });
});
