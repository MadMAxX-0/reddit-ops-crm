-- Albums now collect posts (a swipe file), not accounts. Account grouping moves
-- to a plain tag list, because a tag has no properties of its own.
DROP TABLE IF EXISTS "SpyAlbumItem";

CREATE TABLE "SpyAlbumPost" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "note" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpyAlbumPost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SpyAlbumPost_albumId_postId_key" ON "SpyAlbumPost"("albumId", "postId");
CREATE INDEX "SpyAlbumPost_postId_idx" ON "SpyAlbumPost"("postId");

ALTER TABLE "SpyAlbumPost" ADD CONSTRAINT "SpyAlbumPost_albumId_fkey"
  FOREIGN KEY ("albumId") REFERENCES "SpyAlbum"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SpyAlbumPost" ADD CONSTRAINT "SpyAlbumPost_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "TargetPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScrapeTarget" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
