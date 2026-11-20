import { describe, expect, it } from "@jest/globals";
import {
  SENSITIVE_ROUTE_IDS,
  matchSensitiveRoute,
  registerSensitiveRoute,
} from "./sensitive-route-policy.js";

describe("SensitiveRoutePolicy — Trailing Slash Bypass Reproducer", () => {
  it("matches sensitive route when incoming request has a trailing slash (RED reproducer)", () => {
    registerSensitiveRoute({
      routeId: SENSITIVE_ROUTE_IDS.mfaDisable,
      method: "POST",
      pathTemplate: "/api/auth/mfa/disable",
    });

    // Request with trailing slash must match the registered policy
    const match = matchSensitiveRoute("POST", "/api/auth/mfa/disable/");
    expect(match).toEqual({ routeId: SENSITIVE_ROUTE_IDS.mfaDisable });
  });

  it("matches sensitive route when template was registered with trailing slash and request has none (RED reproducer)", () => {
    registerSensitiveRoute({
      routeId: SENSITIVE_ROUTE_IDS.mfaRecoveryCodesGenerate,
      method: "POST",
      pathTemplate: "/api/auth/mfa/recovery-codes/",
    });

    const match = matchSensitiveRoute("POST", "/api/auth/mfa/recovery-codes");
    expect(match).toEqual({
      routeId: SENSITIVE_ROUTE_IDS.mfaRecoveryCodesGenerate,
    });
  });

  it("preserves root path '/' without collapsing to empty string", () => {
    registerSensitiveRoute({
      routeId: "ROOT_SENSITIVE",
      method: "GET",
      pathTemplate: "/",
    });

    const match = matchSensitiveRoute("GET", "/");
    expect(match).toEqual({ routeId: "ROOT_SENSITIVE" });
  });
});
