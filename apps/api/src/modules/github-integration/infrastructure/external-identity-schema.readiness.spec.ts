import { describe, expect, it, jest } from "@jest/globals";

import type { PrismaService } from "../../../infrastructure/prisma/prisma.service.js";
import { isExternalIdentitySchemaCompatible } from "./external-identity-schema.readiness.js";

const COMPATIBLE_COLUMNS = [
  {
    columnName: "providerAccountId",
    dataType: "bigint",
    isNullable: "YES",
  },
  {
    columnName: "providerAccountExternalId",
    dataType: "text",
    isNullable: "YES",
  },
];

function prismaWithResults(...results: unknown[]) {
  return {
    $queryRaw: jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockImplementation(() => Promise.resolve(results.shift())),
  } as unknown as PrismaService;
}

describe("external credential identity schema readiness", () => {
  it("requires compatible external identity columns and the migration constraint", async () => {
    const prisma = prismaWithResults(COMPATIBLE_COLUMNS, [
      { identityConstraintPresent: true },
    ]);

    await expect(isExternalIdentitySchemaCompatible(prisma)).resolves.toBe(
      true,
    );
  });

  it.each([
    ["missing external column", [COMPATIBLE_COLUMNS[0]]],
    [
      "non-nullable numeric column",
      [{ ...COMPATIBLE_COLUMNS[0], isNullable: "NO" }, COMPATIBLE_COLUMNS[1]],
    ],
    [
      "incorrect external column type",
      [COMPATIBLE_COLUMNS[0], { ...COMPATIBLE_COLUMNS[1], dataType: "uuid" }],
    ],
  ])("rejects %s", async (_label, columns) => {
    await expect(
      isExternalIdentitySchemaCompatible(
        prismaWithResults(columns, [{ identityConstraintPresent: true }]),
      ),
    ).resolves.toBe(false);
  });

  it("rejects a schema missing the migration identity constraint", async () => {
    await expect(
      isExternalIdentitySchemaCompatible(
        prismaWithResults(COMPATIBLE_COLUMNS, [
          { identityConstraintPresent: false },
        ]),
      ),
    ).resolves.toBe(false);
  });

  it("fails closed when database metadata cannot be queried", async () => {
    const prisma = {
      $queryRaw: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockRejectedValue(new Error("database unavailable")),
    } as unknown as PrismaService;

    await expect(isExternalIdentitySchemaCompatible(prisma)).resolves.toBe(
      false,
    );
  });
});
