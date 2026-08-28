-- AlterTable
ALTER TABLE "AccountHealthSnapshot" ADD COLUMN     "followers" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "RedditAccount" ADD COLUMN     "followers" INTEGER NOT NULL DEFAULT 0;
