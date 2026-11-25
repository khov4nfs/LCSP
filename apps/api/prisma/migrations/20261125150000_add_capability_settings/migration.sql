-- CreateEnum
CREATE TYPE "ToolAccessMode" AS ENUM ('LOAD_WHEN_NEEDED', 'GUIDED');

-- CreateTable
CREATE TABLE "CapabilitySetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "toolAccessMode" "ToolAccessMode" NOT NULL DEFAULT 'LOAD_WHEN_NEEDED',
    "connectorSearch" BOOLEAN NOT NULL DEFAULT true,
    "artifactsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapabilitySetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CapabilitySetting_userId_key" ON "CapabilitySetting"("userId");

-- CreateIndex
CREATE INDEX "CapabilitySetting_userId_idx" ON "CapabilitySetting"("userId");

-- AddForeignKey
ALTER TABLE "CapabilitySetting" ADD CONSTRAINT "CapabilitySetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
