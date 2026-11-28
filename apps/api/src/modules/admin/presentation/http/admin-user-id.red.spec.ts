import "reflect-metadata";
import { describe, expect, it } from "@jest/globals";
import { ParseUUIDPipe } from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants.js";
import { AdminUsersController } from "./admin-users.controller.js";

describe("Admin user route ID RED regression", () => {
  it.each(["getUserDetail", "suspendUser", "restoreUser"])(
    "A-05 validates :id before dispatching %s",
    (method) => {
      // Why: Malformed user IDs currently reach the Admin query or transaction layer.
      // How: Inspect Nest's actual route argument metadata for an ID validation pipe.
      // Invariant: Invalid path IDs must fail at the HTTP boundary before CQRS dispatch.
      const metadata = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        AdminUsersController,
        method,
      ) as Record<string, { data?: string; pipes?: unknown[] }> | undefined;
      const idParam = Object.values(metadata ?? {}).find(
        (entry) => entry.data === "id",
      );
      expect(
        idParam?.pipes?.some((pipe) => pipe instanceof ParseUUIDPipe),
      ).toBe(true);
    },
  );
});
