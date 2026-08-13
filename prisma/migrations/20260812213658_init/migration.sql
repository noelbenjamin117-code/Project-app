-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'COACH', 'MEMBER');

-- CreateEnum
CREATE TYPE "CancelPolicyType" AS ENUM ('ABSOLUTE', 'RELATIVE', 'NONE');

-- CreateEnum
CREATE TYPE "ClassStatus" AS ENUM ('SCHEDULED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('BOOKED', 'WAITLISTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('SELF', 'COACH', 'WALK_IN');

-- CreateEnum
CREATE TYPE "StrikeType" AS ENUM ('LATE_CANCEL', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "WodType" AS ENUM ('AMRAP', 'EMOM', 'FOR_TIME', 'RFT', 'STRENGTH');

-- CreateEnum
CREATE TYPE "ScoreType" AS ENUM ('TIME', 'ROUNDS_REPS', 'REPS', 'LOAD');

-- CreateEnum
CREATE TYPE "ScalingLevel" AS ENUM ('RX_PLUS', 'RX', 'SCALED');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('WAITLIST_PROMOTED', 'CLASS_CANCELLED', 'STRIKE_RECORDED', 'SUSPENDED', 'SUSPENSION_LIFTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTimeLocal" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "capacity" INTEGER NOT NULL,
    "defaultCoachId" TEXT,
    "cancelPolicyType" "CancelPolicyType" NOT NULL,
    "cancelAbsoluteTimeLocal" TEXT,
    "cancelRelativeHours" INTEGER,
    "activeFrom" TEXT NOT NULL,
    "activeUntil" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassInstance" (
    "id" TEXT NOT NULL,
    "templateId" TEXT,
    "name" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "coachId" TEXT,
    "cancelPolicyType" "CancelPolicyType" NOT NULL,
    "cancelAbsoluteTimeLocal" TEXT,
    "cancelRelativeHours" INTEGER,
    "cancelDeadlineAt" TIMESTAMP(3) NOT NULL,
    "status" "ClassStatus" NOT NULL DEFAULT 'SCHEDULED',
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "cancelledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "classInstanceId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL,
    "source" "BookingSource" NOT NULL DEFAULT 'SELF',
    "bookedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "waitlistedAt" TIMESTAMP(3),
    "promotedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "lateCancel" BOOLEAN NOT NULL DEFAULT false,
    "checkedInAt" TIMESTAMP(3),
    "checkedInById" TEXT,
    "noShow" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrikeEvent" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "bookingId" TEXT,
    "type" "StrikeType" NOT NULL,
    "weight" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "forgivenAt" TIMESTAMP(3),
    "forgivenById" TEXT,
    "forgivenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrikeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuspensionOverride" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "liftedAt" TIMESTAMP(3) NOT NULL,
    "byUserId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuspensionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Movement" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isBarbellLift" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WodDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "isBenchmark" BOOLEAN NOT NULL DEFAULT false,
    "type" "WodType" NOT NULL,
    "scoreType" "ScoreType" NOT NULL,
    "timeCapSeconds" INTEGER,
    "description" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WodDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WodScalingOption" (
    "id" TEXT NOT NULL,
    "wodDefinitionId" TEXT NOT NULL,
    "level" "ScalingLevel" NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "WodScalingOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledWod" (
    "id" TEXT NOT NULL,
    "wodDefinitionId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledWod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledWodClass" (
    "scheduledWodId" TEXT NOT NULL,
    "classInstanceId" TEXT NOT NULL,

    CONSTRAINT "ScheduledWodClass_pkey" PRIMARY KEY ("scheduledWodId","classInstanceId")
);

-- CreateTable
CREATE TABLE "Result" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "wodDefinitionId" TEXT NOT NULL,
    "scheduledWodId" TEXT,
    "classInstanceId" TEXT,
    "scalingLevel" "ScalingLevel" NOT NULL,
    "timeSeconds" INTEGER,
    "rounds" INTEGER,
    "reps" INTEGER,
    "loadKg" DOUBLE PRECISION,
    "cappedOut" BOOLEAN NOT NULL DEFAULT false,
    "capReps" INTEGER,
    "notes" TEXT,
    "isPr" BOOLEAN NOT NULL DEFAULT false,
    "performedOn" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiftResult" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "reps" INTEGER NOT NULL,
    "loadKg" DOUBLE PRECISION NOT NULL,
    "resultId" TEXT,
    "isPr" BOOLEAN NOT NULL DEFAULT false,
    "performedOn" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiftResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "ClassTemplate_dayOfWeek_archived_idx" ON "ClassTemplate"("dayOfWeek", "archived");

-- CreateIndex
CREATE INDEX "ClassInstance_date_idx" ON "ClassInstance"("date");

-- CreateIndex
CREATE INDEX "ClassInstance_startsAt_idx" ON "ClassInstance"("startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClassInstance_templateId_date_key" ON "ClassInstance"("templateId", "date");

-- CreateIndex
CREATE INDEX "Booking_classInstanceId_status_idx" ON "Booking"("classInstanceId", "status");

-- CreateIndex
CREATE INDEX "Booking_memberId_status_idx" ON "Booking"("memberId", "status");

-- CreateIndex
CREATE INDEX "Booking_classInstanceId_status_waitlistedAt_id_idx" ON "Booking"("classInstanceId", "status", "waitlistedAt", "id");

-- CreateIndex
CREATE INDEX "StrikeEvent_memberId_occurredAt_idx" ON "StrikeEvent"("memberId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "StrikeEvent_bookingId_type_key" ON "StrikeEvent"("bookingId", "type");

-- CreateIndex
CREATE INDEX "SuspensionOverride_memberId_liftedAt_idx" ON "SuspensionOverride"("memberId", "liftedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Movement_name_key" ON "Movement"("name");

-- CreateIndex
CREATE INDEX "WodDefinition_isBenchmark_idx" ON "WodDefinition"("isBenchmark");

-- CreateIndex
CREATE UNIQUE INDEX "WodScalingOption_wodDefinitionId_level_key" ON "WodScalingOption"("wodDefinitionId", "level");

-- CreateIndex
CREATE INDEX "ScheduledWod_date_idx" ON "ScheduledWod"("date");

-- CreateIndex
CREATE INDEX "Result_wodDefinitionId_scalingLevel_idx" ON "Result"("wodDefinitionId", "scalingLevel");

-- CreateIndex
CREATE INDEX "Result_memberId_performedOn_idx" ON "Result"("memberId", "performedOn");

-- CreateIndex
CREATE UNIQUE INDEX "Result_memberId_scheduledWodId_key" ON "Result"("memberId", "scheduledWodId");

-- CreateIndex
CREATE INDEX "LiftResult_memberId_movementId_reps_idx" ON "LiftResult"("memberId", "movementId", "reps");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "ClassInstance" ADD CONSTRAINT "ClassInstance_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ClassTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassInstance" ADD CONSTRAINT "ClassInstance_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassInstance" ADD CONSTRAINT "ClassInstance_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_classInstanceId_fkey" FOREIGN KEY ("classInstanceId") REFERENCES "ClassInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_checkedInById_fkey" FOREIGN KEY ("checkedInById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrikeEvent" ADD CONSTRAINT "StrikeEvent_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrikeEvent" ADD CONSTRAINT "StrikeEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrikeEvent" ADD CONSTRAINT "StrikeEvent_forgivenById_fkey" FOREIGN KEY ("forgivenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuspensionOverride" ADD CONSTRAINT "SuspensionOverride_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuspensionOverride" ADD CONSTRAINT "SuspensionOverride_byUserId_fkey" FOREIGN KEY ("byUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WodDefinition" ADD CONSTRAINT "WodDefinition_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WodScalingOption" ADD CONSTRAINT "WodScalingOption_wodDefinitionId_fkey" FOREIGN KEY ("wodDefinitionId") REFERENCES "WodDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledWod" ADD CONSTRAINT "ScheduledWod_wodDefinitionId_fkey" FOREIGN KEY ("wodDefinitionId") REFERENCES "WodDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledWodClass" ADD CONSTRAINT "ScheduledWodClass_scheduledWodId_fkey" FOREIGN KEY ("scheduledWodId") REFERENCES "ScheduledWod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledWodClass" ADD CONSTRAINT "ScheduledWodClass_classInstanceId_fkey" FOREIGN KEY ("classInstanceId") REFERENCES "ClassInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Result" ADD CONSTRAINT "Result_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Result" ADD CONSTRAINT "Result_wodDefinitionId_fkey" FOREIGN KEY ("wodDefinitionId") REFERENCES "WodDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Result" ADD CONSTRAINT "Result_scheduledWodId_fkey" FOREIGN KEY ("scheduledWodId") REFERENCES "ScheduledWod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Result" ADD CONSTRAINT "Result_classInstanceId_fkey" FOREIGN KEY ("classInstanceId") REFERENCES "ClassInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiftResult" ADD CONSTRAINT "LiftResult_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiftResult" ADD CONSTRAINT "LiftResult_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "Movement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiftResult" ADD CONSTRAINT "LiftResult_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "Result"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
