-- AlterTable
ALTER TABLE "DiscoveredSubreddit" ADD COLUMN     "bansAskingForUpvotes" BOOLEAN,
ADD COLUMN     "bansSelfPromo" BOOLEAN,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "minAccountAgeDays" INTEGER,
ADD COLUMN     "minKarma" INTEGER,
ADD COLUMN     "originalContentOnly" BOOLEAN,
ADD COLUMN     "requiresVerification" BOOLEAN,
ADD COLUMN     "ruleCount" INTEGER,
ADD COLUMN     "rulesCheckedAt" TIMESTAMP(3),
ADD COLUMN     "rulesJson" JSONB,
ADD COLUMN     "submissionType" TEXT;

-- CreateTable
CREATE TABLE "SubredditList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubredditList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubredditListItem" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "subreddit" TEXT NOT NULL,
    "note" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubredditListItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubredditList_name_key" ON "SubredditList"("name");

-- CreateIndex
CREATE INDEX "SubredditListItem_subreddit_idx" ON "SubredditListItem"("subreddit");

-- CreateIndex
CREATE UNIQUE INDEX "SubredditListItem_listId_subreddit_key" ON "SubredditListItem"("listId", "subreddit");

-- AddForeignKey
ALTER TABLE "SubredditList" ADD CONSTRAINT "SubredditList_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubredditListItem" ADD CONSTRAINT "SubredditListItem_listId_fkey" FOREIGN KEY ("listId") REFERENCES "SubredditList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubredditListItem" ADD CONSTRAINT "SubredditListItem_subreddit_fkey" FOREIGN KEY ("subreddit") REFERENCES "DiscoveredSubreddit"("name") ON DELETE SET NULL ON UPDATE CASCADE;
