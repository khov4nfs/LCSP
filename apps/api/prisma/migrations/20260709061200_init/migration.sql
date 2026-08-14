-- CreateEnum
CREATE TYPE "AuthMembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "AuthInvitationState" AS ENUM ('APPROVED', 'PENDING', 'CONSUMED');

-- CreateEnum
CREATE TYPE "AuthDecision" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "AuthStateGate" AS ENUM ('MEMBERSHIP_ACTIVE');

-- CreateTable
CREATE TABLE "AuthOrganization" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mfaRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthOrganization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL,
    "failedLoginCount" INTEGER NOT NULL,
    "lockUntil" TIMESTAMP(3),
    "displayName" TEXT,
    "recoveryEmail" TEXT,
    "mfaRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthPolicy" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "actions" TEXT[],
    "subjectRole" TEXT NOT NULL,
    "stateGate" "AuthStateGate" NOT NULL,
    "conditions" JSONB,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthPolicy_pkey" PRIMARY KEY ("id","version")
);

-- CreateTable
CREATE TABLE "AuthMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "AuthMembershipStatus" NOT NULL,
    "subjectAttributes" JSONB NOT NULL,
    "policyId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthInvitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "state" "AuthInvitationState" NOT NULL,
    "emailVerified" BOOLEAN NOT NULL,
    "membershipStatus" "AuthMembershipStatus" NOT NULL,
    "subjectAttributes" JSONB NOT NULL,
    "policyId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenFingerprint" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "mfaVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthUserMfa" (
    "userId" TEXT NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthUserMfa_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AuthMfaOtpUsed" (
    "userId" TEXT NOT NULL,
    "otpCode" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthMfaOtpUsed_pkey" PRIMARY KEY ("userId","otpCode")
);

-- CreateTable
CREATE TABLE "AuthMfaRateLimit" (
    "userId" TEXT NOT NULL,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthMfaRateLimit_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AuthRecoveryRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenFingerprint" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthRecoveryRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthAuditEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorId" TEXT,
    "organizationId" TEXT,
    "decision" "AuthDecision",
    "reasonCode" TEXT,
    "correlationId" TEXT NOT NULL,
    "sessionId" TEXT,
    "policyId" TEXT,
    "policyVersion" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthDecisionLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "decision" "AuthDecision" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "policyId" TEXT,
    "policyVersion" TEXT,
    "correlationId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthDecisionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthOrganization_slug_key" ON "AuthOrganization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "AuthUser_email_key" ON "AuthUser"("email");

-- CreateIndex
CREATE INDEX "AuthPolicy_organizationId_idx" ON "AuthPolicy"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthPolicy_organizationId_subjectRole_version_key" ON "AuthPolicy"("organizationId", "subjectRole", "version");

-- CreateIndex
CREATE INDEX "AuthMembership_organizationId_idx" ON "AuthMembership"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthMembership_userId_organizationId_key" ON "AuthMembership"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "AuthInvitation_organizationId_idx" ON "AuthInvitation"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenFingerprint_key" ON "AuthSession"("tokenFingerprint");

-- CreateIndex
CREATE INDEX "AuthSession_organizationId_idx" ON "AuthSession"("organizationId");

-- CreateIndex
CREATE INDEX "AuthMfaOtpUsed_userId_usedAt_idx" ON "AuthMfaOtpUsed"("userId", "usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthRecoveryRequest_tokenFingerprint_key" ON "AuthRecoveryRequest"("tokenFingerprint");

-- CreateIndex
CREATE INDEX "AuthRecoveryRequest_userId_idx" ON "AuthRecoveryRequest"("userId");

-- CreateIndex
CREATE INDEX "AuthAuditEvent_organizationId_idx" ON "AuthAuditEvent"("organizationId");

-- CreateIndex
CREATE INDEX "AuthAuditEvent_correlationId_idx" ON "AuthAuditEvent"("correlationId");

-- CreateIndex
CREATE INDEX "AuthDecisionLog_organizationId_idx" ON "AuthDecisionLog"("organizationId");

-- CreateIndex
CREATE INDEX "AuthDecisionLog_correlationId_idx" ON "AuthDecisionLog"("correlationId");

-- CreateIndex
CREATE INDEX "OutboxMessage_status_createdAt_idx" ON "OutboxMessage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OutboxMessage_aggregateType_aggregateId_idx" ON "OutboxMessage"("aggregateType", "aggregateId");

-- AddForeignKey
ALTER TABLE "AuthPolicy" ADD CONSTRAINT "AuthPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthMembership" ADD CONSTRAINT "AuthMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthMembership" ADD CONSTRAINT "AuthMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthMembership" ADD CONSTRAINT "AuthMembership_policyId_policyVersion_fkey" FOREIGN KEY ("policyId", "policyVersion") REFERENCES "AuthPolicy"("id", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthInvitation" ADD CONSTRAINT "AuthInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthInvitation" ADD CONSTRAINT "AuthInvitation_policyId_policyVersion_fkey" FOREIGN KEY ("policyId", "policyVersion") REFERENCES "AuthPolicy"("id", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthUserMfa" ADD CONSTRAINT "AuthUserMfa_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthMfaRateLimit" ADD CONSTRAINT "AuthMfaRateLimit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthRecoveryRequest" ADD CONSTRAINT "AuthRecoveryRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthAuditEvent" ADD CONSTRAINT "AuthAuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthDecisionLog" ADD CONSTRAINT "AuthDecisionLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
