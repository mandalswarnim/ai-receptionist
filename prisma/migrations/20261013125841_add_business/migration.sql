-- CreateEnum
CREATE TYPE "BusinessMode" AS ENUM ('DEMO', 'LIVE');

-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "businessId" TEXT;

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "BusinessMode" NOT NULL DEFAULT 'DEMO',
    "personaName" TEXT NOT NULL,
    "greeting" TEXT,
    "openingHours" TEXT,
    "address" TEXT,
    "bookingSystem" TEXT,
    "bookingInstructions" TEXT,
    "menuNotes" TEXT,
    "faqs" JSONB NOT NULL DEFAULT '[]',
    "notifyEmail" TEXT,
    "twilioNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Business_slug_key" ON "Business"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Business_twilioNumber_key" ON "Business"("twilioNumber");

-- CreateIndex
CREATE INDEX "Call_businessId_idx" ON "Call"("businessId");

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
