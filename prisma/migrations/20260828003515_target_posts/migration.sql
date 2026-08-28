-- CreateTable
CREATE TABLE "TargetPost" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "redditPostId" TEXT NOT NULL,
    "subreddit" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMetricAt" TIMESTAMP(3),

    CONSTRAINT "TargetPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TargetPost_redditPostId_key" ON "TargetPost"("redditPostId");

-- CreateIndex
CREATE INDEX "TargetPost_targetId_postedAt_idx" ON "TargetPost"("targetId", "postedAt");

-- CreateIndex
CREATE INDEX "TargetPost_subreddit_idx" ON "TargetPost"("subreddit");

-- AddForeignKey
ALTER TABLE "TargetPost" ADD CONSTRAINT "TargetPost_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "ScrapeTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
