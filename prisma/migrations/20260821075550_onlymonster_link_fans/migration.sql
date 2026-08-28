-- CreateTable
CREATE TABLE "OmLinkFan" (
    "id" TEXT NOT NULL,
    "ofUserId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "fanId" TEXT NOT NULL,
    "fanUsername" TEXT,
    "subscribedAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OmLinkFan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OmLinkFan_ofUserId_subscribedAt_idx" ON "OmLinkFan"("ofUserId", "subscribedAt");

-- CreateIndex
CREATE INDEX "OmLinkFan_fanId_idx" ON "OmLinkFan"("fanId");

-- CreateIndex
CREATE UNIQUE INDEX "OmLinkFan_linkId_fanId_key" ON "OmLinkFan"("linkId", "fanId");
