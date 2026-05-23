-- AlterTable
ALTER TABLE "AgentWallet" ADD COLUMN     "hiddenTokens" TEXT[] DEFAULT ARRAY[]::TEXT[];
