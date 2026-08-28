-- AlterTable
ALTER TABLE "RedditAccount" ADD COLUMN     "farmedById" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "monthlyAccountGoal" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "RedditAccount" ADD CONSTRAINT "RedditAccount_farmedById_fkey" FOREIGN KEY ("farmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
