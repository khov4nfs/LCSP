import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { AUTH_ERROR_CODES, REQUIRED_ACTIONS } from "@lcsp/contracts/auth";
import {
  CREDENTIAL_PROVIDERS,
  PROVIDER_CREDENTIAL_STATUSES,
  type CredentialProvider,
  type ProviderCredentialStatus,
} from "@lcsp/contracts/github-integration";
import {
  authenticateBillingE2e,
  BILLING_E2E_TOKENS,
} from "../fixtures/billing-auth.js";

const fixture = JSON.parse(
  await readFile(
    new URL(
      "../../../apps/web/src/public/assets/mocks/settings-profile.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

type CredentialRow = {
  status: ProviderCredentialStatus;
  username: string;
};

type ConnectorsState = {
  credentials: Map<CredentialProvider, CredentialRow>;
  failRead: boolean;
  failDisconnect: boolean;
  expire: boolean;
  reauthenticated: boolean;
  invalidPassword: boolean;
  disconnectAttempts: number;
  disconnects: CredentialProvider[];
};

/**
 * Business purpose: Drive the Connectors section against a stateful backend double.
 * Business rules: Disconnect needs fresh reauthentication; the double never stores or returns a secret.
 */
async function setup(page: Page): Promise<ConnectorsState> {
  await authenticateBillingE2e(page, BILLING_E2E_TOKENS.customer);
  const state: ConnectorsState = {
    credentials: new Map([
      [
        CREDENTIAL_PROVIDERS.github,
        { status: PROVIDER_CREDENTIAL_STATUSES.active, username: "octo-e2e" },
      ],
    ]),
    failRead: false,
    failDisconnect: false,
    expire: false,
    reauthenticated: false,
    invalidPassword: false,
    disconnectAttempts: 0,
    disconnects: [],
  };
  await page.route("**/api/auth/profile", (route) =>
    route.fulfill({ json: { ok: true, data: fixture.profile } }),
  );
  await page.route("**/api/workspace", (route) =>
    route.fulfill({ json: { ok: true, data: fixture.profile } }),
  );
  await page.route("**/api/auth/sessions**", (route) =>
    route.fulfill({ json: { ok: true, data: { sessions: [] } } }),
  );
  await page.route("**/api/auth/re-auth/password", (route) => {
    if (state.invalidPassword)
      return route.fulfill({
        status: 401,
        json: {
          ok: false,
          problem: {
            ...fixture.failure.problem,
            status: 401,
            code: AUTH_ERROR_CODES.invalidCredentials,
          },
        },
      });
    state.reauthenticated = true;
    return route.fulfill({ json: { ok: true, data: {} } });
  });
  await page.route("**/api/provider-credentials", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    if (state.failRead)
      return route.fulfill({ status: 503, json: fixture.failure });
    return route.fulfill({
      json: {
        ok: true,
        data: Object.values(CREDENTIAL_PROVIDERS).map((provider) => {
          const row = state.credentials.get(provider);
          return {
            provider,
            configured: row?.status === PROVIDER_CREDENTIAL_STATUSES.active,
            status: row?.status ?? null,
            account: row ? { id: "42", username: row.username } : null,
          };
        }),
      },
    });
  });
  await page.route("**/api/provider-credentials/*", (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    state.disconnectAttempts++;
    const provider = new URL(route.request().url()).pathname
      .split("/")
      .pop() as CredentialProvider;
    if (state.expire)
      return route.fulfill({
        status: 401,
        json: {
          ok: false,
          problem: {
            ...fixture.failure.problem,
            status: 401,
            code: AUTH_ERROR_CODES.sessionInvalid,
            requiredAction: REQUIRED_ACTIONS.signIn,
          },
        },
      });
    if (!state.reauthenticated)
      return route.fulfill({
        status: 403,
        json: {
          ok: false,
          problem: {
            ...fixture.failure.problem,
            status: 403,
            code: AUTH_ERROR_CODES.reauthRequired,
            requiredAction: REQUIRED_ACTIONS.reauthenticate,
          },
        },
      });
    if (state.failDisconnect)
      return route.fulfill({ status: 503, json: fixture.failure });
    state.credentials.delete(provider);
    state.disconnects.push(provider);
    return route.fulfill({
      json: {
        ok: true,
        data: {
          provider,
          configured: false,
          status: PROVIDER_CREDENTIAL_STATUSES.revoked,
        },
      },
    });
  });
  return state;
}

const githubRow = (page: Page) =>
  page.locator(
    `[data-component="ConnectorProviderRow"][data-provider="${CREDENTIAL_PROVIDERS.github}"]`,
  );

async function openDisconnectConfirmation(page: Page) {
  await githubRow(page).getByRole("button", { name: "Manage PAT" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "Disconnect this provider?" }),
  ).toBeVisible();
  return dialog;
}

async function verifyPassword(page: Page) {
  const dialog = page.getByRole("dialog").last();
  await dialog.locator('input[type="password"]').fill("test-only-verification");
  await dialog.locator('button[type="submit"]').click();
}

test("disconnect asks for confirmation, retries once after reauthentication and persists after reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = await setup(page);
  await page.goto("/workspace/settings?section=connectors");
  await expect(githubRow(page)).toContainText("Connected");

  const dialog = await openDisconnectConfirmation(page);
  expect(state.disconnectAttempts).toBe(0);
  await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
  await verifyPassword(page);

  await expect(page.getByText("Provider disconnected").first()).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(githubRow(page)).toContainText("Not connected");
  await expect(
    githubRow(page).getByRole("button", { name: "Connect" }),
  ).toBeVisible();
  expect(state.disconnects).toEqual([CREDENTIAL_PROVIDERS.github]);
  expect(state.disconnectAttempts).toBe(2);

  await page.reload();
  await expect(githubRow(page)).toContainText("Not connected");
  expect(errors).toEqual([]);
});

