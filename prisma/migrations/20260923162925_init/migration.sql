-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('FINN_SEARCH', 'TEAMTAILOR', 'CAREER_PAGE', 'MANUAL');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('NY', 'FILTRERT', 'INTERESSANT', 'UNDER_ARBEID', 'SENDT', 'INTERVJU', 'TILBUD', 'AVSLAG', 'IKKE_AKTUELL');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('DELTID_STUDENT', 'INTERNSHIP', 'GRADUATE', 'FAST', 'ANNET');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('VC', 'PE', 'MA', 'INVESTERINGSSELSKAP', 'IB_ER', 'FORVALTNING', 'EIENDOM', 'CORP_FIN', 'CONTROLLER', 'ANNET');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('STATUS', 'EMAIL', 'NOTE', 'CALL');

-- CreateEnum
CREATE TYPE "EmailClass" AS ENUM ('BEKREFTELSE', 'INTERVJU', 'AVSLAG', 'TILBUD', 'FORESPORSEL', 'ANNET');

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SourceType" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastFound" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT,
    "url" TEXT NOT NULL,
    "externalId" TEXT,
    "dedupKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "streetAddress" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "country" TEXT,
    "remote" TEXT,
    "employmentType" TEXT,
    "deadline" TIMESTAMP(3),
    "deadlineText" TEXT,
    "datePosted" TIMESTAMP(3),
    "contactName" TEXT,
    "contactTitle" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "logoUrl" TEXT,
    "raw" JSONB,
    "jobType" "JobType",
    "category" "Category",
    "score" INTEGER,
    "scoreReason" TEXT,
    "scoredAt" TIMESTAMP(3),
    "status" "JobStatus" NOT NULL DEFAULT 'NY',
    "appliedAt" TIMESTAMP(3),
    "channel" TEXT,
    "nextStep" TEXT,
    "nextStepDate" TIMESTAMP(3),
    "notes" TEXT,
    "localFolder" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "text" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Email" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "uid" INTEGER NOT NULL,
    "from" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "snippet" TEXT NOT NULL,
    "classification" "EmailClass" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "suggestedStatus" "JobStatus",
    "jobId" TEXT,
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Email_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Job_url_key" ON "Job"("url");

-- CreateIndex
CREATE INDEX "Job_dedupKey_idx" ON "Job"("dedupKey");

-- CreateIndex
CREATE INDEX "Job_status_score_idx" ON "Job"("status", "score");

-- CreateIndex
CREATE INDEX "Event_jobId_at_idx" ON "Event"("jobId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Email_messageId_key" ON "Email"("messageId");

-- CreateIndex
CREATE INDEX "Email_jobId_idx" ON "Email"("jobId");

-- CreateIndex
CREATE INDEX "Email_handled_idx" ON "Email"("handled");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
