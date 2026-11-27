import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg(connectionString),
  });

  console.log("Seeding rich audit events for admin overview...");

  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
  });

  if (!admin) {
    console.error("No admin user found. Run base seed first.");
    return;
  }

  // Clear existing audit events to have clean seed data
  await prisma.auditEvent.deleteMany({});

  const events = [
    {
      id: randomUUID(),
      correlationId: randomUUID(),
      eventType: "AUTH_ADMIN_USER_SUSPENDED",
      actorId: admin.id,
      payload: {
        targetUserId: "user-suspended-1",
        email: "flagged.member@lcsp.local",
        reason: "Unusual API request rate exceeded threshold",
      },
      createdAt: new Date(Date.now() - 1000 * 60 * 15), // 15 mins ago
    },
    {
      id: randomUUID(),
      correlationId: randomUUID(),
      eventType: "LEGAL_SOURCE_VERSION_ACTIVATED",
      actorId: admin.id,
      payload: {
        legalSourceVersionRef: "v2.5.0-2026",
        sourceCount: 142,
      },
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
    },
    {
      id: randomUUID(),
      correlationId: randomUUID(),
      eventType: "AUTH_ADMIN_INVITATION_CREATED",
      actorId: admin.id,
      payload: {
        email: "sarah.compliance@enterprise.com",
        role: "AUDITOR",
      },
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5), // 5 hours ago
    },
    {
      id: randomUUID(),
      correlationId: randomUUID(),
      eventType: "AUTH_ADMIN_USER_RESTORED",
      actorId: admin.id,
      payload: {
        targetUserId: "user-restored-1",
        email: "recovered.operator@lcsp.local",
      },
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24), // 1 day ago
    },
    {
      id: randomUUID(),
      correlationId: randomUUID(),
      eventType: "AUTH_ADMIN_INVITATION_CREATED",
      actorId: admin.id,
      payload: {
        email: "legal.counsel@partner-firm.vn",
        role: "ADMIN",
      },
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48), // 2 days ago
    },
  ];

  for (const event of events) {
    await prisma.auditEvent.create({ data: event });
  }

  console.log("Successfully seeded 5 rich audit events!");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
