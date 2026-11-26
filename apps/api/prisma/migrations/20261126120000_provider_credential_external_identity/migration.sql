ALTER TABLE "ProviderCredential"
  ALTER COLUMN "providerAccountId" DROP NOT NULL,
  ADD COLUMN "providerAccountExternalId" TEXT;

-- Earlier Bitbucket/Azure rows used hashed numeric identifiers and cannot prove exact external identity.
-- Keep those values only as inactive legacy metadata; the new resolver requires an exact external identity.
-- Retain ciphertext and repository history, but require these credentials to be reconfigured.
UPDATE "ProviderCredential"
SET "providerAccountExternalId" = NULL,
    "status" = 'INVALID',
    "isActive" = false,
    "invalidatedAt" = CURRENT_TIMESTAMP
WHERE "provider" IN ('BITBUCKET', 'AZURE_DEVOPS');

CREATE INDEX "ProviderCredential_ownerUserId_provider_providerAccountExternalId_idx"
  ON "ProviderCredential"("ownerUserId", "provider", "providerAccountExternalId");

ALTER TABLE "ProviderCredential"
  ADD CONSTRAINT "ProviderCredential_provider_account_identity_check"
  CHECK (
    ("provider" IN ('GITHUB', 'GITLAB') AND "providerAccountId" IS NOT NULL AND "providerAccountExternalId" IS NULL)
    OR
    ("provider" = 'BITBUCKET' AND "providerAccountId" IS NULL AND "providerAccountExternalId" ~* '^(\{[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\}|[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})$')
    OR
    ("provider" = 'AZURE_DEVOPS' AND "providerAccountId" IS NULL AND "providerAccountExternalId" ~* '^azure-organization:[a-z0-9][a-z0-9-]{0,63}$')
    OR
    ("provider" IN ('BITBUCKET', 'AZURE_DEVOPS') AND "providerAccountExternalId" IS NULL AND "isActive" = false AND "status" IN ('INVALID', 'REVOKED'))
  );
