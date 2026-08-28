-- CreateEnum
CREATE TYPE "PipelineStage" AS ENUM ('CREATING', 'FARMING', 'CONTENT');

-- CreateEnum
CREATE TYPE "AccountFlag" AS ENUM ('NONE', 'BANNED', 'SHADOWBANNED', 'ON_HOLD');

-- AlterTable
ALTER TABLE "RedditAccount" ADD COLUMN     "device" TEXT,
ADD COLUMN     "flag" "AccountFlag" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "pipelineStage" "PipelineStage" NOT NULL DEFAULT 'CREATING';
