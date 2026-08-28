-- CreateTable
CREATE TABLE "OfFan" (
    "id" TEXT NOT NULL,
    "ofUserId" TEXT NOT NULL,
    "fanId" TEXT NOT NULL,
    "subscribedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "totalSpentCents" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfFan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfFan_ofUserId_subscribedAt_idx" ON "OfFan"("ofUserId", "subscribedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OfFan_ofUserId_fanId_key" ON "OfFan"("ofUserId", "fanId");
