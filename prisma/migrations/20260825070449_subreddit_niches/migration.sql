/*
  Warnings:

  - You are about to drop the `SubredditList` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SubredditListItem` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "SubredditList" DROP CONSTRAINT "SubredditList_createdById_fkey";

-- DropForeignKey
ALTER TABLE "SubredditListItem" DROP CONSTRAINT "SubredditListItem_listId_fkey";

-- DropForeignKey
ALTER TABLE "SubredditListItem" DROP CONSTRAINT "SubredditListItem_subreddit_fkey";

-- DropTable
DROP TABLE "SubredditList";

-- DropTable
DROP TABLE "SubredditListItem";

-- CreateTable
CREATE TABLE "SubredditNiche" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "color" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubredditNiche_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubredditNicheItem" (
    "id" TEXT NOT NULL,
    "nicheId" TEXT NOT NULL,
    "subreddit" TEXT NOT NULL,
    "note" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubredditNicheItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubredditNiche_name_key" ON "SubredditNiche"("name");

-- CreateIndex
CREATE INDEX "SubredditNicheItem_subreddit_idx" ON "SubredditNicheItem"("subreddit");

-- CreateIndex
CREATE UNIQUE INDEX "SubredditNicheItem_nicheId_subreddit_key" ON "SubredditNicheItem"("nicheId", "subreddit");

-- AddForeignKey
ALTER TABLE "SubredditNiche" ADD CONSTRAINT "SubredditNiche_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubredditNicheItem" ADD CONSTRAINT "SubredditNicheItem_nicheId_fkey" FOREIGN KEY ("nicheId") REFERENCES "SubredditNiche"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubredditNicheItem" ADD CONSTRAINT "SubredditNicheItem_subreddit_fkey" FOREIGN KEY ("subreddit") REFERENCES "DiscoveredSubreddit"("name") ON DELETE SET NULL ON UPDATE CASCADE;
