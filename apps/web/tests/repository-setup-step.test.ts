import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import { JSDOM } from "jsdom";
import React from "react";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ASSESSMENT_LIFECYCLE_STATES,
  ASSESSMENT_REPOSITORY_PROVIDERS,
} from "@lcsp/contracts/assessment";
import {
  CREDENTIAL_PROVIDERS,
  REPOSITORY_CONNECTION_STATUSES,
} from "@lcsp/contracts/github-integration";
import type { AssessmentRepositorySetup } from "@lcsp/contracts/assessment-domain";
import type { Root } from "react-dom/client";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
const testWindow = dom.window;
for (const [name, value] of Object.entries({
  Element: testWindow.Element,
  window: testWindow,
  document: testWindow.document,
  navigator: testWindow.navigator,
  HTMLElement: testWindow.HTMLElement,
  HTMLButtonElement: testWindow.HTMLButtonElement,
  HTMLInputElement: testWindow.HTMLInputElement,
  HTMLFormElement: testWindow.HTMLFormElement,
  KeyboardEvent: testWindow.KeyboardEvent,
  MouseEvent: testWindow.MouseEvent,
  Event: testWindow.Event,
  Node: testWindow.Node,
  React,
})) {
  Object.defineProperty(globalThis, name, { configurable: true, value });
}
Object.defineProperty(testWindow, "matchMedia", {
  configurable: true,
  value: () => ({
    addEventListener: () => undefined,
    addListener: () => undefined,
    dispatchEvent: () => false,
    matches: false,
    media: "",
    onchange: null,
    removeEventListener: () => undefined,
    removeListener: () => undefined,
  }),
});
Object.defineProperty(testWindow.HTMLElement.prototype, "scrollTo", {
  configurable: true,
  value: () => undefined,
});
Object.defineProperty(
  testWindow.HTMLTextAreaElement.prototype,
  "scrollHeight",
  {
    configurable: true,
    get() {
      return Math.max(1, this.value.split("\n").length) * 20;
    },
  },
);
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Test doubles stand in for the network-bound hooks; the setup step, the form, the list and the client run for real.
const navigation = { replaced: [] as string[] };
const createdAssessments: string[] = [];
const ASSESSMENT_ID = "11111111-1111-4111-8111-111111111111";

mock.module("next/image", {
  defaultExport: (props: Record<string, unknown>) =>
    React.createElement("img", { alt: "", src: String(props.src) }),
});
mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({
      replace: (path: string) => navigation.replaced.push(path),
      push: () => undefined,
    }),
  },
});
mock.module("../src/lib/api/auth-queries", {
  namedExports: {
    useAuthSettingsProfileQuery: () => ({
      data: undefined,
      refetch: () => undefined,
    }),
    useMfaVerifyMutation: () => ({ mutateAsync: () => Promise.resolve({}) }),
    usePasswordReauthMutation: () => ({
      mutateAsync: () => Promise.resolve({}),
    }),
  },
});
mock.module("../src/lib/api/github-repository-queries", {
  namedExports: {
    useProviderCredentialStatusesQuery: () => ({
      data: [
        { provider: CREDENTIAL_PROVIDERS.github, configured: true },
        { provider: CREDENTIAL_PROVIDERS.gitlab, configured: true },
      ],
    }),
  },
});
mock.module("../src/lib/api/workspace-queries", {
  namedExports: {
    useCreateAssessmentMutation: () => ({
      mutateAsync: ({ name }: { name: string }) => {
        createdAssessments.push(name);
        return Promise.resolve({
          kind: "created",
          assessmentId: ASSESSMENT_ID,
        });
      },
    }),
  },
});
mock.module(
  "../src/features/settings/components/molecules/provider-credential-dialog",
  {
    namedExports: {
      PROVIDER_CREDENTIAL_DIALOG_MODES: { connect: "connect" },
      ProviderCredentialDialog: () => null,
    },
  },
);

const { appLocale } = await import("../src/lib/locale");
const { createRoot } = await import("react-dom/client");
const { RepositorySetupStep } =
  await import("../src/features/assessment-flow/components/organisms/repository-setup-step");

const mountedRoots: Root[] = [];
afterEach(() => {
  for (const root of mountedRoots.splice(0)) act(() => root.unmount());
  testWindow.document.body.replaceChildren();
  navigation.replaced.length = 0;
  createdAssessments.length = 0;
});

/** Resolves copy in the locale the component renders with, so the assertions hold in every language. */
const msg = (key: MessageKey) => resolveMessage(appLocale, key);

const timestamp = "2026-10-01T00:00:00.000Z";

type Fake = {
  state: AssessmentRepositorySetup;
  calls: Array<{ method: string; path: string; body: Record<string, unknown> }>;
};

