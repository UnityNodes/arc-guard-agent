-- AlterTable
ALTER TABLE "AgentWallet" ADD COLUMN     "cdpWalletData" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "autoMode" BOOLEAN NOT NULL DEFAULT false;
