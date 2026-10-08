// Boots the REAL built API against an already-migrated disposable database (the W6 rehearsal DB),
// with the broker deliberately unreachable and the outbox poller effectively off, so nothing is
// published and nothing leaves the machine.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const WORKER_KEY = "w6-rehearsal-worker-key-at-least-32-chars";

export async function startApi({ main, databaseUrl, port, storagePath }) {
  const base = `http://127.0.0.1:${port}`;
  const logs = [];
  const server = spawn(process.execPath, [main], {
    cwd: path.dirname(path.dirname(main)),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      LCSP_ARTIFACT_STORAGE_PATH: storagePath,
      RABBITMQ_URL: "amqp://guest:guest@127.0.0.1:55999",
      RABBITMQ_EXCHANGE: "lcsp.events.w6rehearsal",
      OUTBOX_POLL_INTERVAL_MS: "600000",
      WORKER_API_KEY: WORKER_KEY,
      MFA_SECRET_ENCRYPTION_KEY:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION: "test-kek-v1",
      GITHUB_CLI_CREDENTIAL_KEK_KEYRING: JSON.stringify({
        "test-kek-v1": Buffer.alloc(32, 7).toString("base64"),
      }),
      OAUTH_GOOGLE_CLIENT_ID: "x",
      OAUTH_GOOGLE_CLIENT_SECRET: "x",
      OAUTH_ALLOWED_REDIRECT_ORIGINS: "http://localhost:3000",
      BILLING_SEPAY_BANK_NAME: "T",
      BILLING_SEPAY_BANK_ACCOUNT_NUMBER: "1",
      BILLING_SEPAY_ACCOUNT_HOLDER: "T",
      BILLING_SEPAY_QR_URL_TEMPLATE:
        "https://p.test/qr?amount={amountVnd}&content={paymentCode}",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => logs.push(String(chunk)));
  server.stderr.on("data", (chunk) => logs.push(String(chunk)));
  const stop = async () => {
    if (server.exitCode !== null || server.signalCode !== null) return;
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  };
  for (let attempt = 0; ; attempt += 1) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {
      /* not up yet */
    }
    if (attempt >= 90 || server.exitCode !== null) {
      await stop();
      throw new Error(
        `API did not become healthy:\n${logs.join("").slice(-2500)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  /** Raw HTTP helper: status, headers, body bytes and parsed JSON (when it is JSON). */
  const http = async (method, route, { token, body, headers = {} } = {}) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    let json = null;
    try {
      json = JSON.parse(bytes.toString("utf8"));
    } catch {
      /* binary body */
    }
    return { status: response.status, headers: response.headers, bytes, json };
  };
  const worker = (method, route, body, extra = {}) =>
    http(method, route, {
      body,
      headers: { "x-worker-api-key": WORKER_KEY, ...extra },
    });

  /** Imports a helper from the BUILT API so the harness hashes passwords exactly as the server does. */
  const builtModule = (relative) =>
    import(pathToFileURL(path.join(path.dirname(main), relative)).href);

  /** Gives a seeded user a real password and signs in; returns the bearer session token. */
  const signInAs = async (
    db,
    email,
    password = "CorrectHorseBatteryStaple!",
  ) => {
    const { hashSecret } = await builtModule(
      "platform/security/crypto.utils.js",
    );
    await db.query(
      `UPDATE "User" SET "passwordHash" = $2, "emailVerified" = true, role = 'CUSTOMER' WHERE email = $1`,
      [email, hashSecret(password)],
    );
    const response = await http("POST", "/auth/sign-in", {
      body: { email, password, organization_id: "org-1" },
    });
    if (response.status !== 200)
      throw new Error(
        `sign-in failed for ${email}: ${response.status} ${response.bytes.toString("utf8")}`,
      );
    return response.json.data.session_token;
  };

  return {
    base,
    http,
    worker,
    stop,
    signInAs,
    logs,
    sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
  };
}
