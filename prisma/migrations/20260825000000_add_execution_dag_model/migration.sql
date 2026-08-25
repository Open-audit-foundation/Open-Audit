-- CreateTable
CREATE TABLE "ExecutionDag" (
    "id" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "timestamp" INTEGER NOT NULL,
    "nodes" JSONB NOT NULL,
    "maxDepth" INTEGER NOT NULL,
    "uniqueContracts" INTEGER NOT NULL,
    "hasReentrancy" BOOLEAN NOT NULL DEFAULT false,
    "reentrancyDetails" JSONB NOT NULL,
    "authTraces" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecutionDag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionDag_txHash_key" ON "ExecutionDag"("txHash");

-- CreateIndex
CREATE INDEX "ExecutionDag_ledger_idx" ON "ExecutionDag"("ledger");

-- CreateIndex
CREATE INDEX "ExecutionDag_txHash_idx" ON "ExecutionDag"("txHash");

-- CreateIndex
CREATE INDEX "ExecutionDag_hasReentrancy_idx" ON "ExecutionDag"("hasReentrancy");

-- CreateIndex
CREATE INDEX "ExecutionDag_ledger_hasReentrancy_idx" ON "ExecutionDag"("ledger", "hasReentrancy");

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "executionDagId" TEXT;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_executionDagId_fkey" FOREIGN KEY ("executionDagId") REFERENCES "ExecutionDag"("id") ON DELETE SET NULL ON UPDATE CASCADE;
