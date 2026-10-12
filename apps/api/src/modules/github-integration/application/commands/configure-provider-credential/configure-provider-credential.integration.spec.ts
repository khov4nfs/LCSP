/* eslint-disable @typescript-eslint/require-await */
import { PrismaPg } from "@prisma/adapter-pg";
import {
  CredentialProvider,
  PrismaClient,
  ProviderCredentialStatus,
} from "@prisma/client";
import { describe, expect, it, beforeAll, afterAll, jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { CREDENTIAL_PROVIDERS } from "@lcsp/contracts/github-integration";

import type { AppConfig } from "../../../../../config/config.types.js";
import { ConfigureProviderCredentialCommand } from "./configure-provider-credential.command.js";
import { ConfigureProviderCredentialHandler } from "./configure-provider-credential.handler.js";
import { PrismaCredentialPersistenceUnitOfWork } from "../../../infrastructure/persistence/prisma-credential-persistence.unit-of-work.js";
import { PrismaActiveProviderCredentialResolver } from "../../../infrastructure/persistence/prisma-active-provider-credential.resolver.js";
import { PrismaDatabaseCredentialStore } from "../../../infrastructure/persistence/prisma-database-credential.store.js";
import { EnvelopeEncryptionService } from "../../../infrastructure/security/envelope-encryption.service.js";
import { DevelopmentStaticKeyEncryptionKeyProvider } from "../../../infrastructure/security/development-static-key-encryption-key.provider.js";

const url = process.env.PHASE25_DATABASE_URL;
const run = url ? describe : describe.skip;

run("ConfigureProviderCredential Prisma replacement integration", () => {
  let prisma: PrismaClient;
  let handler: ConfigureProviderCredentialHandler;
  let resolver: PrismaActiveProviderCredentialResolver;
  const provider = {
    validateIdentity: jest.fn(async () => ({
      id: "4242",
      login: "synthetic-user",
      htmlUrl: "https://example.test/users/synthetic-user",
    })),
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(url!) });
    await prisma.$connect();
    const prismaService = prisma as never;
    const encryption = new EnvelopeEncryptionService(
      new DevelopmentStaticKeyEncryptionKeyProvider(
        "test",
        new Map([["test", Buffer.alloc(32, 7)]]),
      ),
    );
    const unitOfWork = new PrismaCredentialPersistenceUnitOfWork(
      prismaService,
      encryption,
    );
    const config = {
      get: () => ({ enabled: true }),
    } as unknown as import("@nestjs/config").ConfigService<AppConfig, true>;
    const registry = { get: () => provider };
    handler = new ConfigureProviderCredentialHandler(
      provider as never,
      config,
      unitOfWork,
      registry as never,
    );
    const store = new PrismaDatabaseCredentialStore(
      prismaService,
      encryption,
      prisma,
    );
    resolver = new PrismaActiveProviderCredentialResolver(prismaService, store);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const command = (credential: string) =>
    new ConfigureProviderCredentialCommand(
      "integration-user",
      AUTH_USER_ROLES.customer,
      "integration-session",
      CREDENTIAL_PROVIDERS.gitlab,
      credential,
      "integration-correlation",
    );

  const activeCount = () =>
    prisma.providerCredential.count({
      where: {
        ownerUserId: "integration-user",
        provider: CredentialProvider.GITLAB,
        status: ProviderCredentialStatus.ACTIVE,
        isActive: true,
      },
    });

  it("configures initially and rotates to a new active credential", async () => {
    await prisma.providerCredential.deleteMany({
      where: { ownerUserId: "integration-user" },
    });

    await handler.execute(command("synthetic-gitlab-credential-a"));
    const first = await prisma.providerCredential.findFirstOrThrow({
      where: { ownerUserId: "integration-user" },
    });
    expect(first.status).toBe(ProviderCredentialStatus.ACTIVE);
    expect(first.isActive).toBe(true);
    expect(await activeCount()).toBe(1);
    await expect(
      resolver.findMetadata({
        userId: "integration-user",
        provider: CredentialProvider.GITLAB,
      }),
    ).resolves.toMatchObject({ id: first.id });

    await handler.execute(command("synthetic-gitlab-credential-b"));
    const rows = await prisma.providerCredential.findMany({
      where: { ownerUserId: "integration-user" },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(1);
    const replacement = rows[0];
    expect(replacement.id).toBe(first.id);
    expect(replacement.currentVersion).toBe(2);
    expect(replacement.isActive).toBe(true);
    expect(await activeCount()).toBe(1);
    await expect(
      resolver.findMetadata({
        userId: "integration-user",
        provider: CredentialProvider.GITLAB,
      }),
    ).resolves.toMatchObject({ id: first.id, currentVersion: 2 });
  });

  it("keeps the existing active credential when identity validation fails", async () => {
    const before = await resolver.findMetadata({
      userId: "integration-user",
      provider: CredentialProvider.GITLAB,
    });
    provider.validateIdentity.mockRejectedValueOnce(
      new Error("invalid synthetic credential"),
    );
    await expect(
      handler.execute(command("synthetic-gitlab-credential-invalid")),
    ).rejects.toBeDefined();
    expect(await activeCount()).toBe(1);
    await expect(
      resolver.findMetadata({
        userId: "integration-user",
        provider: CredentialProvider.GITLAB,
      }),
    ).resolves.toMatchObject({ id: before?.id });
  });

  it("enforces the PostgreSQL partial unique index", async () => {
    const current = await prisma.providerCredential.findFirstOrThrow({
      where: { ownerUserId: "integration-user", isActive: true },
    });
    await expect(
      prisma.providerCredential.create({
        data: {
          id: "synthetic-conflicting-active",
          provider: current.provider,
          ownerUserId: current.ownerUserId,
          providerAccountId: 99n,
          providerLogin: "conflict",
          status: ProviderCredentialStatus.ACTIVE,
          isActive: true,
          currentVersion: 1,
          validatedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(await activeCount()).toBe(1);
  });

  it("isolates replacement by account and provider", async () => {
    for (const [userId, providerName] of [
      ["scope-user-1", CREDENTIAL_PROVIDERS.gitlab],
      ["scope-user-1", CREDENTIAL_PROVIDERS.github],
      ["scope-user-2", CREDENTIAL_PROVIDERS.gitlab],
    ] as const) {
      await handler.execute(
        new ConfigureProviderCredentialCommand(
          userId,
          AUTH_USER_ROLES.customer,
          "integration-session",
          providerName,
          `synthetic-${userId}-${providerName}-credential`,
          "integration-correlation",
        ),
      );
    }
    const rows = await prisma.providerCredential.findMany({
      where: { ownerUserId: "scope-user-1", isActive: true },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.provider)).toEqual(
      expect.arrayContaining([
        CredentialProvider.GITHUB,
        CredentialProvider.GITLAB,
      ]),
    );
    await expect(
      prisma.providerCredential.count({
        where: { ownerUserId: "scope-user-2", isActive: true },
      }),
    ).resolves.toBe(1);
  });

  it("treats same-secret resubmission as a retained-row rotation", async () => {
    await prisma.providerCredential.deleteMany({
      where: { ownerUserId: "same-secret-user" },
    });
    await handler.execute(
      new ConfigureProviderCredentialCommand(
        "same-secret-user",
        AUTH_USER_ROLES.customer,
        "integration-session",
        CREDENTIAL_PROVIDERS.gitlab,
        "synthetic-same-secret-credential",
        "integration-correlation",
      ),
    );
    const first = await prisma.providerCredential.findFirstOrThrow({
      where: { ownerUserId: "same-secret-user" },
    });
    await handler.execute(
      new ConfigureProviderCredentialCommand(
        "same-secret-user",
        AUTH_USER_ROLES.customer,
        "integration-session",
        CREDENTIAL_PROVIDERS.gitlab,
        "synthetic-same-secret-credential",
        "integration-correlation",
      ),
    );
    const rows = await prisma.providerCredential.findMany({
      where: { ownerUserId: "same-secret-user" },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
    expect(rows[0].currentVersion).toBe(first.currentVersion + 1);
    expect(rows[0].isActive).toBe(true);
  });

  it("rolls back deactivation when secret persistence fails", async () => {
    await handler.execute(
      new ConfigureProviderCredentialCommand(
        "rollback-user",
        AUTH_USER_ROLES.customer,
        "integration-session",
        CREDENTIAL_PROVIDERS.gitlab,
        "synthetic-rollback-original-credential",
        "integration-correlation",
      ),
    );
    const original = await prisma.providerCredential.findFirstOrThrow({
      where: { ownerUserId: "rollback-user" },
    });
    const failingUnitOfWork = new PrismaCredentialPersistenceUnitOfWork(
      prisma as never,
      {
        encryptSecret: async () => {
          throw new Error("synthetic persistence failure");
        },
      } as never,
    );
    const failingHandler = new ConfigureProviderCredentialHandler(
      provider as never,
      { get: () => ({ enabled: true }) } as never,
      failingUnitOfWork,
      { get: () => provider } as never,
    );
    await expect(
      failingHandler.execute(
        new ConfigureProviderCredentialCommand(
          "rollback-user",
          AUTH_USER_ROLES.customer,
          "integration-session",
          CREDENTIAL_PROVIDERS.gitlab,
          "synthetic-rollback-replacement-credential",
          "integration-correlation",
        ),
      ),
    ).rejects.toBeDefined();
    const restored = await prisma.providerCredential.findFirstOrThrow({
      where: { id: original.id },
    });
    expect(restored.isActive).toBe(true);
    expect(
      await prisma.providerCredential.count({
        where: { ownerUserId: "rollback-user", isActive: true },
      }),
    ).toBe(1);
  });
});
