import {
  CredentialProvider,
  Prisma,
  type Prisma as PrismaTypes,
} from "@prisma/client";
import { Injectable, Logger, Optional } from "@nestjs/common";
import { CREDENTIAL_PROVIDERS } from "@lcsp/contracts/github-integration";

import {
  CREDENTIAL_STORE_HEALTH_STATUSES,
  type CredentialStorageContext,
  type CredentialStoreHealth,
  type CredentialStorePort,
  type CredentialLocator,
} from "../../application/ports/security/credential-store.port.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { CredentialStoreError } from "../security/in-memory-encrypted-credential.store.js";
import {
  EnvelopeEncryptionService,
  EnvelopeEncryptionError,
  type EncryptedSecretEnvelope,
} from "../security/envelope-encryption.service.js";

type CredentialPersistenceClient = Pick<
  PrismaTypes.TransactionClient,
  "providerCredential"
>;

/** Database envelope store. It encrypts values but intentionally performs no actor authorization. */
@Injectable()
export class PrismaDatabaseCredentialStore implements CredentialStorePort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EnvelopeEncryptionService,
    @Optional()
    private readonly client: CredentialPersistenceClient = prisma,
  ) {}

  /** Creates a transaction-scoped view for a future atomic connect unit of work. */
  withTransaction(
    transaction: PrismaTypes.TransactionClient,
  ): PrismaDatabaseCredentialStore {
    return new PrismaDatabaseCredentialStore(
      this.prisma,
      this.encryption,
      transaction,
    );
  }

  async store(
    secret: string,
    context: CredentialStorageContext,
  ): Promise<CredentialLocator> {
    let operation = "context_validation";
    try {
      await this.assertCredentialContext(context);
      operation = "encryption";
      const envelope = await this.encryption.encryptSecret(secret, context);
      operation = "provider_credential_envelope_update";
      await this.client.providerCredential.update({
        where: { id: context.providerCredentialId },
        data: {
          currentVersion: context.credentialVersion,
          envelopeVersion: envelope.version,
          encryptionAlgorithm: envelope.algorithm,
          ciphertext: decode(envelope.ciphertext),
          credentialNonce: decode(envelope.nonce),
          credentialAuthenticationTag: decode(envelope.authenticationTag),
          wrappedDekCiphertext: decode(
            envelope.wrappedDataEncryptionKey.ciphertext,
          ),
          wrappingNonce: decode(envelope.wrappedDataEncryptionKey.nonce),
          wrappingAuthenticationTag: decode(
            envelope.wrappedDataEncryptionKey.authenticationTag,
          ),
          kekVersion: envelope.wrappedDataEncryptionKey.keyVersion,
        },
      });
      return context.providerCredentialId as CredentialLocator;
    } catch (error: unknown) {
      if (process.env.NODE_ENV !== "production") {
        Logger.error(
          JSON.stringify({
            message: "Credential store operation failed",
            operation,
            ...safePersistenceDiagnostic(error),
          }),
          undefined,
          PrismaDatabaseCredentialStore.name,
        );
      }
      throw new CredentialStoreError({ cause: error, operation });
    }
  }

  async read(credentialLocator: CredentialLocator): Promise<string> {
    try {
      const row = await this.client.providerCredential.findUnique({
        where: { id: credentialLocator },
      });
      if (
        !row ||
        !row.ciphertext ||
        !row.credentialNonce ||
        !row.credentialAuthenticationTag ||
        !row.wrappedDekCiphertext ||
        !row.wrappingNonce ||
        !row.wrappingAuthenticationTag ||
        !row.envelopeVersion ||
        !row.encryptionAlgorithm ||
        !row.kekVersion
      )
        throw new CredentialStoreError();
      const context = contextFromRow(
        row,
        row.currentVersion,
        row.envelopeVersion,
      );
      return await this.encryption.decryptSecret(
        envelopeFromRow({
          envelopeVersion: row.envelopeVersion,
          encryptionAlgorithm: row.encryptionAlgorithm,
          ciphertext: row.ciphertext,
          credentialNonce: row.credentialNonce,
          credentialAuthenticationTag: row.credentialAuthenticationTag,
          wrappedDekCiphertext: row.wrappedDekCiphertext,
          wrappingNonce: row.wrappingNonce,
          wrappingAuthenticationTag: row.wrappingAuthenticationTag,
          kekVersion: row.kekVersion,
        }),
        context,
      );
    } catch {
      throw new CredentialStoreError();
    }
  }

  async replace(
    oldLocator: CredentialLocator,
    secret: string,
    context: CredentialStorageContext,
  ): Promise<CredentialLocator> {
    if (oldLocator !== context.providerCredentialId) {
      throw new CredentialStoreError();
    }
    return this.store(secret, context);
  }

  async destroy(credentialLocator: CredentialLocator): Promise<void> {
    try {
      await this.client.providerCredential.updateMany({
        where: { id: credentialLocator },
        data: {
          ciphertext: null,
          credentialNonce: null,
          credentialAuthenticationTag: null,
          wrappedDekCiphertext: null,
          wrappingNonce: null,
          wrappingAuthenticationTag: null,
          envelopeVersion: null,
          encryptionAlgorithm: null,
          kekVersion: null,
        },
      });
    } catch {
      throw new CredentialStoreError();
    }
  }

  async health(): Promise<CredentialStoreHealth> {
    try {
      await this.client.providerCredential.count({ take: 1 });
      return { status: CREDENTIAL_STORE_HEALTH_STATUSES.available };
    } catch {
      return { status: CREDENTIAL_STORE_HEALTH_STATUSES.unavailable };
    }
  }

  private async assertCredentialContext(
    context: CredentialStorageContext,
  ): Promise<void> {
    const row = await this.client.providerCredential.findFirst({
      where: {
        id: context.providerCredentialId,
        ownerUserId: context.ownerUserId,
        provider: {
          in: [CredentialProvider.GITHUB, CredentialProvider.GITLAB],
        },
      },
      select: { id: true },
    });
    if (
      !row ||
      (context.provider !== CREDENTIAL_PROVIDERS.github &&
        context.provider !== CREDENTIAL_PROVIDERS.gitlab)
    )
      throw new CredentialStoreError();
  }
}

