import { describe, expect, it, jest } from "@jest/globals";
import type { ExecutionContext } from "@nestjs/common";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import { GitHubCredentialRequestGuard } from "./github-credential-request.guard.js";

describe("GitHubCredentialRequestGuard expired-window retention", () => {
  it("releases expired user windows when later users arrive", () => {
    const clock = jest.spyOn(Date, "now");
    const guard = new GitHubCredentialRequestGuard();
    try {
      clock.mockReturnValue(0);
      for (let index = 0; index < 100; index += 1) {
        guard.canActivate(contextFor(`user-${index}`));
      }
      clock.mockReturnValue(61_000);
      guard.canActivate(contextFor("new-user"));

      // Why: A process-wide credential guard must not retain every historical
      // customer forever after each rate-limit window expires.
      const retained = (guard as unknown as { windows: Map<string, unknown> })
        .windows;
      expect(retained.size).toBeLessThanOrEqual(1);
    } finally {
      clock.mockRestore();
    }
  });
});

function contextFor(userId: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { "content-type": "application/json" },
        body: { credential: "fixture" },
        rbacContext: { userId, role: AUTH_USER_ROLES.customer },
      }),
    }),
  } as unknown as ExecutionContext;
}
