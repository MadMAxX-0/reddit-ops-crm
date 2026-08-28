-- CreateEnum
CREATE TYPE "RemovedBy" AS ENUM ('MOD', 'REDDIT', 'AUTHOR', 'UNKNOWN');

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "removedBy" "RemovedBy";
