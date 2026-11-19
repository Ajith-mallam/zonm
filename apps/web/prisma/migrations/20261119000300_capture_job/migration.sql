-- CreateEnum
CREATE TYPE "CaptureStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "CaptureJob" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "url" TEXT NOT NULL,
    "status" "CaptureStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "autoAnalyse" BOOLEAN NOT NULL DEFAULT true,
    "providerRunId" TEXT,
    "costUsd" DOUBLE PRECISION,
    "sourceFileId" TEXT,
    "documentId" TEXT,
    "analysisRunId" TEXT,
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CaptureJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaptureJob_caseId_createdAt_idx" ON "CaptureJob"("caseId", "createdAt");

-- AddForeignKey
ALTER TABLE "CaptureJob" ADD CONSTRAINT "CaptureJob_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

