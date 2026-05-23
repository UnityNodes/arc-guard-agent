-- CreateTable
CREATE TABLE "LimitOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromToken" TEXT NOT NULL,
    "toToken" TEXT NOT NULL,
    "watchToken" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "triggerPrice" DECIMAL(65,30) NOT NULL,
    "direction" TEXT NOT NULL,
    "slippage" DECIMAL(65,30) NOT NULL DEFAULT 0.5,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "retries" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "txHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LimitOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DCAOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromToken" TEXT NOT NULL,
    "toToken" TEXT NOT NULL,
    "amountPerCycle" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "totalRuns" INTEGER NOT NULL DEFAULT 0,
    "maxRuns" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DCAOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LimitOrder_status_idx" ON "LimitOrder"("status");

-- CreateIndex
CREATE INDEX "LimitOrder_userId_idx" ON "LimitOrder"("userId");

-- CreateIndex
CREATE INDEX "LimitOrder_status_expiresAt_idx" ON "LimitOrder"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "DCAOrder_status_idx" ON "DCAOrder"("status");

-- CreateIndex
CREATE INDEX "DCAOrder_userId_idx" ON "DCAOrder"("userId");

-- CreateIndex
CREATE INDEX "DCAOrder_status_nextRunAt_idx" ON "DCAOrder"("status", "nextRunAt");

-- AddForeignKey
ALTER TABLE "LimitOrder" ADD CONSTRAINT "LimitOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DCAOrder" ADD CONSTRAINT "DCAOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
