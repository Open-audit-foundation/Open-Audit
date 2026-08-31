-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "hashedKey" TEXT NOT NULL,
    "appName" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_hashedKey_key" ON "ApiKey"("hashedKey");

-- CreateIndex
CREATE INDEX "ApiKey_hashedKey_idx" ON "ApiKey"("hashedKey");

-- CreateIndex
CREATE INDEX "ApiKey_isActive_idx" ON "ApiKey"("isActive");
