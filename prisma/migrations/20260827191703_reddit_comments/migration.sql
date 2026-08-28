-- CreateTable
CREATE TABLE "RedditComment" (
    "id" TEXT NOT NULL,
    "redditAccountId" TEXT NOT NULL,
    "redditCommentId" TEXT NOT NULL,
    "subreddit" TEXT NOT NULL,
    "linkTitle" TEXT,
    "permalink" TEXT,
    "body" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMetricAt" TIMESTAMP(3),

    CONSTRAINT "RedditComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RedditComment_redditCommentId_key" ON "RedditComment"("redditCommentId");

-- CreateIndex
CREATE INDEX "RedditComment_redditAccountId_postedAt_idx" ON "RedditComment"("redditAccountId", "postedAt");

-- CreateIndex
CREATE INDEX "RedditComment_subreddit_idx" ON "RedditComment"("subreddit");

-- AddForeignKey
ALTER TABLE "RedditComment" ADD CONSTRAINT "RedditComment_redditAccountId_fkey" FOREIGN KEY ("redditAccountId") REFERENCES "RedditAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
