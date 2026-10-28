import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

import { complianceRuleSetPacketSchema } from "../src/compliance-rule-set/schemas.ts";
import { directDraftSubmissionSchema } from "../src/compliance-rule-set/direct-draft.ts";

// Shape guidance only; the API still owns integrity checks and relation refinements.
const schema = {
  title: "ComplianceRuleSetToolInput",
  type: "object",
  properties: {
    packet: z.toJSONSchema(complianceRuleSetPacketSchema, {
      target: "draft-7",
      io: "input",
    }),
  },
  required: ["packet"],
  additionalProperties: false,
};
const output = new URL(
  "../../../deepagents/rule_set_preparation/packet-schema.json",
  import.meta.url,
);
if (process.argv.includes("--check")) {
  assert.deepEqual(
    JSON.parse(readFileSync(output, "utf8")),
    schema,
    "Rule Set Preparation tool schema is stale; run the contracts export:rule-set-preparation-schema command",
  );
} else {
  writeFileSync(output, JSON.stringify(schema, null, 2) + "\n");
}
const directSchema = z.toJSONSchema(directDraftSubmissionSchema, { target: "draft-7", io: "input" });
const directOutput = new URL("../../../deepagents/rule_set_preparation/direct-draft.schema.json", import.meta.url);
if (process.argv.includes("--check")) {
  assert.deepEqual(JSON.parse(readFileSync(directOutput, "utf8")), directSchema, "Direct draft tool schema is stale");
} else {
  writeFileSync(directOutput, JSON.stringify(directSchema, null, 2) + "\n");
}
