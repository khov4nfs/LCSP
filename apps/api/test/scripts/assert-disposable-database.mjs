import { URL } from "node:url";

const rawUrl = process.env.DATABASE_URL;
const expectedPort = String(process.env.LCSP_TEST_POSTGRES_PORT ?? "");
const expectedDatabase = process.env.LCSP_TEST_POSTGRES_DB ?? "";

if (!rawUrl || !expectedPort || !expectedDatabase) {
  throw new Error(
    "E2E database guard requires DATABASE_URL, LCSP_TEST_POSTGRES_PORT, and LCSP_TEST_POSTGRES_DB",
  );
}

const url = new URL(rawUrl);
const actualPort = url.port || "5432";
const actualDatabase = url.pathname.replace(/^\//u, "");

if (
  url.hostname !== "127.0.0.1" ||
  actualPort !== expectedPort ||
  actualDatabase !== expectedDatabase ||
  url.username !== "postgres"
) {
  throw new Error(
    `Refusing destructive E2E database operation for ${url.hostname}:${actualPort}/${actualDatabase}; expected 127.0.0.1:${expectedPort}/${expectedDatabase} as postgres`,
  );
}

console.log(`E2E database guard passed for 127.0.0.1:${expectedPort}/${expectedDatabase}`);
