-- AlterTable
ALTER TABLE "DiscoveredSubreddit" ADD COLUMN     "comments" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SubredditObservation" ADD COLUMN     "comments" INTEGER NOT NULL DEFAULT 0;
