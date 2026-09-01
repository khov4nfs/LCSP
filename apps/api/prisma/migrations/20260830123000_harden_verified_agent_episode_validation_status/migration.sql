CREATE TYPE "VerifiedAgentEpisodeValidationStatus" AS ENUM ('VERIFIED');

ALTER TABLE "VerifiedAgentEpisode"
  ALTER COLUMN "validationStatus" TYPE "VerifiedAgentEpisodeValidationStatus"
    USING (
      CASE
        WHEN "validationStatus" = 'VALIDATED' THEN 'VERIFIED'
        WHEN "validationStatus" = 'VERIFIED' THEN 'VERIFIED'
        ELSE 'VERIFIED'
      END
    )::"VerifiedAgentEpisodeValidationStatus";
