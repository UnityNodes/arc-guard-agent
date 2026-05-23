-- CreateTable
CREATE TABLE "AgentTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "tokenIn" TEXT NOT NULL,
    "tokenOut" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "amountUsd" DOUBLE PRECISION,
    "txHash" TEXT,
    "toAddress" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "network" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentTransaction_userId_idx" ON "AgentTransaction"("userId");

-- CreateIndex
CREATE INDEX "AgentTransaction_createdAt_idx" ON "AgentTransaction"("createdAt");
