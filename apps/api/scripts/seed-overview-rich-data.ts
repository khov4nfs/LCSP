import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { AUTH_USER_ROLES, USER_ACCESS_STATUSES } from "@lcsp/contracts/auth";
import { hashSecretSync } from "../src/modules/auth/infrastructure/security/security.utils.ts";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg(connectionString),
  });

  console.log("Seeding admin overview rich data into database...");

  // 1. Seed more users (active, suspended)
  const usersToSeed = [
    { email: "user.dev1@example.com", status: USER_ACCESS_STATUSES.active },
    { email: "user.dev2@example.com", status: USER_ACCESS_STATUSES.active },
    { email: "user.dev3@example.com", status: USER_ACCESS_STATUSES.active },
    {
      email: "user.suspended1@example.com",
      status: USER_ACCESS_STATUSES.suspended,
    },
    {
      email: "user.suspended2@example.com",
      status: USER_ACCESS_STATUSES.suspended,
    },
  ];

  for (const u of usersToSeed) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: {
        id: randomUUID(),
        email: u.email,
        passwordHash: hashSecretSync("Password@123"),
        emailVerified: true,
        failedLoginCount: 0,
        accessStatus: u.status,
        role: AUTH_USER_ROLES.customer,
      },
      update: {
        accessStatus: u.status,
      },
    });
  }

  // 2. Seed a Legal Source Version (Draft & Active)
  // These seed writes establish sample versions; later steps do not consume the returned rows.
  await prisma.legalSourceVersion.upsert({
    where: { version: "v2.5.0-2026" },
    create: {
      id: randomUUID(),
      version: "v2.5.0-2026",
      status: "ACTIVE",
      activatedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000),
      sourceManifest: {},
    },
    update: {
      status: "ACTIVE",
      activatedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000),
    },
  });

  await prisma.legalSourceVersion.upsert({
    where: { version: "v2.6.0-draft" },
    create: {
      id: randomUUID(),
      version: "v2.6.0-draft",
      status: "DRAFT",
      createdAt: new Date(),
      sourceManifest: {},
    },
    update: {
      status: "DRAFT",
    },
  });

  // 3. Seed some assessments
  const customer = await prisma.user.findFirst({ where: { role: "CUSTOMER" } });
  if (customer) {
    const dates = [
      { daysAgo: 2, state: "COMPLETE" },
      { daysAgo: 5, state: "COMPLETE" },
      { daysAgo: 7, state: "COMPLETE" },
      { daysAgo: 10, state: "ACTIVE" },
      { daysAgo: 14, state: "FAILED" },
      { daysAgo: 18, state: "COMPLETE" },
      { daysAgo: 21, state: "COMPLETE" },
      { daysAgo: 25, state: "COMPLETE" },
    ] as const;

    for (const item of dates) {
      const pastDate = new Date(Date.now() - item.daysAgo * 24 * 3600 * 1000);
      await prisma.assessment.create({
        data: {
          id: randomUUID(),
          name: `Compliance Assessment (${item.daysAgo}d ago)`,
          lifecycleState: item.state,
          lifecycleRevision: 1,
          createdAt: pastDate,
          updatedAt: pastDate,
          owner: {
            connect: { id: customer.id },
          },
        },
      });
    }
  }

  // 4. Seed Audit Events (for Recent Operational Activity Table)
  const auditEvents = [
    {
      eventType: "legal_source.version.activated",
      actionKey: "ACTIVATED_LEGAL_SOURCE",
      target: "Vietnam Cybersecurity Law (Decree 13/2023/ND-CP)",
      occurredMinutesAgo: 15,
    },
    {
      eventType: "auth.admin.user_suspended",
      actionKey: "SUSPENDED_ACCOUNT",
      target: "user.suspended1@example.com",
      occurredMinutesAgo: 45,
    },
    {
      eventType: "auth.admin.user_restored",
      actionKey: "RESTORED_ACCOUNT",
      target: "user.dev1@example.com",
      occurredMinutesAgo: 120,
    },
    {
      eventType: "auth.admin.invitation_created",
      actionKey: "INVITED_USER",
      target: "auditor.external@enterprise.vn",
      occurredMinutesAgo: 240,
    },
    {
      eventType: "legal_source.version.activated",
      actionKey: "ACTIVATED_LEGAL_SOURCE",
      target: "Personal Data Protection Decree (PDPD 2026)",
      occurredMinutesAgo: 360,
    },
  ];

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });

  for (const ev of auditEvents) {
    await prisma.auditEvent.create({
      data: {
        id: randomUUID(),
        correlationId: randomUUID(),
        eventType: ev.eventType,
        actorId: admin?.id,
        payload: {
          target: ev.target,
          adminEmail: admin?.email ?? "anhkn7@gmail.com",
        },
        createdAt: new Date(Date.now() - ev.occurredMinutesAgo * 60 * 1000),
      },
    });
  }

  console.log("Successfully seeded rich overview data into database!");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Failed to seed data:", err);
  process.exit(1);
});
