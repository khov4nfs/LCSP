import * as assert from "node:assert/strict";
import { test } from "node:test";
import { AUTH_ERROR_CODES, REQUIRED_ACTIONS } from "@lcsp/contracts/auth";

import {
  isExpiredSessionProblem,
  isSessionEstablishmentProblem,
  signInRedirectForCurrentLocation,
} from "../src/lib/api/api-request.ts";

test("expired API sessions redirect refresh flows back to sign-in with next path", () => {
  assert.equal(isExpiredSessionProblem(AUTH_ERROR_CODES.authRequired), true);
  assert.equal(isExpiredSessionProblem(AUTH_ERROR_CODES.sessionInvalid), true);
  assert.equal(
    isExpiredSessionProblem(undefined, REQUIRED_ACTIONS.signIn),
    true,
  );
  assert.equal(
    isExpiredSessionProblem(AUTH_ERROR_CODES.invalidCredentials),
    false,
  );
  assert.equal(
    isSessionEstablishmentProblem(
      "/api/auth/profile",
      AUTH_ERROR_CODES.rbacDenied,
      REQUIRED_ACTIONS.contactOwner,
    ),
    true,
  );
  assert.equal(
    isSessionEstablishmentProblem(
      "/api/assessments",
      AUTH_ERROR_CODES.rbacDenied,
      REQUIRED_ACTIONS.contactOwner,
    ),
    false,
  );
  assert.equal(
    signInRedirectForCurrentLocation({
      pathname: "/workspace/settings",
      search: "?section=repositories",
    }),
    "/sign-in?next=%2Fworkspace%2Fsettings%3Fsection%3Drepositories",
  );
  assert.equal(
    signInRedirectForCurrentLocation({
      pathname: "/sign-in",
      search: "",
    }),
    "/sign-in",
  );
});
