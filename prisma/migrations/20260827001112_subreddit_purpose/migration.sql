-- CreateEnum
CREATE TYPE "SubredditPurpose" AS ENUM ('PROMO', 'FARMING');

-- AlterTable
ALTER TABLE "Subreddit" ADD COLUMN     "purpose" "SubredditPurpose" NOT NULL DEFAULT 'PROMO';
