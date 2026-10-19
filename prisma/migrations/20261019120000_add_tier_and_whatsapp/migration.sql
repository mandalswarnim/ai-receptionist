-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('AGATHOS', 'ARETE', 'ARISTEIA', 'AXIOM');

-- CreateEnum
CREATE TYPE "NotifyChannel" AS ENUM ('EMAIL', 'WHATSAPP', 'BOTH');

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "tier" "Tier" NOT NULL DEFAULT 'AGATHOS',
ADD COLUMN     "notifyChannel" "NotifyChannel" NOT NULL DEFAULT 'EMAIL',
ADD COLUMN     "whatsappNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "whatsappOptInAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "whatsappSentAt" TIMESTAMP(3);
