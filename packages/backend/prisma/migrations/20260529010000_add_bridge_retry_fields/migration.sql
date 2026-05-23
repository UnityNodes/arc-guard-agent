-- AlterTable
ALTER TABLE "BridgeTransaction" ADD COLUMN     "error" TEXT;
ALTER TABLE "BridgeTransaction" ADD COLUMN     "resultJson" TEXT;
ALTER TABLE "BridgeTransaction" ADD COLUMN     "lastRetryAt" TIMESTAMP(3);
