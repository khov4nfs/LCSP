CREATE TYPE "CredentialProvider" AS ENUM ('GITHUB');
CREATE TYPE "ProviderCredentialStatus" AS ENUM ('PENDING', 'ACTIVE', 'INVALID', 'EXPIRED', 'REVOKING', 'REVOKED', 'STORAGE_ERROR');
CREATE TYPE "CredentialAuthorizationStatus" AS ENUM ('ACTIVE', 'REVOKING', 'REVOKED');
CREATE TYPE "RepositoryAuthenticationMode" AS ENUM ('GITHUB_APP', 'GITHUB_CLI_CREDENTIAL');

CREATE TABLE "ProviderCredential" (
  "id" TEXT NOT NULL, "provider" "CredentialProvider" NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "providerAccountId" BIGINT NOT NULL, "providerLogin" TEXT NOT NULL,
  "status" "ProviderCredentialStatus" NOT NULL, "currentVersion" INTEGER NOT NULL,
  "declaredExpiresAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, "validatedAt" TIMESTAMP(3), "lastUsedAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3), "revocationRequestedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3),
  "lastFailureCode" TEXT,
  "envelopeVersion" INTEGER,
  "encryptionAlgorithm" TEXT,
  "ciphertext" BYTEA,
  "credentialNonce" BYTEA,
  "credentialAuthenticationTag" BYTEA,
  "wrappedDekCiphertext" BYTEA,
  "wrappingNonce" BYTEA,
  "wrappingAuthenticationTag" BYTEA,
  "kekVersion" TEXT,
  CONSTRAINT "ProviderCredential_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "RepositoryConnection" ADD COLUMN "authenticationMode" "RepositoryAuthenticationMode";
UPDATE "RepositoryConnection" SET "authenticationMode" = 'GITHUB_APP' WHERE "authenticationMode" IS NULL;
ALTER TABLE "RepositoryConnection" ALTER COLUMN "authenticationMode" SET NOT NULL;
ALTER TABLE "RepositoryConnection" ALTER COLUMN "authenticationMode" SET DEFAULT 'GITHUB_APP';

CREATE INDEX "ProviderCredential_ownerUserId_provider_providerAccountId_idx" ON "ProviderCredential"("ownerUserId", "provider", "providerAccountId");
