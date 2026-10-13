import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { click, render, settle } from "./support/dom.ts";
import { apiQueryKeys } from "../src/lib/api/query-keys.ts";
import { setAppLocale } from "../src/lib/locale.ts";
import { getAdminAccountIdentity } from "../src/features/admin/lib/admin-account-identity.ts";

const { AdminAccountMenu } =
  await import("../src/features/admin/components/organisms/admin-account-menu.tsx");
const { profile } = JSON.parse(
  await readFile(
    new URL("../src/public/assets/mocks/admin-shell.json", import.meta.url),
    "utf8",
  ),
);

function menu(account = profile) {
  setAppLocale("en");
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: 0 },
    },
  });
  client.setQueryData(apiQueryKeys.auth.settingsProfile(), account);
  return render(
    <QueryClientProvider client={client}>
      <AdminAccountMenu />
    </QueryClientProvider>,
  );
}

test("canonical account identity derives the name, email and initials from profile, never role", () => {
  assert.deepEqual(getAdminAccountIdentity(profile), {
    displayName: profile.display_name,
    email: profile.email,
    role: AUTH_USER_ROLES.admin,
    avatarInitials: "P",
  });
  assert.equal(
    getAdminAccountIdentity({ ...profile, display_name: "  " })?.displayName,
    profile.email,
  );
  assert.equal(
    getAdminAccountIdentity({ ...profile, display_name: "  " })?.avatarInitials,
    "O",
  );
  assert.equal(getAdminAccountIdentity(), null);
});

test("one account trigger and popover share the same authenticated identity and actions", async () => {
  const container = menu();
  await settle();
  const trigger = container.querySelector("[data-admin-account-trigger]");
  assert.equal(
    container.querySelectorAll("[data-admin-account-trigger]").length,
    1,
  );
  assert.equal(
    trigger?.querySelector("[data-admin-account-name]")?.textContent,
    profile.display_name,
  );
  assert.equal(
    trigger?.querySelector("[data-admin-account-email]")?.textContent,
    profile.email,
  );
  assert.equal(
    trigger?.querySelector('[data-slot="avatar-fallback"]')?.textContent,
    "P",
  );
  click(trigger);
  await settle();
  const header = document.querySelector("[data-admin-account-header]");
  assert.equal(header?.textContent, trigger?.textContent);
  const popup = document.querySelector('[data-slot="dropdown-menu-content"]');
  assert.match(popup?.textContent ?? "", /Language/);
  assert.match(popup?.textContent ?? "", /Theme/);
  assert.match(popup?.textContent ?? "", /Sign out/);
  assert.equal(popup?.getAttribute("data-side"), "top");
});

test("long names retain their full identity while trigger and header truncate consistently", async () => {
  const display_name = `${profile.display_name} ${profile.display_name}`;
  const container = menu({ ...profile, display_name });
  await settle();
  const name = container.querySelector("[data-admin-account-name]");
  assert.equal(name?.textContent, display_name);
  assert.ok(name?.classList.contains("truncate"));
  assert.equal(name?.getAttribute("title"), null);
  click(container.querySelector("[data-admin-account-trigger]"));
  await settle();
  assert.equal(
    document.querySelector(
      "[data-admin-account-header] [data-admin-account-name]",
    )?.textContent,
    display_name,
  );
});
