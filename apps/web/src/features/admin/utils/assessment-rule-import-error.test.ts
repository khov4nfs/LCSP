import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGAL_RULE_CATALOG_ERRORS as E,
  LEGAL_RULE_VALIDATION_ISSUES as ISSUE,
} from "@lcsp/contracts/legal-rule-catalog";
import { ApiRequestError } from "@/lib/api/api-request";
import { assessmentRuleImportErrorMessage } from "./assessment-rule-import-error";

test("import validation uses a localized category without reflecting a schema path", () => {
  // Why: Server-side issue categories must remain useful without exposing output tree structure.
  // How: Give the UI both a safe category and a hostile legacy path; only the category may affect copy.
  // Invariant: Submitted values and nested field paths are never rendered from problem metadata.
  const message = assessmentRuleImportErrorMessage(
    new ApiRequestError(E.RESULT_INVALID, {
      meta: {
        issueCode: ISSUE.SOURCE_REFERENCE_INVALID,
        issues: "output.assessmentRules.0.sourceRefs",
      },
    } as never),
  );
  assert.ok(message.length > 0);
  assert.ok(!message.includes("output.assessmentRules"));
  assert.ok(!message.includes("SOURCE_REFERENCE_INVALID"));
});
