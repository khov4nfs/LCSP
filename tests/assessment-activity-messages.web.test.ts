import assert from "node:assert/strict";
import test from "node:test";
import { ASSESSMENT_DOMAIN_ACTIVITY_LABEL_KEYS } from "@lcsp/contracts/assessment-domain";
import { resolveMessage } from "@lcsp/i18n";

test("canonical assessment activity labels resolve in both locales", () => {
  for (const locale of ["en", "vi"] as const) {
    for (const key of Object.values(ASSESSMENT_DOMAIN_ACTIVITY_LABEL_KEYS)) {
      const message = resolveMessage(locale, key);
      assert.notEqual(message, key, `${locale}: ${key}`);
      assert.ok(message.trim());
    }
  }
});