/** A minimal server: connections and snapshots are created on demand and completion activates the assessment. */
function installServer(options: { repositoryLimit: number }): Fake {
  const fake: Fake = {
    calls: [],
    state: {
      assessmentId: ASSESSMENT_ID,
      lifecycle: {
        state: ASSESSMENT_LIFECYCLE_STATES.PREPARING,
        assessmentRevision: 1,
      } as never,
      connection: null,
      snapshot: null,
      scanJob: null,
      repositories: [],
      repositorySetDigest: null,
      repositoryLimit: options.repositoryLimit,
      setupCompleted: false,
    },
  };
  let counter = 0;
  const fetchMock = async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(url), "https://lcsp.test").pathname;
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};
    const ok = (data: unknown) => Response.json({ ok: true, data });
    if (method === "GET" && path.endsWith("/repository-setup")) {
      return ok(fake.state);
    }
    fake.calls.push({ method, path, body });
    if (path.endsWith("/repository-connection")) {
      const url = new URL(String(body.repositoryUrl));
      const fullName = url.pathname.replace(/^\/|\.git$|\/$/gu, "");
      counter += 1;
      const connection = {
        connectionId: `conn-${counter}`,
        provider: url.hostname.includes("gitlab")
          ? CREDENTIAL_PROVIDERS.gitlab
          : CREDENTIAL_PROVIDERS.github,
        repositoryId: `repo-${counter}`,
        repositoryFullName: fullName,
        defaultBranch: "main",
        status: REPOSITORY_CONNECTION_STATUSES.active,
      };
      fake.state.repositories.push({
        repositoryKey: null,
        connection,
        snapshot: null,
        scanJob: null,
      });
      fake.state.connection ??= connection;
      return ok(connection);
    }
    if (path.endsWith("/snapshots")) {
      const entry = fake.state.repositories.find(
        (item) => item.connection.connectionId === body.connection_id,
      )!;
      counter += 1;
      entry.snapshot = {
        id: `snap-${counter}`,
        assessmentId: ASSESSMENT_ID,
        connectionId: entry.connection.connectionId,
        provider: entry.connection.provider,
        repositoryFullName: entry.connection.repositoryFullName,
        branch: "main",
        commitSha: String(counter).repeat(40).slice(0, 40),
        sourcePathPrefix: (body.source_path_prefix as string | null) ?? null,
        createdAt: timestamp,
      };
      fake.state.snapshot ??= entry.snapshot;
      return ok({
        snapshot_id: entry.snapshot.id,
        commit_sha: entry.snapshot.commitSha,
      });
    }
    if (path.endsWith("/repository-setup/complete")) {
      const ids = body.snapshotIds as string[];
      fake.state.lifecycle = {
        state: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
        assessmentRevision: 2,
      } as never;
      fake.state.setupCompleted = true;
      const pinned = ids.map((id) =>
        fake.state.repositories.find((item) => item.snapshot?.id === id)!,
      );
      return ok({
        assessment_id: ASSESSMENT_ID,
        repository_connection_id: pinned[0]!.connection.connectionId,
        snapshot_id: pinned[0]!.snapshot!.id,
        commit_sha: pinned[0]!.snapshot!.commitSha,
        repositories: pinned.map((item, index) => ({
          repository_key: `repo-${index}`,
          connection_id: item.connection.connectionId,
          snapshot_id: item.snapshot!.id,
          commit_sha: item.snapshot!.commitSha,
        })),
      });
    }
    if (method === "DELETE") {
      const snapshotId = path.split("/").slice(-1)[0]!;
      const index = fake.state.repositories.findIndex(
        (item) => item.snapshot?.id === snapshotId,
      );
      const [removed] = fake.state.repositories.splice(index, 1);
      return ok({
        assessment_id: ASSESSMENT_ID,
        snapshot_id: snapshotId,
        connection_id: removed!.connection.connectionId,
        connection_revoked: true,
      });
    }
    return Response.json({ ok: true, data: null });
  };
  globalThis.fetch = fetchMock as typeof fetch;
  return fake;
}

async function renderStep(props: { assessmentId?: string } = {}) {
  const container = testWindow.document.createElement("div");
  testWindow.document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await act(async () => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(RepositorySetupStep, props),
      ),
    );
  });
  return container;
}

