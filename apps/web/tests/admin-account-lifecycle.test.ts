import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AUTH_ACCOUNT_STATUSES,
  AUTH_USER_ROLES,
  ADMIN_ACCOUNT_ERRORS,
  type AdminUserDetail,
} from "@lcsp/contracts/auth";
import {
  fetchAdminUsersList,
  suspendAdminUser,
  restoreAdminUser,
  createAdminUserInvitation,
} from "../src/lib/api/admin-users-client.ts";
import { AdminAccountDetailsCard } from "../src/features/admin/components/organisms/admin-account-details-card.tsx";
import { AdminAdministrativeActionsCard } from "../src/features/admin/components/organisms/admin-administrative-actions-card.tsx";
import { adminInviteUserSchema } from "../src/features/admin/schemas/admin-invite-user.schema.ts";
import { invitationAcceptSchema } from "../src/features/auth/schemas/invitation-accept.schema.ts";
import { resolveAppMessage } from "../src/lib/i18n.ts";

async function fixture(): Promise<AdminUserDetail> {
  return JSON.parse(
    await readFile(
      new URL(
        "../src/public/assets/mocks/lcsp299-account-lifecycle.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as AdminUserDetail;
}
test("LCSP-299 clients preserve expectedVersion and idempotency through all lifecycle requests", async (context) => {
  const user = await fixture();
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const original = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ ok: true, data: user });
  };
  await suspendAdminUser(
    user.id,
    { expectedVersion: user.version! },
    "same-suspend-key",
  );
  await suspendAdminUser(
    user.id,
    { expectedVersion: user.version! },
    "same-suspend-key",
  );
  await restoreAdminUser(
    user.id,
    { expectedVersion: user.version! },
    "restore-key",
  );
  for (const call of calls)
    assert.equal(
      (JSON.parse(String(call.init?.body)) as { expectedVersion: number })
        .expectedVersion,
      4,
    );
  assert.equal(
    new Headers(calls[0].init?.headers).get("idempotency-key"),
    "same-suspend-key",
  );
  assert.equal(
    new Headers(calls[1].init?.headers).get("idempotency-key"),
    "same-suspend-key",
  );
  assert.equal(calls[2].url, `/api/admin/users/${user.id}/restore`);
  await createAdminUserInvitation(
    { email: user.email, displayName: user.fullName, role: user.role },
    "invite-key",
  );
  assert.equal(calls[3].url, "/api/admin/users");
  assert.equal(
    new Headers(calls[3].init?.headers).get("idempotency-key"),
    "invite-key",
  );
});
test("LCSP-299 client never reports success for a stale-state rejection", async (context) => {
  const original = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () =>
    Response.json(
      { ok: false, problem: { code: ADMIN_ACCOUNT_ERRORS.staleVersion } },
      { status: 409 },
    );
  await assert.rejects(restoreAdminUser("user", { expectedVersion: 0 }), {
    message: ADMIN_ACCOUNT_ERRORS.staleVersion,
  });
});
test("LCSP-299 list sends search, role, status and pagination to the server", async (context) => {
  const original = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = original;
  });
  let captured = "";
  globalThis.fetch = async (url) => {
    captured = String(url);
    return Response.json({
      ok: true,
      data: { users: [], totalCount: 0, page: 2, pageSize: 20, totalPages: 1 },
    });
  };
  await fetchAdminUsersList({
    query: "Some Name",
    role: AUTH_USER_ROLES.customer,
    status: AUTH_ACCOUNT_STATUSES.suspended,
    page: 2,
    pageSize: 20,
  });
  const params = new URL(captured, "http://localhost").searchParams;
  assert.equal(params.get("q"), "Some Name");
  assert.equal(params.get("status"), AUTH_ACCOUNT_STATUSES.suspended);
  assert.equal(params.get("page"), "2");
});
test("LCSP-299 actual action card renders Restore for authoritative Suspended state", async () => {
  const user = await fixture();
  const html = renderToStaticMarkup(
    createElement(AdminAdministrativeActionsCard, {
      user: { ...user, status: AUTH_ACCOUNT_STATUSES.suspended },
      onOpenSuspendModal: () => {},
      onRestore: () => Promise.resolve(),
    }),
  );
  assert.ok(html.includes(resolveAppMessage("pages.accountLifecycle.restore")));
  assert.ok(
    !html.includes(
      resolveAppMessage(
        "pages.admin.userDetail.administrativeActionsCard.suspendAccount",
      ),
    ),
  );
});
test("LCSP-299 active card retains Suspend and invited records do not offer account mutations", async () => {
  const user = await fixture();
  const active = renderToStaticMarkup(
    createElement(AdminAdministrativeActionsCard, {
      user,
      onOpenSuspendModal: () => {},
    }),
  );
  assert.ok(
    active.includes(
      resolveAppMessage(
        "pages.admin.userDetail.administrativeActionsCard.suspendAccount",
      ),
    ),
  );
  const invited = renderToStaticMarkup(
    createElement(AdminAdministrativeActionsCard, {
      user: { ...user, status: AUTH_ACCOUNT_STATUSES.invited },
      onOpenSuspendModal: () => {},
    }),
  );
  assert.ok(
    invited.includes(resolveAppMessage("pages.accountLifecycle.invitePending")),
  );
  assert.ok(invited.includes("disabled"));
});
test("LCSP-299 form schemas reject spoofed roles, invalid identity and weak/mismatched passwords", () => {
  assert.equal(
    adminInviteUserSchema.safeParse({
      email: "bad",
      displayName: "",
      role: "ROOT",
    }).success,
    false,
  );
  assert.equal(
    adminInviteUserSchema.safeParse({
      email: "user@example.com",
      displayName: "User",
      role: AUTH_USER_ROLES.customer,
    }).success,
    true,
  );
  assert.equal(
    invitationAcceptSchema.safeParse({
      password: "short",
      confirmPassword: "short",
    }).success,
    false,
  );
  assert.equal(
    invitationAcceptSchema.safeParse({
      password: "a-strong-test-password",
      confirmPassword: "different-test-password",
    }).success,
    false,
  );
  assert.equal(
    invitationAcceptSchema.safeParse({
      password: "a-strong-test-password",
      confirmPassword: "a-strong-test-password",
    }).success,
    true,
  );
});

