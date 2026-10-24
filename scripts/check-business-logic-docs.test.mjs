import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  collectTypeScriptBusinessFunctions,
  findBusinessDocumentationViolations,
  isBusinessSource,
  isPythonBusinessSource,
  validateBusinessDocumentation,
} from "./business-logic-docs-core.mjs";

const path =
  "apps/api/src/modules/auth/application/commands/example.handler.ts";
const validDocs = [
  "/**",
  " * Business purpose: Grant a verified customer access to a protected workspace.",
  " *",
  " * Business rules:",
  " * - Only an active customer with verified credentials can enter the workspace.",
  " *",
  " * Execution flow:",
  " * 1. Load the requesting account and verify the supplied access credentials.",
  " * 2. Issue the session and return a public response after persistence succeeds.",
  " *",
  " * Failure cases:",
  " * - Reject suspended users with the stable shared account-suspended problem code.",
  " *",
  " * Side effects:",
  " * - Persist the issued session and a sanitized security audit record.",
  " */",
].join("\n");

test("documents are required in shared business directories, not unit tests or technical Prisma clients", () => {
  assert.equal(isBusinessSource(path), true);
  assert.equal(
    isBusinessSource(
      "apps/api/src/modules/assessment/domain/entities/assessment.entity.ts",
    ),
    true,
  );
  assert.equal(
    isBusinessSource("apps/web/src/features/auth/utils/post-auth-redirect.ts"),
    true,
  );
  assert.equal(
    isBusinessSource("apps/web/src/app/api/auth/sign-in/route.ts"),
    true,
  );
  assert.equal(isBusinessSource("packages/contracts/src/auth/safe.ts"), true);
  assert.equal(
    isBusinessSource("apps/api/src/infrastructure/prisma/prisma.service.ts"),
    false,
  );
  assert.equal(
    isBusinessSource(
      "apps/api/src/modules/auth/application/commands/sign-in/sign-in.handler.spec.ts",
    ),
    false,
  );
  assert.equal(
    isBusinessSource("apps/web/src/features/auth/components/sign-in.tsx"),
    false,
  );
  assert.equal(isPythonBusinessSource("deepagents/decision/eval.py"), true);
  assert.equal(isPythonBusinessSource("deepagents/tests/test_eval.py"), false);
});

test("all five meaningful sections are validated in a JSDoc comment", () => {
  assert.deepEqual(validateBusinessDocumentation(validDocs), []);
  assert.ok(validateBusinessDocumentation("/** Handles logic. */").length >= 5);
  assert.ok(
    validateBusinessDocumentation(
      validDocs
        .replace(
          "1. Load the requesting account",
          "- Load the requesting account",
        )
        .replace("2. Issue the session", "- Issue the session"),
    ).some((problem) => problem.includes("Execution flow")),
  );
  assert.ok(
    validateBusinessDocumentation(
      validDocs.replace(
        "- Persist the issued session and a sanitized security audit record.",
        "- TODO: describe the side effects later",
      ),
    ).some((failure) => failure.includes("Side effects")),
  );
  assert.ok(
    validateBusinessDocumentation(
      validDocs.replace(" * Business rules:", " * Business rulez:"),
    ).some((failure) => failure.includes("Business rules")),
  );
  assert.ok(
    validateBusinessDocumentation(
      validDocs.replace(" * Failure cases:", " * Side effects:"),
    ).length > 0,
  );
});

test("checks a decorated handler method, a function and a named arrow function", () => {
  const content = [
    "function calculateDiscount() { return 2; }",
    "@CommandHandler(SomeCommand)",
    "class ExampleHandler {",
    "  constructor() {}",
    validDocs,
    "  async execute() { return true; }",
    "  readonly decide = () => false;",
    "}",
  ].join("\n");
  const entries = collectTypeScriptBusinessFunctions(content, path);
  assert.deepEqual(
    entries.map((item) => item.name),
    ["calculateDiscount", "ExampleHandler.execute", "ExampleHandler.decide"],
  );
  assert.deepEqual(
    entries.find((entry) => entry.name === "ExampleHandler.execute")?.problems,
    [],
  );
  assert.ok(
    entries.find((entry) => entry.name === "ExampleHandler.decide")?.problems
      .length,
  );
});

test("freezes only unchanged undocumented methods; changed and newly added functions fail", () => {
  const oldCode = "class HandleAccount { execute() { return 1; } }";
  const old = collectTypeScriptBusinessFunctions(oldCode, path);
  assert.equal(old.length, 1);
  const baseline = { [old[0].key]: old[0].hash };
  assert.deepEqual(findBusinessDocumentationViolations(old, baseline), []);

  const changedCode = "class HandleAccount { execute() { return 2; } }";
  const changed = collectTypeScriptBusinessFunctions(changedCode, path);
  assert.equal(
    findBusinessDocumentationViolations(changed, baseline).length,
    1,
  );

  const newCode =
    "class HandleAccount { execute() { return 1; } authorize() { return true; } }";
  const current = collectTypeScriptBusinessFunctions(newCode, path);
  const violations = findBusinessDocumentationViolations(current, baseline);
  assert.deepEqual(
    violations.map((item) => item.name),
    ["HandleAccount.authorize"],
  );

  const documentedCode = [
    "class HandleAccount {",
    validDocs,
    "execute() { return 2; }",
    "}",
  ].join("\n");
  const documented = collectTypeScriptBusinessFunctions(documentedCode, path);
  assert.deepEqual(
    findBusinessDocumentationViolations(documented, baseline),
    [],
  );
});

test("Python AST requires a structured docstring as the function's first statement", () => {
  const py = [
    "class RegistrationHandler:",
    "    def __init__(self):",
    "        pass",
    "    async def execute(self):",
    '        """Business purpose: Grant an eligible user a verified account.',
    "",
    "        Business rules:",
    "        - Require an active account before allowing session issuance.",
    "",
    "        Execution flow:",
    "        1. Verify the account and its required business attributes.",
    "",
    "        Failure cases:",
    "        - Reject inactive account requests with a stable validation error.",
    "",
    "        Side effects:",
    "        - Store the issued session in the authorization database.",
    '        """',
    "        return True",
    "    def revoke(self):",
    "        return False",
  ].join("\n");
  const script = resolve("scripts/business-logic-docs-python.py");
  assert.ok(readFileSync(script, "utf8").includes("ast.parse"));
  const result = spawnSync("python3", [script], {
    encoding: "utf8",
    input: JSON.stringify({
      files: [{ path: "deepagents/auth/registration.py", source: py }],
    }),
  });
  assert.equal(result.status, 0, result.stderr);
  const entries = JSON.parse(result.stdout);
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ["RegistrationHandler.execute", "RegistrationHandler.revoke"],
  );
  assert.deepEqual(validateBusinessDocumentation(entries[0].documentation), []);
  assert.ok(
    validateBusinessDocumentation(entries[1].documentation).length >= 1,
  );
});
