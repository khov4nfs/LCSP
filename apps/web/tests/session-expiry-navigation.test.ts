import * as assert from "node:assert/strict";
import { test } from "node:test";
import { AUTH_ERROR_CODES, REQUIRED_ACTIONS } from "@lcsp/contracts/auth";

import {
  isExpiredSessionProblem,
  isSessionEstablishmentProblem,
  signInRedirectForCurrentLocation,
} from "../src/lib/api/api-request.ts";
import { problemEnvelope } from "../src/lib/api/problem-envelope.ts";

test("expired API sessions redirect refresh flows back to sign-in with next path", () => {
  assert.equal(isExpiredSessionProblem(AUTH_ERROR_CODES.authRequired), true);
  assert.equal(isExpiredSessionProblem(AUTH_ERROR_CODES.sessionInvalid), true);
  assert.equal(
    isExpiredSessionProblem(AUTH_ERROR_CODES.accountSuspended),
    true,
  );
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
      search: "?section=connectors",
    }),
    "/sign-in?next=%2Fworkspace%2Fsettings%3Fsection%3Dconnectors",
  );
  assert.equal(
    signInRedirectForCurrentLocation({
      pathname: "/sign-in",
      search: "",
    }),
    "/sign-in",
  );
});

test("problemJson and resultJson clear session cookie on accountSuspended, sessionInvalid, and authRequired", async () => {
  const { problemJson, resultJson } = await import(
    "../src/lib/server/problem-json.ts"
  );
  const { SESSION_COOKIE_NAME } = await import(
    "../src/lib/session/session-store.ts"
  );

  for (const code of [
    AUTH_ERROR_CODES.accountSuspended,
    AUTH_ERROR_CODES.sessionInvalid,
    AUTH_ERROR_CODES.authRequired,
  ]) {
    const problemResponse = problemJson(code, { status: 403 });
    const cookie = problemResponse.cookies.get(SESSION_COOKIE_NAME);
    const setCookie = problemResponse.headers.get("set-cookie") ?? "";
    assert.equal(
      cookie?.value === "" || setCookie.includes(`${SESSION_COOKIE_NAME}=;`),
      true,
      `problemJson must delete session cookie for ${code}`,
    );

    const resultResponse = resultJson(
      problemEnvelope(code, 403),
      { status: 403 },
    );
    const resultCookie = resultResponse.cookies.get(SESSION_COOKIE_NAME);
    const resultSetCookie = resultResponse.headers.get("set-cookie") ?? "";
    assert.equal(
      resultCookie?.value === "" ||
        resultSetCookie.includes(`${SESSION_COOKIE_NAME}=;`),
      true,
      `resultJson must delete session cookie for ${code}`,
    );
  }

  const normalResponse = problemJson(AUTH_ERROR_CODES.invalidCredentials, {
    status: 401,
  });
  assert.equal(
    normalResponse.cookies.get(SESSION_COOKIE_NAME),
    undefined,
    "problemJson must not delete session cookie for invalidCredentials",
  );
});