test("canceling the disconnect confirmation or reauthentication leaves the provider connected", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/workspace/settings?section=connectors");

  const dialog = await openDisconnectConfirmation(page);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Disconnect" }),
  ).toBeVisible();
  expect(state.disconnectAttempts).toBe(0);

  await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
  await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
  // The stacked verification dialog hides the provider dialog from the a11y tree.
  await expect(
    page.getByRole("dialog").locator('input[type="password"]'),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page
      .getByRole("dialog")
      .getByRole("alert")
      .filter({ hasText: "Identity confirmation was canceled" }),
  ).toBeVisible();
  expect(state.disconnects).toEqual([]);
  expect(state.disconnectAttempts).toBe(1);
  await page.keyboard.press("Escape");
  await expect(githubRow(page)).toContainText("Connected");
});

test("a failed disconnect keeps the dialog open, never shows success and can be retried", async ({
  page,
}) => {
  const state = await setup(page);
  state.reauthenticated = true;
  state.failDisconnect = true;
  await page.goto("/workspace/settings?section=connectors");

  const dialog = await openDisconnectConfirmation(page);
  await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(
    dialog.getByRole("alert").filter({ hasText: "We could not disconnect" }),
  ).toBeVisible();
  await expect(page.getByText("Provider disconnected")).toHaveCount(0);
  expect(state.disconnects).toEqual([]);

  state.failDisconnect = false;
  await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByText("Provider disconnected").first()).toBeVisible();
  await expect(githubRow(page)).toContainText("Not connected");
});

test("an expired session redirects to sign-in without reporting a disconnect", async ({
  page,
}) => {
  const state = await setup(page);
  state.expire = true;
  await page.goto("/workspace/settings?section=connectors");
  const dialog = await openDisconnectConfirmation(page);
  await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  expect(state.disconnects).toEqual([]);
});

test("read failures are distinct from loading and empty data and recover on retry", async ({
  page,
}) => {
  const state = await setup(page);
  state.failRead = true;
  state.credentials.clear();
  await page.goto("/workspace/settings?section=connectors");

  const failure = page.locator('[data-component="ConnectorLoadError"]');
  await expect(failure).toBeVisible({ timeout: 15000 });
  await expect(failure).toContainText(
    "Provider connections could not be loaded",
  );
  await expect(page.getByText("Not connected")).toHaveCount(0);
  await expect(page.getByText("No Git provider is connected yet")).toHaveCount(
    0,
  );

  state.failRead = false;
  await failure.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(failure).toHaveCount(0);
  await expect(
    page.getByText(
      "No Git provider is connected yet. Connect one to scan your repositories.",
    ),
  ).toBeVisible();
  await expect(githubRow(page)).toContainText("Not connected");
});

test("an expired credential is flagged and stays manageable", async ({
  page,
}) => {
  const state = await setup(page);
  state.credentials.set(CREDENTIAL_PROVIDERS.github, {
    status: PROVIDER_CREDENTIAL_STATUSES.expired,
    username: "octo-e2e",
  });
  await page.goto("/workspace/settings?section=connectors");
  await expect(githubRow(page)).toContainText("Expired");
  await expect(githubRow(page)).not.toContainText("Connected");
  await githubRow(page).getByRole("button", { name: "Manage PAT" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Disconnect", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Update PAT" }),
  ).toBeVisible();
});

test("Vietnamese copy and keyboard operation work for the disconnect flow", async ({
  page,
}) => {
  const state = await setup(page);
  state.reauthenticated = true;
  await page.context().addCookies([
    {
      name: "lcsp_locale",
      value: "vi",
      url: "http://127.0.0.1:3100",
      sameSite: "Lax",
    },
  ]);
  await page.goto("/workspace/settings?section=connectors");
  await expect(githubRow(page)).toContainText("Đã kết nối");
  await githubRow(page).getByRole("button").focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Ngắt kết nối", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ngắt kết nối provider này?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ngắt kết nối", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("Đã ngắt kết nối provider").first(),
  ).toBeVisible();
  await expect(githubRow(page)).toContainText("Chưa kết nối");
  expect(state.disconnects).toEqual([CREDENTIAL_PROVIDERS.github]);
});
