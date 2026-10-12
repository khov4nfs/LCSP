import { describe, expect, it, jest } from "@jest/globals";
import { LEGAL_SOURCE_LIFECYCLE_STATUSES } from "@lcsp/contracts/legal-source";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { toPrismaLegalSourceLifecycleStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { GetActiveLegalSourceHandler } from "./get-active-legal-source.handler.js";

describe("GetActiveLegalSourceHandler", () => {
  it("returns the latest approved legalSource from persistence", async () => {
    const activatedAt = new Date("2026-08-11T00:00:00.000Z");
    const prisma = {
      legalSourceVersion: {
        findFirst: jest
          .fn<
            () => Promise<{
              id: string;
              version: string;
              status: ReturnType<typeof toPrismaLegalSourceLifecycleStatus>;
              createdAt: Date;
              activatedAt: Date;
            } | null>
          >()
          .mockResolvedValue({
            id: "legalSource-v1",
            version: "VN-LEGAL-2026-08",
            status: toPrismaLegalSourceLifecycleStatus(
              LEGAL_SOURCE_LIFECYCLE_STATUSES.active,
            ),
            createdAt: new Date("2026-08-10T00:00:00.000Z"),
            activatedAt,
          }),
      },
    } as unknown as PrismaService;

    const handler = new GetActiveLegalSourceHandler(prisma);
    const result = await handler.execute();

    expect(result).toEqual({
      versionId: "legalSource-v1",
      version: "VN-LEGAL-2026-08",
      status: LEGAL_SOURCE_LIFECYCLE_STATUSES.active,
      effectiveDate: activatedAt.toISOString(),
    });
  });
});
