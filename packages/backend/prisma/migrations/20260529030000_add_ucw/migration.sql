-- AlterTable
ALTER TABLE "User" ADD COLUMN "circleUcwUserId" TEXT;
ALTER TABLE "User" ADD COLUMN "circleUcwAddress" TEXT;

-- CreateIndex
CREATE INDEX "User_circleUcwAddress_idx" ON "User"("circleUcwAddress");
