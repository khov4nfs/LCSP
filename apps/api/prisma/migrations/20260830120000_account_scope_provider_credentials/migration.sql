-- Account-scoped provider credentials are created directly by the preceding migrations.
ALTER TABLE "RepositoryConnection"
  ADD COLUMN "providerCredentialId" TEXT,
  ADD COLUMN "credentialVersion" INTEGER,
  ADD COLUMN "credentialAuthorizedByUserId" TEXT,
  ADD COLUMN "credentialAuthorizationStatus" "CredentialAuthorizationStatus",
  ADD COLUMN "credentialValidatedAt" TIMESTAMP(3),
  ADD COLUMN "credentialRevokedAt" TIMESTAMP(3);

CREATE INDEX "RepositoryConnection_providerCredentialId_idx" ON "RepositoryConnection"("providerCredentialId");
ALTER TABLE "RepositoryConnection" ADD CONSTRAINT "RepositoryConnection_providerCredentialId_fkey" FOREIGN KEY ("providerCredentialId") REFERENCES "ProviderCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RepositoryConnection" DROP CONSTRAINT IF EXISTS "RepositoryConnection_authentication_shape_check";
ALTER TABLE "RepositoryConnection"
  ADD CONSTRAINT "RepositoryConnection_authentication_shape_check"
  CHECK (
    ("authenticationMode" = 'GITHUB_APP' AND "provider" = 'GITHUB' AND "installationId" IS NOT NULL AND "providerCredentialId" IS NULL)
    OR
    ("authenticationMode" = 'GITHUB_CLI_CREDENTIAL' AND "provider" = 'GITHUB' AND "installationId" IS NULL AND "providerCredentialId" IS NOT NULL)
    OR
    ("authenticationMode" = 'GITLAB_CLI_CREDENTIAL' AND "provider" = 'GITLAB' AND "installationId" IS NULL AND "providerCredentialId" IS NOT NULL)
  ) NOT VALID;
ALTER TABLE "RepositoryConnection" VALIDATE CONSTRAINT "RepositoryConnection_authentication_shape_check";
