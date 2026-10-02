ALTER TABLE "Assessment"
    ADD COLUMN "repositorySetupVersion" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "repositorySetupManifest" JSONB,
    ADD COLUMN "repositorySetupConfirmedAt" TIMESTAMP(3);
