-- CreateEnum
CREATE TYPE "CaptureKind" AS ENUM ('POST', 'PROFILE');

-- AlterEnum
ALTER TYPE "Platform" ADD VALUE 'X';

-- AlterTable
ALTER TABLE "CaptureJob" ADD COLUMN     "candidateId" TEXT,
ADD COLUMN     "kind" "CaptureKind" NOT NULL DEFAULT 'POST',
ADD COLUMN     "maxPosts" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "postsFound" INTEGER,
ADD COLUMN     "postsImported" INTEGER,
ADD COLUMN     "postsSkipped" INTEGER,
ADD COLUMN     "role" "DocumentRole" NOT NULL DEFAULT 'QUESTIONED';

