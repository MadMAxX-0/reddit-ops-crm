-- AlterTable
ALTER TABLE "OfCampaign" ADD COLUMN     "claimersCached" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "OfFanClaim" (
    "id" TEXT NOT NULL,
    "ofUserId" TEXT NOT NULL,
    "fanId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "fanUsername" TEXT,
    "claimedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfFanClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfTransaction" (
    "id" TEXT NOT NULL,
    "ofUserId" TEXT NOT NULL,
    "txId" TEXT NOT NULL,
    "fanId" TEXT,
    "ts" TIMESTAMP(3) NOT NULL,
    "grossCents" INTEGER NOT NULL,
    "netCents" INTEGER NOT NULL,
    "kind" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfFanClaim_campaignId_idx" ON "OfFanClaim"("campaignId");

-- CreateIndex
CREATE INDEX "OfFanClaim_ofUserId_fanId_idx" ON "OfFanClaim"("ofUserId", "fanId");

-- CreateIndex
CREATE UNIQUE INDEX "OfFanClaim_ofUserId_fanId_campaignId_key" ON "OfFanClaim"("ofUserId", "fanId", "campaignId");

-- CreateIndex
CREATE INDEX "OfTransaction_ofUserId_ts_idx" ON "OfTransaction"("ofUserId", "ts");

-- CreateIndex
CREATE INDEX "OfTransaction_fanId_ts_idx" ON "OfTransaction"("fanId", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "OfTransaction_ofUserId_txId_key" ON "OfTransaction"("ofUserId", "txId");

-- AddForeignKey
ALTER TABLE "OfFanClaim" ADD CONSTRAINT "OfFanClaim_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "OfCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
