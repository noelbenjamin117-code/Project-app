-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "passPackId" TEXT;

-- AlterTable
ALTER TABLE "ClassInstance" ADD COLUMN     "payg" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ClassTemplate" ADD COLUMN     "payg" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "planKey" TEXT;

-- CreateTable
CREATE TABLE "PassPack" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "passesTotal" INTEGER NOT NULL,
    "passesUsed" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stripeSessionId" TEXT,
    "label" TEXT,

    CONSTRAINT "PassPack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PassPack_stripeSessionId_key" ON "PassPack"("stripeSessionId");

-- CreateIndex
CREATE INDEX "PassPack_memberId_expiresAt_idx" ON "PassPack"("memberId", "expiresAt");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_passPackId_fkey" FOREIGN KEY ("passPackId") REFERENCES "PassPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassPack" ADD CONSTRAINT "PassPack_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paidById" TEXT;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
