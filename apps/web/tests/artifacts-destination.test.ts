import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../src/", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("Artifacts destination is wired through the redesigned shell", async () => {
  const [route, shell, sidebar, page] = await Promise.all([
    read("app/(workspace)/artifacts/page.tsx"),
    read("features/workspace/components/organisms/app-shell.tsx"),
    read("features/workspace/components/organisms/app-sidebar.tsx"),
    read("features/artifacts/components/artifacts-page.tsx"),
  ]);

  assert.match(route, /ArtifactsPage/);
  assert.match(route, /process\.env\.NODE_ENV === "development"/);
  assert.match(route, /preview === "populated"/);
  assert.match(shell, /pathname === "\/artifacts"/);
  assert.match(sidebar, /href="\/artifacts"/);
  assert.match(sidebar, /artifactsActive/);
  assert.match(page, /pages\.artifacts\.tabs/);
  assert.match(page, /\/assessments\/new/);
  assert.match(page, /SearchIcon/);
  assert.match(page, /pages\.artifacts\.search/);
});

test("development preview supplies normalized Figma groups without production records", async () => {
  const [route, fixture, page] = await Promise.all([
    read("app/(workspace)/artifacts/page.tsx"),
    read("features/artifacts/dev/artifact-preview-fixtures.ts"),
    read("features/artifacts/components/artifacts-page.tsx"),
  ]);

  assert.match(route, /ARTIFACT_PREVIEW_GROUPS/);
  assert.match(fixture, /Payment AI compliance review/);
  assert.match(fixture, /Data retention policy audit/);
  assert.match(fixture, /Repository remediation review/);
  assert.match(fixture, /ArtifactGroup\[\]/);
  assert.match(page, /filterArtifactGroups/);
});

test("Artifacts shared contracts expose semantic refs and safe open targets", async () => {
  const [types, routes, item, empty] = await Promise.all([
    read("features/artifacts/types/artifact.types.ts"),
    read("features/artifacts/utils/artifact-routes.ts"),
    read("features/artifacts/components/artifact-list-item.tsx"),
    read("features/artifacts/components/artifact-empty-state.tsx"),
  ]);

  assert.match(types, /export type ArtifactRef/);
  assert.match(types, /assessmentId: string/);
  assert.match(types, /resourceId\?: string/);
  assert.match(routes, /ARTIFACT_OPEN_KINDS/);
  assert.match(routes, /UNSUPPORTED/);
  assert.match(item, /ArtifactStatusBadge/);
  assert.match(empty, /\/assessments\/new/);
});

test("Artifacts list supports empty and grouped populated states", async () => {
  const [list, empty, status] = await Promise.all([
    read("features/artifacts/components/artifact-list.tsx"),
    read("features/artifacts/components/artifact-empty-state.tsx"),
    read("features/artifacts/components/artifact-status-badge.tsx"),
  ]);

  assert.match(list, /groups\.map/);
  assert.match(list, /ArtifactListItem/);
  assert.match(empty, /emptyTitle/);
  assert.match(status, /ARTIFACT_STATUSES\.ready/);
});
