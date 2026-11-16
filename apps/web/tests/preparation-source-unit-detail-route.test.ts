import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import {
  preparationSourceNodeIdSchema,
  preparationSourceUnitDetailRequestSchema,
} from "@lcsp/contracts/compliance-rule-set";
import { GET } from "../src/app/api/admin/compliance-rule-sets/preparations/[preparationRunId]/source-units/[sourceNodeId]/route";

test("source unit detail BFF requires a session before proxying upstream", async () => {
  const request = new NextRequest(
    "http://localhost/api/admin/compliance-rule-sets/preparations/11111111-1111-4111-8111-111111111111/source-units/node-a?inventoryRevision=4",
  );
  const response = await GET(request, {
    params: Promise.resolve({
      preparationRunId: "11111111-1111-4111-8111-111111111111",
      sourceNodeId: "node-a",
    }),
  });
  assert.equal(response.status, 401);
});

test("source unit detail BFF contracts reject malformed revision and source identities", () => {
  assert.equal(
    preparationSourceUnitDetailRequestSchema.safeParse({
      inventoryRevision: "4",
    }).success,
    true,
  );
  assert.equal(
    preparationSourceUnitDetailRequestSchema.safeParse({
      inventoryRevision: "0",
    }).success,
    false,
  );
  assert.equal(preparationSourceNodeIdSchema.safeParse("node-a").success, true);
  assert.equal(preparationSourceNodeIdSchema.safeParse("").success, false);
});
