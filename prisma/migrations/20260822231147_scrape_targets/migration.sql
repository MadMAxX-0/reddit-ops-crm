-- CreateTable
CREATE TABLE "ScrapeTarget" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "note" TEXT,
    "addedById" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastScrapedAt" TIMESTAMP(3),
    "postsSeen" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapeTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubredditObservation" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "subreddit" TEXT NOT NULL,
    "posts" INTEGER NOT NULL DEFAULT 0,
    "totalScore" INTEGER NOT NULL DEFAULT 0,
    "bestScore" INTEGER NOT NULL DEFAULT 0,
    "lastPostAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubredditObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveredSubreddit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subscribers" INTEGER,
    "over18" BOOLEAN NOT NULL DEFAULT false,
    "posts" INTEGER NOT NULL DEFAULT 0,
    "targets" INTEGER NOT NULL DEFAULT 0,
    "avgScore" INTEGER NOT NULL DEFAULT 0,
    "bestScore" INTEGER NOT NULL DEFAULT 0,
    "lastPostAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "promoted" BOOLEAN NOT NULL DEFAULT false,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DiscoveredSubreddit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScrapeTarget_username_key" ON "ScrapeTarget"("username");

-- CreateIndex
CREATE INDEX "ScrapeTarget_active_idx" ON "ScrapeTarget"("active");

-- CreateIndex
CREATE INDEX "SubredditObservation_subreddit_idx" ON "SubredditObservation"("subreddit");

-- CreateIndex
CREATE UNIQUE INDEX "SubredditObservation_targetId_subreddit_key" ON "SubredditObservation"("targetId", "subreddit");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveredSubreddit_name_key" ON "DiscoveredSubreddit"("name");

-- CreateIndex
CREATE INDEX "DiscoveredSubreddit_promoted_dismissed_idx" ON "DiscoveredSubreddit"("promoted", "dismissed");

-- CreateIndex
CREATE INDEX "DiscoveredSubreddit_targets_idx" ON "DiscoveredSubreddit"("targets");

-- AddForeignKey
ALTER TABLE "SubredditObservation" ADD CONSTRAINT "SubredditObservation_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "ScrapeTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
