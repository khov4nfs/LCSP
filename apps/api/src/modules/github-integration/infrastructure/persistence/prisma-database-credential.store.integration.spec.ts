import { PrismaPg } from "@prisma/adapter-pg";
import {
  CredentialProvider,
  PrismaClient,
  ProviderCredentialStatus,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { CREDENTIAL_PROVIDERS } from "@lcsp/contracts/github-integration";

import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { EnvelopeEncryptionService } from "../security/envelope-encryption.service.js";
import { ProductionConfiguredKeyEncryptionKeyProvider } from "../security/production-configured-key-encryption-key.provider.js";
import { PrismaDatabaseCredentialStore } from "./prisma-database-credential.store.js";

const databaseUrl = process.env.PHASE25_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const SECRET = "github_pat_phase25_recognizable_fake_secret";

describeDatabase("PrismaDatabaseCredentialStore PostgreSQL integration", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl ?? "") });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("persists, authenticates, detects tampering, and destroys an encrypted credential", async () => {
    const credentialId = "phase25-credential";
    await prisma.providerCredential.create({
      data: {
        id: credentialId,
        provider: CredentialProvider.GITHUB,
        ownerUserId: "manager-a",
        providerAccountId: 9876543210n,
        providerLogin: "manager-a-gh",
        status: ProviderCredentialStatus.ACTIVE,
        currentVersion: 1,
      },
    });
    const provider = new ProductionConfiguredKeyEncryptionKeyProvider(
      "kek-v1",
      JSON.stringify({ "kek-v1": Buffer.alloc(32, 3).toString("base64") }),
    );
    const store = new PrismaDatabaseCredentialStore(
      prisma as unknown as PrismaService,
      new EnvelopeEncryptionService(provider),
      prisma,
    );
    const context = {
      provider: CREDENTIAL_PROVIDERS.github,
      providerCredentialId: credentialId,
      ownerUserId: "manager-a",
      credentialVersion: 1,
      envelopeVersion: 1,
    };
    const locator = await store.store(SECRET, context);
    const persisted = await prisma.providerCredential.findUniqueOrThrow({
      where: { id: locator },
    });
    const serializedMetadata = JSON.stringify({
      id: persisted.id,
      providerCredentialId: persisted.id,
      credentialVersion: context.credentialVersion,
      envelopeVersion: persisted.envelopeVersion,
      encryptionAlgorithm: persisted.encryptionAlgorithm,
      kekVersion: persisted.kekVersion,
    });
    const encryptedBytes = Buffer.concat([
      Buffer.from(persisted.ciphertext!),
      Buffer.from(persisted.credentialNonce!),
      Buffer.from(persisted.credentialAuthenticationTag!),
      Buffer.from(persisted.wrappedDekCiphertext!),
      Buffer.from(persisted.wrappingNonce!),
      Buffer.from(persisted.wrappingAuthenticationTag!),
    ]);
    expect(serializedMetadata).not.toContain(SECRET);
    expect(String(locator)).not.toContain(SECRET);
    expect(encryptedBytes.includes(Buffer.from(SECRET, "utf8"))).toBe(false);
    await expect(store.read(locator)).resolves.toBe(SECRET);

    const tamperedTag = Uint8Array.from(persisted.credentialAuthenticationTag!);
    tamperedTag[0] ^= 0xff;
    await prisma.providerCredential.update({
      where: { id: locator },
      data: { credentialAuthenticationTag: tamperedTag },
    });
    await expect(store.read(locator)).rejects.toThrow(
      "credential_store_operation_failed",
    );
    await prisma.providerCredential.update({
      where: { id: locator },
      data: {
        credentialAuthenticationTag: persisted.credentialAuthenticationTag,
      },
    });

    await prisma.providerCredential.update({
      where: { id: credentialId },
      data: { ownerUserId: "owner-tampered" },
    });
    await expect(store.read(locator)).rejects.toThrow(
      "credential_store_operation_failed",
    );
    await prisma.providerCredential.update({
      where: { id: credentialId },
      data: { ownerUserId: "manager-a" },
    });

    await store.destroy(locator);
    await expect(store.read(locator)).rejects.toThrow(
      "credential_store_operation_failed",
    );
    await prisma.providerCredential.delete({ where: { id: credentialId } });
  });
});