function safePersistenceDiagnostic(error: unknown): Record<string, unknown> {
  if (error instanceof EnvelopeEncryptionError) {
    const cause = error.cause;
    return {
      errorClass: "EnvelopeEncryptionError",
      envelopeReason: error.reason,
      innerErrorClass:
        cause instanceof Error ? cause.constructor.name : undefined,
    };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = error.meta;
    return {
      errorClass: "PrismaClientKnownRequestError",
      prismaCode: error.code,
      prismaModel:
        typeof meta?.modelName === "string" ? meta.modelName : undefined,
      prismaTarget: Array.isArray(meta?.target)
        ? meta.target.filter(
            (value): value is string => typeof value === "string",
          )
        : undefined,
      prismaField:
        typeof meta?.field_name === "string" ? meta.field_name : undefined,
    };
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    return { errorClass: "PrismaClientValidationError" };
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return { errorClass: "PrismaClientUnknownRequestError" };
  }
  return {
    errorClass: error instanceof Error ? error.constructor.name : "Unknown",
  };
}

function contextFromRow(
  row: {
    id: string;
    ownerUserId: string;
    provider: CredentialProvider;
  },
  credentialVersion: number,
  envelopeVersion: number,
): CredentialStorageContext {
  if (
    row.provider !== CredentialProvider.GITHUB &&
    row.provider !== CredentialProvider.GITLAB
  )
    throw new CredentialStoreError();
  const provider =
    row.provider === CredentialProvider.GITLAB
      ? CREDENTIAL_PROVIDERS.gitlab
      : CREDENTIAL_PROVIDERS.github;
  return {
    provider,
    providerCredentialId: row.id,
    ownerUserId: row.ownerUserId,
    credentialVersion,
    envelopeVersion,
  };
}

function envelopeFromRow(row: {
  envelopeVersion: number;
  encryptionAlgorithm: string;
  ciphertext: Uint8Array;
  credentialNonce: Uint8Array;
  credentialAuthenticationTag: Uint8Array;
  wrappedDekCiphertext: Uint8Array;
  wrappingNonce: Uint8Array;
  wrappingAuthenticationTag: Uint8Array;
  kekVersion: string;
}): EncryptedSecretEnvelope {
  if (row.envelopeVersion !== 1 || row.encryptionAlgorithm !== "AES_256_GCM")
    throw new CredentialStoreError();
  return {
    algorithm: "AES_256_GCM",
    version: 1,
    ciphertext: encode(row.ciphertext),
    nonce: encode(row.credentialNonce),
    authenticationTag: encode(row.credentialAuthenticationTag),
    wrappedDataEncryptionKey: {
      keyVersion: row.kekVersion,
      ciphertext: encode(row.wrappedDekCiphertext),
      nonce: encode(row.wrappingNonce),
      authenticationTag: encode(row.wrappingAuthenticationTag),
    },
  };
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Buffer.from(value, "base64"));
}
function encode(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}
