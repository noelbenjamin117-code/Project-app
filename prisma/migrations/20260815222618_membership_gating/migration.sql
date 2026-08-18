/*
  Warnings:

  - You are about to drop the column `cancelAtPeriodEnd` on the `Membership` table. All the data in the column will be lost.
  - You are about to drop the column `paymentFailedAt` on the `Membership` table. All the data in the column will be lost.
  - You are about to drop the column `planName` on the `Membership` table. All the data in the column will be lost.
  - You are about to drop the column `stripePriceId` on the `Membership` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Membership" DROP COLUMN "cancelAtPeriodEnd",
DROP COLUMN "paymentFailedAt",
DROP COLUMN "planName",
DROP COLUMN "stripePriceId",
ADD COLUMN     "lastStripeEventAt" TIMESTAMP(3),
ADD COLUMN     "pastDueSince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MembershipOverride" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "activeUntil" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "byUserId" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MembershipOverride_memberId_activeUntil_idx" ON "MembershipOverride"("memberId", "activeUntil");

-- AddForeignKey
ALTER TABLE "MembershipOverride" ADD CONSTRAINT "MembershipOverride_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipOverride" ADD CONSTRAINT "MembershipOverride_byUserId_fkey" FOREIGN KEY ("byUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
