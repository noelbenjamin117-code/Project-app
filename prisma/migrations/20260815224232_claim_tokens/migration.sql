-- AlterTable
ALTER TABLE "User" ADD COLUMN     "legacyPlan" TEXT;

-- CreateTable
CREATE TABLE "ClaimToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClaimToken_token_key" ON "ClaimToken"("token");

-- CreateIndex
CREATE INDEX "ClaimToken_userId_idx" ON "ClaimToken"("userId");

-- CreateIndex
CREATE INDEX "ClaimToken_usedAt_idx" ON "ClaimToken"("usedAt");

-- AddForeignKey
ALTER TABLE "ClaimToken" ADD CONSTRAINT "ClaimToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
