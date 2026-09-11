import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import {
  ADMIN_ROOT_PATH,
  ADMIN_USERS_PATH,
  getAdminRouteRedirectPath,
  isAdminPath,
} from "../src/admin-route-middleware.ts";
import {
  POST_AUTH_REDIRECT_PATHS,
  postAuthRedirectPath,
} from "../src/features/auth/utils/post-auth-redirect.ts";

test("Post-auth redirect policy: Admin enters the Admin surface and Customer enters the workspace", () => {
  assert.equal(
    postAuthRedirectPath(AUTH_USER_ROLES.admin),
    POST_AUTH_REDIRECT_PATHS.admin,
  );
  assert.equal(
    postAuthRedirectPath(AUTH_USER_ROLES.customer),
    POST_AUTH_REDIRECT_PATHS.customer,
  );
});

test("Admin route policy: path matcher classification", () => {
  assert.equal(isAdminPath("/admin"), true);
  assert.equal(isAdminPath("/admin/"), true);
  assert.equal(isAdminPath("/admin/users"), true);
  assert.equal(isAdminPath("/admin/users/user-123"), true);
  assert.equal(isAdminPath("/admin/overview"), true);

  assert.equal(isAdminPath("/workspace"), false);
  assert.equal(isAdminPath("/workspace/settings"), false);
  assert.equal(isAdminPath("/assessments/new"), false);
  assert.equal(isAdminPath("/sign-in"), false);
  assert.equal(isAdminPath("/"), false);
});

test("Admin route policy: unauthenticated visitors are redirected to sign-in preserving next path and query", () => {
  // 1. Root /admin
  const redirectRoot = getAdminRouteRedirectPath({
    pathname: "/admin",
    search: "",
    hasSession: false,
  });
  assert.equal(redirectRoot, "/sign-in?next=%2Fadmin");

  // 2. /admin/users
  const redirectUsers = getAdminRouteRedirectPath({
    pathname: "/admin/users",
    search: "",
    hasSession: false,
  });
  assert.equal(redirectUsers, "/sign-in?next=%2Fadmin%2Fusers");

  // 3. /admin/users/:id with search params preserved
  const redirectDetail = getAdminRouteRedirectPath({
    pathname: "/admin/users/usr-abc-456",
    search: "?tab=audit&filter=active",
    hasSession: false,
  });
  assert.equal(
    redirectDetail,
    "/sign-in?next=%2Fadmin%2Fusers%2Fusr-abc-456%3Ftab%3Daudit%26filter%3Dactive",
  );
});

test("Admin route policy: non-admin roles are redirected to customer workspace", () => {
  const redirectCustomer = getAdminRouteRedirectPath({
    pathname: "/admin/users",
    search: "",
    hasSession: true,
    userRole: AUTH_USER_ROLES.customer,
  });
  assert.equal(redirectCustomer, "/workspace");

  const redirectCustomerDetail = getAdminRouteRedirectPath({
    pathname: "/admin/users/usr-789",
    search: "",
    hasSession: true,
    userRole: AUTH_USER_ROLES.customer,
  });
  assert.equal(redirectCustomerDetail, "/workspace");
});

test("Admin route policy: verified Admin navigating to /admin landing is forwarded to /admin/users", () => {
  const redirectLanding = getAdminRouteRedirectPath({
    pathname: "/admin",
    search: "",
    hasSession: true,
    userRole: AUTH_USER_ROLES.admin,
  });
  assert.equal(redirectLanding, "/admin/users");

  const redirectTrailingSlash = getAdminRouteRedirectPath({
    pathname: "/admin/",
    search: "",
    hasSession: true,
    userRole: AUTH_USER_ROLES.admin,
  });
  assert.equal(redirectTrailingSlash, "/admin/users");
});

test("Admin route policy: verified Admin is allowed into /admin/users and child routes with 0 redirect", () => {
  const allowUsersList = getAdminRouteRedirectPath({
    pathname: "/admin/users",
    search: "",
    hasSession: true,
    userRole: AUTH_USER_ROLES.admin,
  });
  assert.equal(allowUsersList, null);

  const allowUserDetail = getAdminRouteRedirectPath({
    pathname: "/admin/users/usr-123",
    search: "",
    hasSession: true,
    userRole: AUTH_USER_ROLES.admin,
  });
  assert.equal(allowUserDetail, null);
});

test("Admin route policy: non-admin paths return null without interfering", () => {
  const nonAdminResult = getAdminRouteRedirectPath({
    pathname: "/workspace",
    search: "",
    hasSession: true,
    userRole: AUTH_USER_ROLES.admin,
  });
  assert.equal(nonAdminResult, null);
});
