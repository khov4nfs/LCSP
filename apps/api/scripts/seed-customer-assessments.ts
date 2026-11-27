import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/**
 * Seeds assessment and audit activity for demonstration users so that:
 * 1. AdminUserDetail (Frame 46) displays realistic Usage Summary (3 assessments, latest execution date).
 * 2. Recent assessment activity displays a running or completed assessment.
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg(connectionString),
  });

  console.log("Seeding customer assessment usage data...");

  const customers = await prisma.user.findMany({
    where: { role: "CUSTOMER" },
    take: 5,
  });

  const now = Date.now();
  for (const customer of customers) {
    const existing = await prisma.assessment.count({
      where: { ownerId: customer.id },
    });
    if (existing === 0) {
      await prisma.assessment.createMany({
        data: [
          {
            id: randomUUID(),
            name: "Authentication gateway",
            lifecycleState: "ACTIVE",
            lifecycleRevision: 1,
            ownerId: customer.id,
            createdAt: new Date(now - 2 * 3600 * 1000),
            updatedAt: new Date(now - 2 * 3600 * 1000),
          },
          {
            id: randomUUID(),
            name: "Payment reconciliation",
            lifecycleState: "COMPLETE",
            lifecycleRevision: 2,
            ownerId: customer.id,
            createdAt: new Date(now - 48 * 3600 * 1000),
            updatedAt: new Date(now - 48 * 3600 * 1000),
          },
          {
            id: randomUUID(),
            name: "Cloud IAM compliance review",
            lifecycleState: "COMPLETE",
            lifecycleRevision: 1,
            ownerId: customer.id,
            createdAt: new Date(now - 120 * 3600 * 1000),
            updatedAt: new Date(now - 120 * 3600 * 1000),
          },
        ],
      });
    }
  }

  console.log("Successfully seeded assessment usage for users!");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Failed to seed assessment data:", err);
  process.exit(1);
});
