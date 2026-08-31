ALTER TYPE "CredentialProvider" ADD VALUE IF NOT EXISTS 'GITLAB';
ALTER TYPE "RepositoryAuthenticationMode" ADD VALUE IF NOT EXISTS 'GITLAB_CLI_CREDENTIAL';

ALTER TABLE "RepositoryConnection"
  ADD COLUMN "provider" "CredentialProvider" NOT NULL DEFAULT 'GITHUB';

ALTER TABLE "RepositoryConnection"
  DROP CONSTRAINT IF EXISTS "RepositoryConnection_authentication_shape_check";

