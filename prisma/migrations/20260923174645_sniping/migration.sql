-- AlterEnum
ALTER TYPE "Category" ADD VALUE 'LEDER';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SourceType" ADD VALUE 'NAV_SEARCH';
ALTER TYPE "SourceType" ADD VALUE 'WEBCRUITER';
ALTER TYPE "SourceType" ADD VALUE 'PHENOM';
ALTER TYPE "SourceType" ADD VALUE 'EMAIL_ALERT';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Job_status_postedAt_idx" ON "Job"("status", "postedAt");
