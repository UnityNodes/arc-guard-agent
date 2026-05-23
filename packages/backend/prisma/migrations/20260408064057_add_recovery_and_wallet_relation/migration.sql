-- CreateTable
CREATE TABLE "RecoveryRequest" (
    "id" TEXT NOT NULL,
    "agentAddress" TEXT NOT NULL,
    "requestorAddress" TEXT NOT NULL,
    "destinationAddr" TEXT NOT NULL,
    "signedMessage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "adminNotes" TEXT,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecoveryRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecoveryRequest_agentAddress_idx" ON "RecoveryRequest"("agentAddress");

-- CreateIndex
CREATE INDEX "RecoveryRequest_status_idx" ON "RecoveryRequest"("status");

-- CreateIndex
CREATE INDEX "RecoveryRequest_requestorAddress_idx" ON "RecoveryRequest"("requestorAddress");

-- CreateIndex
CREATE INDEX "Alert_userId_status_idx" ON "Alert"("userId", "status");

-- CreateIndex
CREATE INDEX "Alert_userId_createdAt_idx" ON "Alert"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Alert_status_escalation1At_idx" ON "Alert"("status", "escalation1At");

-- CreateIndex
CREATE INDEX "ChatMessage_userId_createdAt_idx" ON "ChatMessage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Rule_userId_isActive_idx" ON "Rule"("userId", "isActive");

-- CreateIndex
CREATE INDEX "Rule_isActive_lastTriggeredAt_idx" ON "Rule"("isActive", "lastTriggeredAt");

-- AddForeignKey
ALTER TABLE "AgentWallet" ADD CONSTRAINT "AgentWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
