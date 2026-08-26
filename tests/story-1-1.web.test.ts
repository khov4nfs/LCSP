import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  buildBlockedAuthViewModel,
  PUBLIC_ENTRY_ROUTES,
} from "@lcsp/web/auth-entry";
import { resolveProtectedWorkspaceRoute } from "@lcsp/web/workspace-routes";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import {
  getWorkspaceRouteRedirectPath,
  isProtectedWorkspacePath,
} from "@lcsp/web/workspace-route-middleware";

test("server-side route middleware redirects unauthenticated workspace routes before render", () => {
  const redirectPath = getWorkspaceRouteRedirectPath({
    pathname: "/workspace",
    search: "?organization_id=org-1",
    hasSession: false,
  });

  assert.equal(isProtectedWorkspacePath("/workspace/settings"), true);
  assert.equal(isProtectedWorkspacePath("/assessments/new"), true);
  assert.equal(
    redirectPath,
    `${PUBLIC_ENTRY_ROUTES.signIn}?next=%2Fworkspace%3Forganization_id%3Dorg-1`,
  );
});

test("server-side route middleware allows protected routes only when session cookie exists", () => {
  assert.equal(
    getWorkspaceRouteRedirectPath({
      pathname: "/workspace",
      search: "",
      hasSession: true,
    }),
    null,
  );
  assert.equal(
    getWorkspaceRouteRedirectPath({
      pathname: "/sign-in",
      search: "",
      hasSession: false,
    }),
    null,
  );
});

test("protected web route redirects to sign-in and renders no workspace data", () => {
  const route = resolveProtectedWorkspaceRoute({
    apiWorkspaceResult: {
      ok: false,
      problem: {
        type: "auth/auth-required",
        status: 401,
        code: AUTH_ERROR_CODES.authRequired,
        titleKey: "auth.errors.authRequired.title",
        detailKey: "auth.errors.authRequired.detail",
        requiredAction: "sign_in",
        correlationId: "corr-auth",
      },
    },
    clientCapabilities: {
      can_view_workspace: true,
    },
  });

  assert.equal(route.redirect, PUBLIC_ENTRY_ROUTES.signIn);
  assert.equal(route.render_workspace, false);
  assert.equal(route.workspace_payload, null);
});

test("blocked state copy stays safe and exposes a clear next action", () => {
  const viewModel = buildBlockedAuthViewModel({
    ok: false,
    problem: {
      type: "authz/rbac-denied",
      status: 403,
      code: AUTH_ERROR_CODES.rbacDenied,
      titleKey: "auth.errors.rbacDenied.title",
      detailKey: "auth.errors.rbacDenied.detail",
      requiredAction: "contact_organization_owner",
      correlationId: "corr-1",
    },
  });

  assert.equal(viewModel.title, "Không có quyền thực hiện");
  assert.equal(viewModel.required_action, "contact_organization_owner");
  assert.doesNotMatch(JSON.stringify(viewModel), /policy|token|secret/i);
});

test("capability projection does not replace server enforcement", () => {
  const route = resolveProtectedWorkspaceRoute({
    apiWorkspaceResult: {
      ok: false,
      problem: {
        type: "auth/session-invalid",
        status: 401,
        code: AUTH_ERROR_CODES.sessionInvalid,
        titleKey: "auth.errors.sessionInvalid.title",
        detailKey: "auth.errors.sessionInvalid.detail",
        requiredAction: "sign_in",
        correlationId: "corr-session",
      },
    },
    clientCapabilities: {
      can_view_workspace: true,
      source: "local-ui-state",
    },
  });

  assert.equal(route.render_workspace, false);
  assert.equal(route.redirect, PUBLIC_ENTRY_ROUTES.signIn);
});

test("authenticated blocked workspace state stays on page and surfaces required action", () => {
  const route = resolveProtectedWorkspaceRoute({
    apiWorkspaceResult: {
      ok: false,
      problem: {
        type: "authz/rbac-denied",
        status: 403,
        code: AUTH_ERROR_CODES.rbacDenied,
        titleKey: "auth.errors.rbacDenied.title",
        detailKey: "auth.errors.rbacDenied.detail",
        requiredAction: "contact_organization_owner",
        correlationId: "corr-2",
      },
    },
    clientCapabilities: {
      can_view_workspace: true,
    },
  });

  assert.equal(route.redirect, null);
  assert.equal(route.render_workspace, false);
  assert.equal(route.blocked_state.title, "Không có quyền thực hiện");
  assert.equal(
    route.blocked_state.required_action,
    "contact_organization_owner",
  );
});
