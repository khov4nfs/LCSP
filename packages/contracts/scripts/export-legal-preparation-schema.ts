import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

import { legalPortfolioPacketSchema } from "../src/legal-portfolio/schemas.ts";

// Shape guidance only; the API still owns integrity checks and relation refinements.
const schema = {
  title: "LegalPortfolioToolInput",
  type: "object",
  properties: {
    packet: z.toJSONSchema(legalPortfolioPacketSchema, { target: "draft-7" }),
  },
  required: ["packet"],
  additionalProperties: false,
};
const output = new URL(
  "../../../deepagents/legal_preparation/packet-schema.json",
  import.meta.url,
);
if (process.argv.includes("--check")) {
  assert.deepEqual(
    JSON.parse(readFileSync(output, "utf8")),
    schema,
    "Legal Preparation tool schema is stale; run the contracts export:legal-preparation-schema command",
  );
} else {
  writeFileSync(output, JSON.stringify(schema, null, 2) + "\n");
}
