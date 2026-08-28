-- LCSP-264: collapse auth persistence to User + AuthRecord and generalize audit storage.

ALTER TABLE "AuthUser" RENAME TO "User";

ALTER TABLE "User"
  ADD COLUMN "mfaEncryptedSecret" TEXT,
  ADD COLUMN "mfaEnrolledAt" TIMESTAMP(3),
  ADD COLUMN "mfaVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "mfaFailedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "mfaLockedUntil" TIMESTAMP(3);

UPDATE "User" AS u
SET "mfaEncryptedSecret" = m."encryptedSecret",
    "mfaEnrolledAt" = m."enrolledAt",
    "mfaVerifiedAt" = m."verifiedAt"
FROM "AuthUserMfa" AS m
WHERE u.id = m."userId";

UPDATE "User" AS u
SET "mfaFailedCount" = r."failedCount",
    "mfaLockedUntil" = r."lockedUntil"
FROM "AuthMfaRateLimit" AS r
WHERE u.id = r."userId";

CREATE TYPE "AuthRecordType" AS ENUM ('SESSION','MFA_OTP_USE','MFA_RECOVERY_CODE','RECOVERY_REQUEST','OAUTH_IDENTITY','OAUTH_STATE');

CREATE TABLE "AuthRecord" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "type" "AuthRecordType" NOT NULL,
  "lookupKey" TEXT NOT NULL,
  "secretHash" TEXT,
  "expiresAt" TIMESTAMP(3),
  "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AuthRecord_lookupKey_key" ON "AuthRecord"("lookupKey");
CREATE INDEX "AuthRecord_userId_type_idx" ON "AuthRecord"("userId", "type");
CREATE INDEX "AuthRecord_type_expiresAt_idx" ON "AuthRecord"("type", "expiresAt");
CREATE INDEX "AuthRecord_userId_type_revokedAt_usedAt_idx" ON "AuthRecord"("userId", "type", "revokedAt", "usedAt");

INSERT INTO "AuthRecord" ("id","userId","type","lookupKey","secretHash","expiresAt","revokedAt","metadata","createdAt","updatedAt")
SELECT s.id,s."userId",'SESSION'::"AuthRecordType",'SESSION:'||s."tokenFingerprint",s."tokenHash",s."expiresAt",s."revokedAt",
  jsonb_build_object('tokenFingerprint',s."tokenFingerprint",'mfaVerifiedAt',CASE WHEN s."mfaVerifiedAt" IS NULL THEN NULL ELSE to_jsonb(s."mfaVerifiedAt"::text) END,'sensitiveActionVerifiedAt',CASE WHEN s."sensitiveActionVerifiedAt" IS NULL THEN NULL ELSE to_jsonb(s."sensitiveActionVerifiedAt"::text) END),
  s."createdAt",s."updatedAt" FROM "AuthSession" s;

INSERT INTO "AuthRecord" ("id","userId","type","lookupKey","usedAt","metadata","createdAt","updatedAt")
SELECT m."userId"||':otp:'||m."otpCode",m."userId",'MFA_OTP_USE'::"AuthRecordType",'MFA_OTP_USE:'||m."userId"||':'||m."otpCode",m."usedAt",jsonb_build_object('otpCode',m."otpCode"),m."usedAt",m."usedAt" FROM "AuthMfaOtpUsed" m;

INSERT INTO "AuthRecord" ("id","userId","type","lookupKey","secretHash","usedAt","revokedAt","metadata","createdAt","updatedAt")
SELECT r.id,r."userId",'MFA_RECOVERY_CODE'::"AuthRecordType",'MFA_RECOVERY_CODE:'||r."userId"||':'||r."codeHash",r."codeHash",r."usedAt",r."revokedAt",jsonb_build_object('batchId',r."batchId"),r."generatedAt",r."generatedAt" FROM "AuthMfaRecoveryCode" r;

INSERT INTO "AuthRecord" ("id","userId","type","lookupKey","secretHash","expiresAt","usedAt","metadata","createdAt","updatedAt")
SELECT r.id,r."userId",'RECOVERY_REQUEST'::"AuthRecordType",'RECOVERY_REQUEST:'||r."tokenFingerprint",r."tokenHash",r."expiresAt",r."consumedAt",jsonb_build_object('tokenFingerprint',r."tokenFingerprint"),r."createdAt",r."createdAt" FROM "AuthRecoveryRequest" r;

INSERT INTO "AuthRecord" ("id","userId","type","lookupKey","expiresAt","metadata","createdAt","updatedAt")
SELECT s.id,s."userId",'OAUTH_STATE'::"AuthRecordType",'OAUTH_STATE:'||s.state,s."expiresAt",jsonb_build_object('state',s.state,'nonce',s.nonce,'provider',s.provider,'redirectUri',s."redirectUri",'sessionId',s."sessionId"),s."createdAt",s."createdAt" FROM "AuthOAuthState" s;

INSERT INTO "AuthRecord" ("id","userId","type","lookupKey","metadata","createdAt","updatedAt")
SELECT i.id,i."userId",'OAUTH_IDENTITY'::"AuthRecordType",'OAUTH_IDENTITY:'||i.provider||':'||i."providerAccountId",jsonb_build_object('provider',i.provider,'providerAccountId',i."providerAccountId"),i."createdAt",i."createdAt" FROM "AuthOAuthIdentity" i;

ALTER TABLE "AuthAuditEvent" RENAME TO "AuditEvent";

INSERT INTO "AuditEvent" ("id","eventType","actorId","resourceType","resourceId","decision","reasonCode","correlationId","sessionId","payload","createdAt")
SELECT d.id,'AUTHORIZATION_DECISION',d."actorId",d."resourceType",d."resourceId",d.decision,d."reasonCode"::text,d."correlationId",d."sessionId",d.payload,d."createdAt"
FROM "AuthDecisionLog" d ON CONFLICT ("id") DO NOTHING;

DROP TABLE "AuthOAuthState";
DROP TABLE "AuthOAuthIdentity";
DROP TABLE "AuthRecoveryRequest";
DROP TABLE "AuthMfaRecoveryCode";
DROP TABLE "AuthMfaOtpUsed";
DROP TABLE "AuthMfaRateLimit";
DROP TABLE "AuthUserMfa";
DROP TABLE "AuthSession";
DROP TABLE "AuthDecisionLog";
