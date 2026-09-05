import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

const componentPath = new URL(
  "../src/features/settings/components/organisms/repositories-settings-section.tsx",
  import.meta.url,
);
const credentialDialogPath = new URL(
  "../src/features/settings/components/molecules/provider-credential-dialog.tsx",
  import.meta.url,
);
const queriesPath = new URL(
  "../src/lib/api/github-repository-queries.ts",
  import.meta.url,
);
const queryKeysPath = new URL("../src/lib/api/query-keys.ts", import.meta.url);

async function source() {
  return readFile(componentPath, "utf8");
}

test("Settings repository section contains credential-only controls and safe status", async () => {
  const component = await source();
  assert.match(component, /data-component="ConnectorsSettingsPanel"/);
  assert.match(component, /data-component="ConnectorProviderList"/);
  assert.match(component, /githubPatAccessTitle/);
  assert.match(component, /repositoryReadAccess/);
  assert.doesNotMatch(
    component,
    /id="provider-credential"|type="password"|glpat-|ghp_|repositoryUrl|connectedRepositories|auth\/repositories/,
  );
});

test("Settings repository section supports provider rows and never renders a stored PAT", async () => {
  const component = await source();
  assert.match(component, /githubProvider/);
  assert.match(component, /gitlabProvider/);
  assert.match(component, /bitbucketProvider/);
  assert.match(component, /azureDevOpsProvider/);
  assert.match(component, /logo-github\.svg/);
  assert.match(component, /logo-gitlab\.svg/);
  assert.match(component, /logo-bitbucket\.svg/);
  assert.match(component, /logo-azure-devops\.svg/);
  assert.doesNotMatch(component, /Personal access token value/);
});

test("provider credential input is isolated in the credential dialog", async () => {
  const dialog = await readFile(credentialDialogPath, "utf8");
  assert.match(dialog, /provider-credential/);
  assert.match(dialog, /type="password"/);
  assert.match(dialog, /autoComplete="new-password"/);
  assert.match(dialog, /value={credential}/);
  assert.doesNotMatch(dialog, /defaultValue=/);
});

