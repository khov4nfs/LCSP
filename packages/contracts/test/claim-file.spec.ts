import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@jest/globals";
import { claimFileSchema } from "../src/compliance-rule-set/claim-file.ts";

const samples = JSON.parse(
  readFileSync(new URL("./fixtures/claim-files.json", import.meta.url), "utf8"),
) as {
  name: string;
  valid: boolean;
  document: unknown;
}[];

describe("claim file Zod / Python JSON Schema parity", () => {
  // Use the installed Python validator used by the governed compiler, without a second JS dependency.
  const validation = spawnSync(
    fileURLToPath(
      new URL("../../../deepagents/.venv/bin/python", import.meta.url),
    ),
    [
      "-c",
      `
import json, sys
from jsonschema import Draft7Validator, FormatChecker
schema = json.load(open(sys.argv[1]))
Draft7Validator.check_schema(schema)
validator = Draft7Validator(schema, format_checker=FormatChecker())
print(json.dumps([validator.is_valid(sample["document"]) for sample in json.load(sys.stdin)]))
`,
      fileURLToPath(
        new URL(
          "../../../deepagents/rule_set_preparation/claim-file.schema.json",
          import.meta.url,
        ),
      ),
    ],
    {
      input: JSON.stringify(samples),
      encoding: "utf8",
    },
  );
  if (validation.status !== 0)
    throw new Error(validation.stderr || String(validation.error));
  const schemaResults = JSON.parse(validation.stdout) as boolean[];

  it.each(samples.map((sample, index) => ({ ...sample, index })))(
    "$name",
    (sample) => {
      const zod = claimFileSchema.safeParse(sample.document);
      expect({ validator: "zod", valid: zod.success }).toEqual({
        validator: "zod",
        valid: sample.valid,
      });
      expect({
        validator: "jsonschema",
        valid: schemaResults[sample.index],
      }).toEqual({ validator: "jsonschema", valid: sample.valid });
    },
  );
});
