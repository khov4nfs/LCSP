import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptsDir, "../..");
const rawUrl = process.env.DATABASE_URL;
const expectedPort = String(process.env.LCSP_TEST_POSTGRES_PORT ?? "");
const expectedDatabase = process.env.LCSP_TEST_POSTGRES_DB ?? "";

if (!rawUrl || !expectedPort || !expectedDatabase) {
  throw new Error(
    "Disposable database reset requires DATABASE_URL, LCSP_TEST_POSTGRES_PORT, and LCSP_TEST_POSTGRES_DB",
  );
}

const url = new URL(rawUrl);
const actualPort = url.port || "5432";
const actualDatabase = url.pathname.replace(/^\//u, "");
const schema = url.searchParams.get("schema") ?? "public";

if (
  url.hostname !== "127.0.0.1" ||
  actualPort !== expectedPort ||
  actualDatabase !== expectedDatabase ||
  url.username !== "postgres" ||
  schema !== "public"
) {
  throw new Error(
    `Refusing destructive schema reset for ${url.hostname}:${actualPort}/${actualDatabase}?schema=${schema}; ` +
      `expected 127.0.0.1:${expectedPort}/${expectedDatabase}?schema=public as postgres`,
  );
}

const cacheHome = resolve(apiRoot, ".cache");
mkdirSync(cacheHome, { recursive: true });

const prismaBinary =
  process.platform === "win32"
    ? resolve(apiRoot, "node_modules/.bin/prisma.cmd")
    : resolve(apiRoot, "node_modules/.bin/prisma");

const env = {
  ...process.env,
  DATABASE_URL: rawUrl,
  XDG_CACHE_HOME: cacheHome,
  PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION:
    process.env.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION ?? "yes",
};
const shell = process.platform === "win32";

execFileSync(prismaBinary, ["db", "execute", "--stdin"], {
  cwd: apiRoot,
  env,
  input: "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;\n",
  stdio: ["pipe", "inherit", "inherit"],
  shell,
});

execFileSync(prismaBinary, ["db", "push", "--accept-data-loss"], {
  cwd: apiRoot,
  env,
  stdio: "inherit",
  shell,
});

console.log(
  `Disposable database schema reset completed for 127.0.0.1:${expectedPort}/${expectedDatabase}`,
);