test("initial configure and rotation refresh the shared provider credential status query", async () => {
  const [queries, queryKeys] = await Promise.all([
    readFile(queriesPath, "utf8"),
    readFile(queryKeysPath, "utf8"),
  ]);

  assert.match(
    queryKeys,
    /providerCredentials:\s*\(\)\s*=>\s*\["provider-credentials"\]\s*as const/,
  );
  assert.equal(
    queries.match(/apiQueryKeys\.githubIntegration\.providerCredentials\(\)/g)
      ?.length,
    2,
  );
  assert.match(
    queries,
    /onSuccess:\s*async\s*\(\)\s*=>\s*{[\s\S]*?invalidateQueries\([\s\S]*?providerCredentials\(\)/,
  );
});

test("successful credential submission clears the plaintext PAT without exposing it", async () => {
  const dialog = await readFile(credentialDialogPath, "utf8");
  assert.match(dialog, /function handleMutationSuccess\(\)\s*{\s*setCredential\(""\)/);
  assert.match(dialog, /type="password"/);
  assert.doesNotMatch(dialog, /setCredential\([^"e]/);
});

test("reauthentication retries the pending credential update", async () => {
  const component = await readFile(credentialDialogPath, "utf8");
  assert.match(component, /onReauthenticate\?\.\(\(\)\s*=>\s*{/);
  assert.match(
    component,
    /queueMicrotask\(\(\)\s*=>\s*{[\s\S]*?submitCredential\(submittedCredential\)/,
  );
});

test("provider credential dialog has explicit connect, manage, and update modes", async () => {
  const dialog = await readFile(credentialDialogPath, "utf8");
  const connectors = await source();

  assert.match(dialog, /PROVIDER_CREDENTIAL_DIALOG_MODES\s*=\s*{/);
  assert.match(dialog, /connect:\s*"connect"/);
  assert.match(dialog, /manage:\s*"manage"/);
  assert.match(dialog, /update:\s*"update"/);
  assert.match(dialog, /data-mode={mode}/);
  assert.match(connectors, /mode:\s*ProviderCredentialDialogMode/);
  assert.match(connectors, /PROVIDER_CREDENTIAL_DIALOG_MODES\.connect/);
  assert.match(connectors, /PROVIDER_CREDENTIAL_DIALOG_MODES\.manage/);
  assert.match(connectors, /PROVIDER_CREDENTIAL_DIALOG_MODES\.update/);
});

test("provider rows select mode from configured status and disconnected GitHub has no active update action", async () => {
  const connectors = await source();

  assert.match(
    connectors,
    /configured[\s\S]*?\? PROVIDER_CREDENTIAL_DIALOG_MODES\.manage[\s\S]*?: PROVIDER_CREDENTIAL_DIALOG_MODES\.connect/,
  );
  assert.match(connectors, /disabled={!githubConfigured}/);
  assert.match(
    connectors,
    /onClick=\{\(\) =>[\s\S]*?openCredentialDialog\(\s*CREDENTIAL_PROVIDERS\.github,\s*PROVIDER_CREDENTIAL_DIALOG_MODES\.update/,
  );
});

test("provider credential dialog uses provider-specific Figma titles, not generic copy", async () => {
  const [dialog, en, vi] = await Promise.all([
    readFile(credentialDialogPath, "utf8"),
    readFile(
      new URL("../../../packages/i18n/src/locales/en/pages.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../../../packages/i18n/src/locales/vi/pages.ts", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(dialog, /connectGithubTitle/);
  assert.match(dialog, /manageGithubPatTitle/);
  assert.match(dialog, /updateGithubPatTitle/);
  assert.match(dialog, /connectGitlabTitle/);
  assert.match(dialog, /manageGitlabPatTitle/);
  assert.match(dialog, /updateGitlabPatTitle/);
  assert.match(dialog, /connectBitbucketTitle/);
  assert.match(dialog, /manageBitbucketPatTitle/);
  assert.match(dialog, /updateBitbucketPatTitle/);
  assert.match(dialog, /connectAzureDevOpsTitle/);
  assert.match(dialog, /manageAzureDevOpsPatTitle/);
  assert.match(dialog, /updateAzureDevOpsPatTitle/);
  assert.doesNotMatch(dialog, /patDialogTitle|Provider credential/);
  assert.doesNotMatch(en, /patDialogTitle:\s*"Provider credential"/);
  assert.doesNotMatch(vi, /patDialogTitle:\s*"Provider credential"/);
});

test("manage and update modes do not fabricate PAT, username, or repository scopes", async () => {
  const dialog = await readFile(credentialDialogPath, "utf8");

  assert.match(dialog, /status\?\.account\?\.username/);
  assert.match(dialog, /credentialStoredSecurely/);
  assert.match(dialog, /repositoryAccessConfigured/);
  assert.doesNotMatch(dialog, /connected-user|abcd|Read \+ Write/);
});

test("credential mutation submits only provider and credential", async () => {
  const dialog = await readFile(credentialDialogPath, "utf8");

  assert.match(dialog, /mutation\.mutate\(\s*\{\s*provider,\s*credential:\s*submittedCredential\s*\}/);
  assert.doesNotMatch(dialog, /username:\s*/);
});

test("credential dialog uses Figma desktop shell and right-aligned footer buttons", async () => {
  const dialog = await readFile(credentialDialogPath, "utf8");

  assert.match(dialog, /h-\[430px\]/);
  assert.match(dialog, /max-w-140/);
  assert.match(dialog, /p-6/);
  assert.match(dialog, /size-7/);
  assert.match(dialog, /h-11/);
  assert.match(dialog, /h-16\.5/);
  assert.match(dialog, /flex-row justify-end gap-2\.5/);
  assert.doesNotMatch(dialog, /max-w-md/);
});

test("all 4 git providers are supported in connector list and disabled state respects option.supported", async () => {
  const connectors = await source();

  assert.match(connectors, /githubProvider[\s\S]*?supported:\s*true/);
  assert.match(connectors, /gitlabProvider[\s\S]*?supported:\s*true/);
  assert.match(connectors, /bitbucketProvider[\s\S]*?supported:\s*true/);
  assert.match(connectors, /azureDevOpsProvider[\s\S]*?supported:\s*true/);
  assert.match(connectors, /disabled={!option\.supported}/);
});
