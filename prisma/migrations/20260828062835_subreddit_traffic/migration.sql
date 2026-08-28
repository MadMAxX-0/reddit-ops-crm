-- AlterTable
ALTER TABLE "DiscoveredSubreddit" ADD COLUMN     "medianScore" INTEGER,
ADD COLUMN     "postsPerDay" DOUBLE PRECISION,
ADD COLUMN     "topScore" INTEGER,
ADD COLUMN     "trafficCheckedAt" TIMESTAMP(3);
