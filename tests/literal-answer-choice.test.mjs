import assert from "node:assert/strict";
import { test } from "node:test";

import { findLiteralAnswerChoice } from "./support/literal-answer-choice.mjs";

test("ordinary answers keep case-insensitive substring matching", () => {
  assert.equal(
    findLiteralAnswerChoice(["Private household", "Offered to the PUBLIC"], "public"),
    "Offered to the PUBLIC",
  );
});

test("regular expression metacharacters in an option are literal", () => {
  const answer = "[public] (service)+? . * ^ $ {scope} | \\";
  assert.equal(findLiteralAnswerChoice(["Other", `Option: ${answer}`], answer), `Option: ${answer}`);
});

test("wildcard and alternation arguments cannot select another option", () => {
  assert.equal(findLiteralAnswerChoice(["Public", "Private household"], ".*"), undefined);
  assert.equal(findLiteralAnswerChoice(["Public", "Private household"], "public|household"), undefined);
  assert.equal(findLiteralAnswerChoice(["Other", "Literal .*"], ".*"), "Literal .*");
});

test("malformed regex syntax cannot throw or broaden the match", () => {
  for (const answer of ["[", "(", "\\"]) {
    assert.equal(findLiteralAnswerChoice(["Unrelated", `Literal ${answer}`], answer), `Literal ${answer}`);
  }
});

test("nested-quantifier payload is matched literally", () => {
  const nonmatch = `${"a".repeat(4096)}!`;
  for (const answer of ["(a+)+$", "(a+){2}$"]) {
    assert.equal(findLiteralAnswerChoice([nonmatch, `Literal ${answer}`], answer), `Literal ${answer}`);
  }
});

test("Vietnamese labels keep case-insensitive matching", () => {
  assert.equal(findLiteralAnswerChoice(["Nội bộ", "Dịch vụ CÔNG KHAI"], "công khai"), "Dịch vụ CÔNG KHAI");
});

test("an unmatched literal answer remains unmatched", () => {
  assert.equal(findLiteralAnswerChoice(["Public", "Private"], "Unknown"), undefined);
});
