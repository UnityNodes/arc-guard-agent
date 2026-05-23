ALTER TABLE "User" ADD COLUMN "privyUserId" TEXT;
CREATE UNIQUE INDEX "User_privyUserId_key" ON "User"("privyUserId");
