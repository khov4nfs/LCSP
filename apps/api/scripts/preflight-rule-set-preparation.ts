import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { collectPreparationPreflight } from "./lib/preparation-preflight.js";
import { diagnosticDatabaseEndpoint } from "./lib/diagnostic-database.js";
/** Read-only diagnostic: no HTTP command, model invocation, migration, activation or canonical write. */
const file = process.env.LCSP_PREFLIGHT_ENV_FILE;
const config = file ? parse(readFileSync(file)) : {};
const url = process.env.DATABASE_URL ?? config.DATABASE_URL;
if (!url)
  throw Error(
    "Explicit local DATABASE_URL or LCSP_PREFLIGHT_ENV_FILE required",
  );
const endpoint = diagnosticDatabaseEndpoint(url);
const db = new PrismaClient({ adapter: new PrismaPg(url) });
try {
  const evidence = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
      return collectPreparationPreflight(tx, endpoint);
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 15000,
    },
  );
  console.log(JSON.stringify(evidence, null, 2));
} catch (error: unknown) {
  const code =
    error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
  console.error(
    JSON.stringify({
      preflightState: "BLOCKED_RUNTIME_CONFIGURATION",
      errorClass: error instanceof Error ? error.name : "UNKNOWN",
      code,
    }),
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
