import "dotenv/config";
import { randomUUID } from "node:crypto";

import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { toPrismaAuthUserRole } from "../src/infrastructure/prisma/prisma-enum-mappers.ts";
import { hashSecret } from "../src/modules/auth-workspace/infrastructure/security/security.utils.ts";

const DEFAULT_CUSTOMER_EMAILS = ["customer@lcsp.local"] as const;

function customerEmails(): string[] {
  const configured = process.env.GOOGLE_CUSTOMER_EMAILS;
  const emails = configured
    ? configured
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean)
    : [...DEFAULT_CUSTOMER_EMAILS];

  return [...new Set(emails)];
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg(connectionString),
  });

  try {
    const emails = customerEmails();
    const customerPassword =
      process.env.CUSTOMER_SEED_PASSWORD ?? "Customer@123";
    const adminRole = toPrismaAuthUserRole(AUTH_USER_ROLES.admin);
    const customerRole = toPrismaAuthUserRole(AUTH_USER_ROLES.customer);
    const customers: Array<{
      id: string;
      email: string;
      role: typeof AUTH_USER_ROLES.customer;
    }> = [];

    for (const email of emails) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing?.role === adminRole) {
        throw new Error(
          `Refusing to change existing ADMIN account ${email} to CUSTOMER`,
        );
      }

      const customer = await prisma.user.upsert({
        where: { email },
        create: {
          id: randomUUID(),
          email,
          passwordHash: hashSecret(customerPassword),
          emailVerified: true,
          failedLoginCount: 0,
          role: customerRole,
        },
        update: {
          emailVerified: true,
          passwordHash: hashSecret(customerPassword),
          failedLoginCount: 0,
          role: customerRole,
        },
      });

      customers.push({
        id: customer.id,
        email: customer.email,
        role: AUTH_USER_ROLES.customer,
      });
    }

    console.log(JSON.stringify({ customers }));
  } finally {
    await prisma.$disconnect();
  }
}

void main();
