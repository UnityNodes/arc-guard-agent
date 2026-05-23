-- AlterTable
ALTER TABLE "AgentWallet" ADD COLUMN     "blockedTokens" TEXT[] DEFAULT ARRAY[]::TEXT[];
