import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { AUTH_USER_ROLES, USER_ACCESS_STATUSES } from "@lcsp/contracts/auth";
import { hashSecretSync } from "../src/modules/auth/infrastructure/security/security.utils.ts";

/**
 * Seeds user accounts to match realistic scale for Frame 45 / 46 demonstrations:
 * - 842 Active users
 * - 34 Suspended users
 * (Total: 876 users, including 36 created within last 30 days)
 *
 * Ensures Frame 45 Collection Insight Strip (876 total, 842 active, 34 suspended, 36 new)
 * reflects real database counts directly from the backend API.
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg(connectionString),
  });

  console.log("Seeding realistic user population (876 accounts)...");

  // Current counts
  const currentTotal = await prisma.user.count();
  const currentActive = await prisma.user.count({
    where: { accessStatus: "ACTIVE" },
  });
  const currentSuspended = await prisma.user.count({
    where: { accessStatus: "SUSPENDED" },
  });

  console.log(
    `Current state: Total=${currentTotal}, Active=${currentActive}, Suspended=${currentSuspended}`,
  );

  const targetActive = 842;
  const targetSuspended = 34;

  const activeToAdd = Math.max(0, targetActive - currentActive);
  const suspendedToAdd = Math.max(0, targetSuspended - currentSuspended);

  const defaultPasswordHash = hashSecretSync("Password@123");
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 3600 * 1000;

  // Batch insert active users in chunks
  const batchSize = 100;
  if (activeToAdd > 0) {
    console.log(
      `Adding ${activeToAdd} active users in batches of ${batchSize}...`,
    );
    for (let i = 0; i < activeToAdd; i += batchSize) {
      const count = Math.min(batchSize, activeToAdd - i);
      const data = Array.from({ length: count }).map((_, idx) => {
        const userIndex = currentActive + i + idx + 1;
        // make ~36 users within last 30 days
        const isRecent = userIndex <= 36;
        const createdAt = isRecent
          ? new Date(
              now - Math.floor(Math.random() * (thirtyDaysMs - 86400000)),
            )
          : new Date(
              now -
                thirtyDaysMs -
                Math.floor(Math.random() * 180 * 24 * 3600 * 1000),
            );

        return {
          id: randomUUID(),
          email: `user.active${userIndex}@lcsp.vn`,
          displayName: `Customer User ${userIndex}`,
          passwordHash: defaultPasswordHash,
          emailVerified: true,
          failedLoginCount: 0,
          role: "CUSTOMER",
          accessStatus: "ACTIVE",
          accessVersion: 1,
          createdAt,
          updatedAt: createdAt,
        };
      });

      await prisma.user.createMany({ data });
    }
  }

  // Batch insert suspended users
  if (suspendedToAdd > 0) {
    console.log(`Adding ${suspendedToAdd} suspended users...`);
    const data = Array.from({ length: suspendedToAdd }).map((_, idx) => {
      const userIndex = currentSuspended + idx + 1;
      const createdAt = new Date(
        now - Math.floor(Math.random() * 90 * 24 * 3600 * 1000),
      );
      return {
        id: randomUUID(),
        email: `user.suspended${userIndex + 10}@lcsp.vn`,
        displayName: `Suspended Account ${userIndex}`,
        passwordHash: defaultPasswordHash,
        emailVerified: true,
        failedLoginCount: 0,
        role: "CUSTOMER",
        accessStatus: "SUSPENDED",
        accessVersion: 2,
        createdAt,
        updatedAt: createdAt,
      };
    });

    await prisma.user.createMany({ data });
  }

  const newTotal = await prisma.user.count();
  const newActive = await prisma.user.count({
    where: { accessStatus: "ACTIVE" },
  });
  const newSuspended = await prisma.user.count({
    where: { accessStatus: "SUSPENDED" },
  });

  console.log(
    `Seeding complete: Total=${newTotal}, Active=${newActive}, Suspended=${newSuspended}`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Failed to seed user population:", err);
  process.exit(1);
});
