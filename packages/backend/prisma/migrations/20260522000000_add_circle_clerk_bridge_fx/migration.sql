-- AlterTable
ALTER TABLE "AgentWallet" ADD COLUMN     "circleWalletId" TEXT,
ADD COLUMN     "circleWalletSetId" TEXT,
ALTER COLUMN "network" SET DEFAULT 'arc-testnet';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "clerkId" TEXT,
ADD COLUMN     "email" TEXT;

-- CreateTable
CREATE TABLE "BridgeTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromChain" TEXT NOT NULL,
    "toChain" TEXT NOT NULL,
    "fromToken" TEXT NOT NULL,
    "toToken" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "txHash" TEXT,
    "destinationTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BridgeTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxHedge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromToken" TEXT NOT NULL,
    "toToken" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "triggerRate" DECIMAL(65,30) NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'BELOW',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "txHash" TEXT,
    "filledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FxHedge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BridgeTransaction_userId_idx" ON "BridgeTransaction"("userId");

-- CreateIndex
CREATE INDEX "BridgeTransaction_status_idx" ON "BridgeTransaction"("status");

-- CreateIndex
CREATE INDEX "FxHedge_userId_idx" ON "FxHedge"("userId");

-- CreateIndex
CREATE INDEX "FxHedge_status_idx" ON "FxHedge"("status");

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkId_key" ON "User"("clerkId");

-- AddForeignKey
ALTER TABLE "BridgeTransaction" ADD CONSTRAINT "BridgeTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FxHedge" ADD CONSTRAINT "FxHedge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

