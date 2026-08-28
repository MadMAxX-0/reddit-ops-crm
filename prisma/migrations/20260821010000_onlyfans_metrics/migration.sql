-- AlterTable
ALTER TABLE "Creator" ADD COLUMN     "ofUserId" TEXT;

-- CreateTable
CREATE TABLE "OfSubscriberSnapshot" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeSubs" INTEGER NOT NULL,
    "expiredSubs" INTEGER NOT NULL,
    "totalSubs" INTEGER NOT NULL,
    "spenders" INTEGER NOT NULL,
    "totalSpentCents" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'theonlyapi',

    CONSTRAINT "OfSubscriberSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfEarningsSnapshot" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalCents" INTEGER NOT NULL,
    "prevTotalCents" INTEGER NOT NULL,
    "messagesCents" INTEGER NOT NULL,
    "subscriptionsCents" INTEGER NOT NULL,
    "tipsCents" INTEGER NOT NULL,
    "postsCents" INTEGER NOT NULL,
    "streamsCents" INTEGER NOT NULL,
    "referralsCents" INTEGER NOT NULL,
    "transactions" INTEGER NOT NULL,
    "accountsCount" INTEGER NOT NULL,
    "accountsNeverSynced" INTEGER NOT NULL,
    "chartDays" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "chartCents" INTEGER[] DEFAULT ARRAY[]::INTEGER[],

    CONSTRAINT "OfEarningsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfSubscriberSnapshot_creatorId_ts_idx" ON "OfSubscriberSnapshot"("creatorId", "ts");

-- CreateIndex
CREATE INDEX "OfEarningsSnapshot_period_ts_idx" ON "OfEarningsSnapshot"("period", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "OfEarningsSnapshot_period_ts_key" ON "OfEarningsSnapshot"("period", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "Creator_ofUserId_key" ON "Creator"("ofUserId");

-- AddForeignKey
ALTER TABLE "OfSubscriberSnapshot" ADD CONSTRAINT "OfSubscriberSnapshot_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