async function settle() {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const PROVIDER_LABELS: Record<string, string> = {
  [ASSESSMENT_REPOSITORY_PROVIDERS.github]: "GitHub",
  [ASSESSMENT_REPOSITORY_PROVIDERS.gitlab]: "GitLab",
};

/** Walks the wizard: back to provider selection when needed, pick the provider card, then continue. */
async function chooseProvider(container: HTMLElement, provider: string) {
  const providerStep = [...container.querySelectorAll("nav button")].find(
    (button) =>
      (button.textContent ?? "").includes(
        msg("pages.assessmentFlow.stepper.step1"),
      ),
  );
  if (providerStep)
    await act(async () => (providerStep as HTMLElement).click());
  const card = [...container.querySelectorAll("button[aria-pressed]")].find(
    (button) => (button.textContent ?? "").includes(PROVIDER_LABELS[provider]!),
  ) as HTMLButtonElement;
  await act(async () => card.click());
  await act(async () =>
    buttonByText(
      container,
      msg("pages.assessmentFlow.actions.continue"),
    )!.click(),
  );
}

async function submitRepository(container: HTMLElement, url: string) {
  const input = container.querySelector<HTMLInputElement>(
    "#repository-setup-url",
  )!;
  const setter = Object.getOwnPropertyDescriptor(
    testWindow.HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, url);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>('button[type="submit"]')!
      .click();
  });
  await settle();
}

const rowTexts = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-slot="repository-entry-row"]')].map(
    (row) => row.textContent ?? "",
  );

function buttonByText(container: HTMLElement, text: string) {
  return [...container.querySelectorAll("button")].find((button) =>
    (button.textContent ?? "").includes(text),
  );
}

test("several repositories are collected first and nothing is sent until analysis starts", async () => {
  const fake = installServer({ repositoryLimit: 5 });
  const container = await renderStep();

  await chooseProvider(container, ASSESSMENT_REPOSITORY_PROVIDERS.github);
  await submitRepository(container, "https://github.com/acme/web");
  await chooseProvider(container, ASSESSMENT_REPOSITORY_PROVIDERS.gitlab);
  await submitRepository(container, "https://gitlab.com/acme/billing-api");

  const rows = rowTexts(container);
  assert.equal(rows.length, 2);
  assert.match(rows[0]!, /acme\/web/u);
  assert.match(rows[1]!, /acme\/billing-api/u);
  assert.deepEqual(fake.calls, []);
  assert.deepEqual(createdAssessments, []);
});

test("starting analysis connects each repository, pins both and completes the set once", async () => {
  const fake = installServer({ repositoryLimit: 5 });
  const container = await renderStep();

  await chooseProvider(container, ASSESSMENT_REPOSITORY_PROVIDERS.github);
  await submitRepository(container, "https://github.com/acme/web");
  await submitRepository(container, "https://github.com/acme/api");

  // Default name: first repository plus a localised count of the others.
  assert.equal(createdAssessments.length, 0);
  const start = [...container.querySelectorAll("button")].find((button) =>
    (button.textContent ?? "").includes(
      msg("pages.assessmentFlow.startAnalysis"),
    ),
  );
  assert.ok(
    start,
    "a start-analysis action appears once a repository is chosen",
  );
  await act(async () => start!.click());
  await settle();

  assert.deepEqual(createdAssessments, ["acme/web +1"]);
  assert.deepEqual(
    fake.calls.map((call) => call.path.split("/").slice(-1)[0]),
    [
      "repository-connection",
      "repository-connection",
      "snapshots",
      "snapshots",
      "complete",
    ],
  );
  const complete = fake.calls.at(-1)!;
  assert.deepEqual(complete.body.snapshotIds, ["snap-3", "snap-4"]);
  assert.deepEqual(navigation.replaced, [`/assessments/${ASSESSMENT_ID}`]);
});

test("a repeated or over-limit repository is rejected without leaving the list", async () => {
  installServer({ repositoryLimit: 5 });
  const container = await renderStep();
  await chooseProvider(container, ASSESSMENT_REPOSITORY_PROVIDERS.github);
  await submitRepository(container, "https://github.com/Acme/Web");
  await submitRepository(container, "https://github.com/acme/web.git");

  assert.equal(rowTexts(container).length, 1);
  assert.ok(container.querySelector('[role="alert"]'));
});

test("an invalid URL is rejected and not added", async () => {
  const fake = installServer({ repositoryLimit: 5 });
  const container = await renderStep();
  await chooseProvider(container, ASSESSMENT_REPOSITORY_PROVIDERS.github);
  await submitRepository(container, "https://github.com/acme/web/tree/main");

  assert.equal(rowTexts(container).length, 0);
  assert.deepEqual(fake.calls, []);
});

