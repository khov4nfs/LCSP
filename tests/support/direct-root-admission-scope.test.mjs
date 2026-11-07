import assert from "node:assert/strict";
import test from "node:test";
import { directRootAdmissionFixture } from "./direct-root-admission.mjs";

function construct(databaseUrl) {
  return directRootAdmissionFixture({
    q: async () => {
      throw new Error("Scope validation must not query a database");
    },
    base: "http://127.0.0.1:52069",
    databaseUrl,
    workerKey: "owned-provider-free-scope-test",
    apiDir: new URL("../../apps/api", import.meta.url).pathname,
  });
}

for (const database of [
  "lcsp_assessment_contract_fixture",
  "lcsp360_final_hitl_phase2_0123456789abcdef",
]) {
  test("accepts the owned disposable namespace " + database, () => {
    assert.equal(
      typeof construct("postgresql://postgres@127.0.0.1:55491/" + database),
      "object",
    );
  });
}

for (const database of [
  "postgres",
  "production",
  "lcsp360_production",
  "lcsp360_final_",
  "lcsp_",
  "lcsp_fixture/extra",
  "lcsp_fixture%22",
]) {
  test("rejects an unowned or malformed database " + database, () => {
    assert.throws(
      () => construct("postgresql://postgres@127.0.0.1:55491/" + database),
      assert.AssertionError,
    );
  });
}

for (const address of [
  "127.0.0.1:5432",
  "127.0.0.1:55431",
  "127.0.0.1:55500",
  "localhost:55491",
  "10.0.0.1:55491",
]) {
  test("rejects a non-fixture database endpoint " + address, () => {
    assert.throws(
      () => construct("postgresql://postgres@" + address + "/lcsp_fixture"),
      assert.AssertionError,
    );
  });
}
