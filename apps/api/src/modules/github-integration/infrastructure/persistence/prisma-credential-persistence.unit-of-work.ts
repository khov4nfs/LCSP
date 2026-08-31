import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { EnvelopeEncryptionService } from "../security/envelope-encryption.service.js";
import { PrismaProviderCredentialRepository } from "./prisma-credential.repositories.js";
import { PrismaDatabaseCredentialStore } from "./prisma-database-credential.store.js";

export type CredentialPersistenceTransaction = {
  database: Prisma.TransactionClient;
  credentialStore: PrismaDatabaseCredentialStore;
  providerCredentials: PrismaProviderCredentialRepository;
};

/** Coordinates future credential metadata, encrypted envelope, authorization and connection writes in one DB transaction. */
@Injectable()
export class PrismaCredentialPersistenceUnitOfWork {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EnvelopeEncryptionService,
  ) {}

  execute<T>(
    work: (transaction: CredentialPersistenceTransaction) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((tx) =>
      work({
        database: tx,
        credentialStore: new PrismaDatabaseCredentialStore(
          this.prisma,
          this.encryption,
          tx,
        ),
        providerCredentials: new PrismaProviderCredentialRepository(
          this.prisma,
          tx,
        ),
      }),
    );
  }
}