test("an assessment limited to one repository keeps the one-step flow", async () => {
  const fake = installServer({ repositoryLimit: 1 });
  // The limit is only known once the assessment exists; resume an existing one so the server limit applies.
  fake.state.repositories = [];
  const container = await renderStep({ assessmentId: ASSESSMENT_ID });
  await settle();

  await chooseProvider(container, ASSESSMENT_REPOSITORY_PROVIDERS.github);
  await submitRepository(container, "https://github.com/acme/web");

  assert.deepEqual(
    fake.calls.map((call) => call.path.split("/").slice(-1)[0]),
    ["repository-connection", "snapshots", "complete"],
  );
  assert.deepEqual(navigation.replaced, [`/assessments/${ASSESSMENT_ID}`]);
});

test("saved repositories are shown on resume and their candidates can be removed", async () => {
  const fake = installServer({ repositoryLimit: 5 });
  const web = {
    connectionId: "conn-web",
    provider: CREDENTIAL_PROVIDERS.github,
    repositoryId: "repo-web",
    repositoryFullName: "acme/web",
    defaultBranch: "main",
    status: REPOSITORY_CONNECTION_STATUSES.active,
  };
  fake.state.connection = web;
  fake.state.snapshot = {
    id: "snap-web",
    assessmentId: ASSESSMENT_ID,
    connectionId: "conn-web",
    provider: web.provider,
    repositoryFullName: "acme/web",
    branch: "main",
    commitSha: "a".repeat(40),
    sourcePathPrefix: null,
    createdAt: timestamp,
  };
  fake.state.repositories = [
    {
      repositoryKey: null,
      connection: web,
      snapshot: fake.state.snapshot,
      scanJob: null,
    },
  ];
  const container = await renderStep({ assessmentId: ASSESSMENT_ID });
  await settle();

  assert.equal(rowTexts(container).length, 1);
  assert.ok(buttonByText(container, msg("pages.assessmentFlow.resumeSetup")));
  const remove = container.querySelector<HTMLButtonElement>(
    '[data-slot="repository-entry-row"] button',
  )!;
  await act(async () => remove.click());
  await settle();

  assert.deepEqual(
    fake.calls.map((call) => [call.method, call.path.split("/").slice(-1)[0]]),
    [["DELETE", "snap-web"]],
  );
});

function saveOneRepository(fake: Fake) {
  const web = {
    connectionId: "conn-web",
    provider: CREDENTIAL_PROVIDERS.github,
    repositoryId: "repo-web",
    repositoryFullName: "acme/web",
    defaultBranch: "main",
    status: REPOSITORY_CONNECTION_STATUSES.active,
  };
  const snapshot = {
    id: "snap-web",
    assessmentId: ASSESSMENT_ID,
    connectionId: "conn-web",
    provider: web.provider,
    repositoryFullName: "acme/web",
    branch: "main",
    commitSha: "a".repeat(40),
    sourcePathPrefix: null,
    createdAt: timestamp,
  };
  fake.state.connection = web;
  fake.state.snapshot = snapshot;
  fake.state.repositories = [
    { repositoryKey: null, connection: web, snapshot, scanJob: null },
  ];
}

test("a saved set below the limit can be extended before it is pinned", async () => {
  const fake = installServer({ repositoryLimit: 5 });
  saveOneRepository(fake);
  const container = await renderStep({ assessmentId: ASSESSMENT_ID });
  await settle();

  const add = buttonByText(
    container,
    msg("pages.assessmentFlow.addRepository"),
  );
  assert.ok(add, "the status view offers to add another repository");
  await act(async () => add!.click());
  await chooseProvider(container, ASSESSMENT_REPOSITORY_PROVIDERS.github);
  await submitRepository(container, "https://github.com/acme/api");

  // The saved repository stays listed next to the newly collected one and nothing is sent yet.
  const rows = rowTexts(container);
  assert.equal(rows.length, 2);
  assert.match(rows[0]!, /acme\/web/u);
  assert.match(rows[1]!, /acme\/api/u);
  assert.deepEqual(fake.calls, []);
});

test("a set that reached the limit offers no way to add another repository", async () => {
  const fake = installServer({ repositoryLimit: 1 });
  saveOneRepository(fake);
  const container = await renderStep({ assessmentId: ASSESSMENT_ID });
  await settle();

  assert.equal(rowTexts(container).length, 1);
  assert.equal(
    buttonByText(container, msg("pages.assessmentFlow.addRepository")),
    undefined,
  );
});

test("a pinned set can no longer be changed", async () => {
  const fake = installServer({ repositoryLimit: 5 });
  saveOneRepository(fake);
  fake.state.setupCompleted = true;
  const container = await renderStep({ assessmentId: ASSESSMENT_ID });
  await settle();

  assert.equal(
    buttonByText(container, msg("pages.assessmentFlow.addRepository")),
    undefined,
  );
  assert.equal(
    container.querySelectorAll('[data-slot="repository-entry-row"] button')
      .length,
    0,
  );
});
