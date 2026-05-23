-- CreateTable
CREATE TABLE "BotSwapGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotSwapGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BotSwapGrant_alertId_key" ON "BotSwapGrant"("alertId");

-- CreateIndex
CREATE INDEX "BotSwapGrant_userId_idx" ON "BotSwapGrant"("userId");

-- CreateIndex
CREATE INDEX "BotSwapGrant_expiresAt_idx" ON "BotSwapGrant"("expiresAt");

-- AddForeignKey
ALTER TABLE "BotSwapGrant" ADD CONSTRAINT "BotSwapGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotSwapGrant" ADD CONSTRAINT "BotSwapGrant_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
