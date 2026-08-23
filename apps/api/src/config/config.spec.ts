import { config, configValidationSchema } from "./config.js";

const VALID_ENV = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/lcsp",
  AUTH_BCRYPT_COST: "12",
  AUTH_SESSION_TTL_SECONDS: "86400",
  JWT_SECRET: "a".repeat(32),
  OAUTH_GITHUB_CLIENT_ID: "client-id",
  OAUTH_GITHUB_CLIENT_SECRET: "client-secret",
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
        githubClientId: VALID_ENV.OAUTH_GITHUB_CLIENT_ID,
        githubClientSecret: VALID_ENV.OAUTH_GITHUB_CLIENT_SECRET,
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
    });
  });

  it("T07: fails when WORKER_API_KEY is missing", () => {
    const { error } = validate(withoutKeys(VALID_ENV, ["WORKER_API_KEY"]));

    expect(error?.message).toContain("WORKER_API_KEY");
  });
});
