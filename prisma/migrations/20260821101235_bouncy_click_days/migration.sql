-- CreateTable
CREATE TABLE "BouncyLink" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "domain" TEXT,
    "destination" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "campaignId" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BouncyLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BouncyClickDay" (
    "id" TEXT NOT NULL,
    "bouncyId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "redditViews" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BouncyClickDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BouncyLink_linkId_key" ON "BouncyLink"("linkId");

-- CreateIndex
CREATE INDEX "BouncyLink_campaignId_idx" ON "BouncyLink"("campaignId");

-- CreateIndex
CREATE INDEX "BouncyClickDay_day_idx" ON "BouncyClickDay"("day");

-- CreateIndex
CREATE UNIQUE INDEX "BouncyClickDay_bouncyId_day_key" ON "BouncyClickDay"("bouncyId", "day");

-- AddForeignKey
ALTER TABLE "BouncyClickDay" ADD CONSTRAINT "BouncyClickDay_bouncyId_fkey" FOREIGN KEY ("bouncyId") REFERENCES "BouncyLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
