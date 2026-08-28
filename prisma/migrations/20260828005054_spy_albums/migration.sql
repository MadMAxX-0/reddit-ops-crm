-- CreateTable
CREATE TABLE "SpyAlbum" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "color" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpyAlbum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpyAlbumItem" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpyAlbumItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpyAlbum_name_key" ON "SpyAlbum"("name");

-- CreateIndex
CREATE INDEX "SpyAlbumItem_targetId_idx" ON "SpyAlbumItem"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "SpyAlbumItem_albumId_targetId_key" ON "SpyAlbumItem"("albumId", "targetId");

-- AddForeignKey
ALTER TABLE "SpyAlbum" ADD CONSTRAINT "SpyAlbum_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpyAlbumItem" ADD CONSTRAINT "SpyAlbumItem_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "SpyAlbum"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpyAlbumItem" ADD CONSTRAINT "SpyAlbumItem_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "ScrapeTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
