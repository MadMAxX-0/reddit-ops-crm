-- AlterTable
ALTER TABLE "OfSubscriberSnapshot" ADD COLUMN     "ofUserId" TEXT,
ALTER COLUMN "creatorId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "OfSubscriberSnapshot_ofUserId_ts_idx" ON "OfSubscriberSnapshot"("ofUserId", "ts");
