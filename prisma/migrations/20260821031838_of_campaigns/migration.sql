-- CreateTable
CREATE TABLE "OfCampaign" (
    "id" TEXT NOT NULL,
    "ofUserId" TEXT NOT NULL,
    "ofUsername" TEXT,
    "creatorId" TEXT,
    "campaignCode" INTEGER NOT NULL,
    "ofCampaignId" TEXT,
    "name" TEXT NOT NULL,
    "isReddit" BOOLEAN NOT NULL DEFAULT false,
    "redditOverride" BOOLEAN,
    "redditAccountId" TEXT,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "subs" INTEGER NOT NULL DEFAULT 0,
    "ofCreatedAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfCampaignSnapshot" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clicks" INTEGER NOT NULL,
    "subs" INTEGER NOT NULL,

    CONSTRAINT "OfCampaignSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfEarningsDay" (
    "id" TEXT NOT NULL,
    "ofUserId" TEXT NOT NULL,
    "creatorId" TEXT,
    "day" DATE NOT NULL,
    "netCents" INTEGER NOT NULL,
    "transactions" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfEarningsDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfCampaign_isReddit_idx" ON "OfCampaign"("isReddit");

-- CreateIndex
CREATE INDEX "OfCampaign_redditAccountId_idx" ON "OfCampaign"("redditAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "OfCampaign_ofUserId_campaignCode_key" ON "OfCampaign"("ofUserId", "campaignCode");

-- CreateIndex
CREATE INDEX "OfCampaignSnapshot_campaignId_ts_idx" ON "OfCampaignSnapshot"("campaignId", "ts");

-- CreateIndex
CREATE INDEX "OfEarningsDay_day_idx" ON "OfEarningsDay"("day");

-- CreateIndex
CREATE UNIQUE INDEX "OfEarningsDay_ofUserId_day_key" ON "OfEarningsDay"("ofUserId", "day");

-- AddForeignKey
ALTER TABLE "OfCampaign" ADD CONSTRAINT "OfCampaign_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfCampaign" ADD CONSTRAINT "OfCampaign_redditAccountId_fkey" FOREIGN KEY ("redditAccountId") REFERENCES "RedditAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfCampaignSnapshot" ADD CONSTRAINT "OfCampaignSnapshot_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "OfCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
