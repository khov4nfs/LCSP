import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES,
  AUTH_BACKUP_EMAIL_POLICIES,
  AUTH_ERROR_CODES,
  REQUIRED_ACTIONS,
} from "@lcsp/contracts/auth";
import { accountSecuritySchema } from "../src/features/settings/schemas/account-security.schema";
import { runAccountSecurityAction } from "../src/features/settings/utils/account-security.utils";
import { API_OUTCOME_KINDS } from "../src/lib/api/outcome-kinds";
import { generateMfaRecoveryCodes } from "../src/lib/api/auth-client";

const fixture = JSON.parse(
  await readFile(
    new URL(
      "../src/public/assets/mocks/settings-account-security.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const profileFixture = JSON.parse(
  await readFile(
    new URL(
      "../src/public/assets/mocks/settings-profile.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

test("recovery preferences validate policy dependencies and normalize email without banning supported empty backup settings", () => {
  const draft = {
    recovery_email: "",
    primary_email_address_policy:
      AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES.accountEmail,
    backup_recovery_email_policy: AUTH_BACKUP_EMAIL_POLICIES.recoveryEmail,
  };
  assert.equal(accountSecuritySchema.safeParse(draft).success, true);
  assert.equal(
    accountSecuritySchema.safeParse({
      ...draft,
      primary_email_address_policy:
        AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES.recoveryEmail,
    }).success,
    false,
  );
  assert.equal(
    accountSecuritySchema.safeParse({ ...draft, recovery_email: "invalid" })
      .success,
    false,
  );
  assert.equal(
    accountSecuritySchema.parse({
      ...draft,
      recovery_email: ` ${fixture.email.toUpperCase()} `,
    }).recovery_email,
    fixture.email,
  );
});

test("distinct OTP and password proofs are both completed, with a bounded retry", async () => {
  const kinds = [
    API_OUTCOME_KINDS.mfaRequired,
    API_OUTCOME_KINDS.reauthRequired,
    API_OUTCOME_KINDS.saved,
  ];
  const proofs: boolean[] = [];
  const result = await runAccountSecurityAction(
    async () => ({ kind: kinds.shift()! }),
    async (mfa) => {
      proofs.push(mfa);
      return true;
    },
  );
  assert.equal(result?.kind, API_OUTCOME_KINDS.saved);
  assert.deepEqual(proofs, [true, false]);
  assert.equal(kinds.length, 0);
});

test("cancellation and repeated challenges never authorize an extra mutation", async () => {
  let writes = 0;
  const action = async () => {
    writes++;
    return { kind: API_OUTCOME_KINDS.reauthRequired };
  };
  assert.equal(await runAccountSecurityAction(action, async () => false), null);
  assert.equal(writes, 1);
  writes = 0;
  assert.equal(
    (await runAccountSecurityAction(action, async () => true))?.kind,
    API_OUTCOME_KINDS.reauthRequired,
  );
  assert.equal(writes, 2);
});

test("ambiguous transport failure is not automatically retried", async () => {
  let writes = 0;
  await assert.rejects(
    runAccountSecurityAction(
      async () => {
        writes++;
        throw new Error("transport");
      },
      async () => true,
    ),
  );
  assert.equal(writes, 1);
});

test("recovery batch client rejects mixed or empty codes and preserves both challenges", async () => {
  const original = globalThis.fetch;
  try {
    for (const payload of [fixture.malformed, fixture.empty, fixture.blank]) {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ ok: true, data: payload }), {
          status: 200,
        });
      await assert.rejects(
        generateMfaRecoveryCodes(),
        /recovery-codes-not-confirmed/,
      );
    }
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: true, data: fixture.replacement }), {
        status: 200,
      });
    assert.deepEqual(await generateMfaRecoveryCodes(), {
      kind: API_OUTCOME_KINDS.loaded,
      recoveryCodes: fixture.replacement.recovery_codes,
    });
    for (const [code, kind] of [
      [AUTH_ERROR_CODES.mfaRequired, API_OUTCOME_KINDS.mfaRequired],
      [AUTH_ERROR_CODES.reauthRequired, API_OUTCOME_KINDS.reauthRequired],
    ]) {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            ...profileFixture.failure,
            problem: { ...profileFixture.failure.problem, status: 403, code },
          }),
          { status: 403 },
        );
      assert.equal((await generateMfaRecoveryCodes()).kind, kind);
    }
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          ...profileFixture.failure,
          problem: {
            ...profileFixture.failure.problem,
            code: AUTH_ERROR_CODES.rbacDenied,
            status: 403,
            requiredAction: REQUIRED_ACTIONS.reauthenticate,
          },
        }),
        { status: 403 },
      );
    assert.equal(
      (await generateMfaRecoveryCodes()).kind,
      API_OUTCOME_KINDS.reauthRequired,
    );
  } finally {
    globalThis.fetch = original;
  }
});
