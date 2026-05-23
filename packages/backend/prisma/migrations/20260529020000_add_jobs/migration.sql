-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "clientAddress" TEXT NOT NULL,
    "providerAddress" TEXT NOT NULL,
    "evaluatorAddress" TEXT NOT NULL,
    "hookAddress" TEXT NOT NULL DEFAULT '0x0000000000000000000000000000000000000000',
    "description" TEXT NOT NULL,
    "expiredAt" TIMESTAMP(3) NOT NULL,
    "budgetUsdc" TEXT,
    "deliverableHash" TEXT,
    "reasonHash" TEXT,
    "createTxHash" TEXT,
    "budgetTxHash" TEXT,
    "fundTxHash" TEXT,
    "submitTxHash" TEXT,
    "completeTxHash" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Job_userId_idx" ON "Job"("userId");

-- CreateIndex
CREATE INDEX "Job_jobId_idx" ON "Job"("jobId");

-- CreateIndex
CREATE INDEX "Job_clientAddress_idx" ON "Job"("clientAddress");

-- CreateIndex
CREATE INDEX "Job_providerAddress_idx" ON "Job"("providerAddress");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
