-- AlterTable
ALTER TABLE "DiscoveredSubreddit" ADD COLUMN     "allowsGalleries" BOOLEAN,
ADD COLUMN     "allowsImages" BOOLEAN,
ADD COLUMN     "allowsVideos" BOOLEAN,
ADD COLUMN     "quarantined" BOOLEAN,
ADD COLUMN     "restrictedPosting" BOOLEAN,
ADD COLUMN     "subCreatedAt" TIMESTAMP(3),
ADD COLUMN     "submitText" TEXT,
ADD COLUMN     "subredditType" TEXT;