test("LCSP-299 role is read-only account metadata; actions contain no role editor", async () => {
  const user = await fixture();
  for (const role of Object.values(AUTH_USER_ROLES)) {
    const account = { ...user, role };
    const details = renderToStaticMarkup(
      createElement(AdminAccountDetailsCard, { user: account }),
    );
    assert.ok(
      details.includes(
        resolveAppMessage("pages.admin.userDetail.accountDetailsCard.role"),
      ),
    );
    assert.ok(
      details.includes(
        resolveAppMessage(
          role === AUTH_USER_ROLES.admin
            ? "pages.admin.usersList.roles.ADMIN"
            : "pages.admin.usersList.roles.CUSTOMER",
        ),
      ),
    );
    const actions = renderToStaticMarkup(
      createElement(AdminAdministrativeActionsCard, {
        user: account,
        onOpenSuspendModal() {},
        onRestore: () => Promise.resolve(),
      }),
    );
    for (const html of [details, actions])
      assert.doesNotMatch(
        html,
        /<select|role="combobox"|Save role|Saving role/i,
      );
  }
});

test("LCSP-299 existing-user role mutation has no exported client, hook or BFF route", async () => {
  const client = await import("../src/lib/api/admin-users-client.ts");
  const queries = await import("../src/lib/api/admin-users-queries.ts");
  assert.equal("updateAdminUserRole" in client, false);
  assert.equal("useAdminUpdateRoleMutation" in queries, false);
  await assert.rejects(
    readFile(
      new URL("../src/app/api/admin/users/[id]/role/route.ts", import.meta.url),
    ),
    { code: "ENOENT" },
  );
});
