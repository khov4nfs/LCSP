import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

type PolicyInput = {
  role: string;
  provider: string;
  model: string;
  policyVersion: string;
  effectiveAt: string;
};

function policyInputs(value: unknown): PolicyInput[] {
  if (!Array.isArray(value))
    throw new Error("Policy configuration must be an array");
  return value.map((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      !["role", "provider", "model", "policyVersion", "effectiveAt"].every(
        (key) => typeof (item as Record<string, unknown>)[key] === "string",
      )
    )
      throw new Error("Invalid runtime model policy configuration");
    const policy = item as PolicyInput;
    if (
      !policy.role.trim() ||
      !policy.provider.trim() ||
      !policy.model.trim() ||
      !policy.policyVersion.trim() ||
      Number.isNaN(new Date(policy.effectiveAt).getTime())
    )
      throw new Error("Invalid runtime model policy configuration");
    return policy;
  });
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const configured = process.env.LCSP_RUNTIME_MODEL_POLICY_SNAPSHOTS;
  if (!connectionString || !configured)
    throw new Error(
      "DATABASE_URL and LCSP_RUNTIME_MODEL_POLICY_SNAPSHOTS are required",
    );
  const policies = policyInputs(JSON.parse(configured));
  const prisma = new PrismaClient({ adapter: new PrismaPg(connectionString) });
  try {
    for (const policy of policies) {
      const existing = await prisma.runtimeModelPolicySnapshot.findUnique({
        where: {
          role_policyVersion: {
            role: policy.role,
            policyVersion: policy.policyVersion,
          },
        },
      });
      if (existing) {
        if (
          existing.provider !== policy.provider ||
          existing.model !== policy.model ||
          existing.effectiveAt.getTime() !==
            new Date(policy.effectiveAt).getTime()
        )
          throw new Error(
            `Runtime policy ${policy.role}/${policy.policyVersion} is immutable`,
          );
        continue;
      }
      await prisma.runtimeModelPolicySnapshot.create({ data: policy });
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
