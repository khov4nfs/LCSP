ALTER TYPE "CredentialProvider" ADD VALUE IF NOT EXISTS 'BITBUCKET';
ALTER TYPE "CredentialProvider" ADD VALUE IF NOT EXISTS 'AZURE_DEVOPS';
ALTER TYPE "RepositoryAuthenticationMode" ADD VALUE IF NOT EXISTS 'BITBUCKET_CLI_CREDENTIAL';
ALTER TYPE "RepositoryAuthenticationMode" ADD VALUE IF NOT EXISTS 'AZURE_DEVOPS_CLI_CREDENTIAL';

ALTER TABLE "RepositoryConnection" DROP CONSTRAINT IF EXISTS "RepositoryConnection_authentication_shape_check";
ALTER TABLE "RepositoryConnection"
  ADD CONSTRAINT "RepositoryConnection_authentication_shape_check"
  CHECK (
    ("authenticationMode" = 'GITHUB_APP' AND "provider" = 'GITHUB' AND "installationId" IS NOT NULL AND "providerCredentialId" IS NULL)
    OR
    ("authenticationMode" = 'GITHUB_CLI_CREDENTIAL' AND "provider" = 'GITHUB' AND "installationId" IS NULL AND "providerCredentialId" IS NOT NULL)
    OR
    ("authenticationMode" = 'GITLAB_CLI_CREDENTIAL' AND "provider" = 'GITLAB' AND "installationId" IS NULL AND "providerCredentialId" IS NOT NULL)
    OR
    ("authenticationMode" = 'BITBUCKET_CLI_CREDENTIAL' AND "provider" = 'BITBUCKET' AND "installationId" IS NULL AND "providerCredentialId" IS NOT NULL)
    OR
    ("authenticationMode" = 'AZURE_DEVOPS_CLI_CREDENTIAL' AND "provider" = 'AZURE_DEVOPS' AND "installationId" IS NULL AND "providerCredentialId" IS NOT NULL)
  ) NOT VALID;
ALTER TABLE "RepositoryConnection" VALIDATE CONSTRAINT "RepositoryConnection_authentication_shape_check";
