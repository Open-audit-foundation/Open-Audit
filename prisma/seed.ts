import { db } from "../lib/db/client";

async function main() {
  console.log("Seeding database...");

  // Create default reconciliation configuration
  await db.reconciliationConfig.upsert({
    where: { id: "current" },
    update: {},
    create: {
      id: "current",
      cronSchedule: "0 2 * * *", // Daily at 2 AM UTC
      batchSize: 1000,
      lookbackDays: 7,
      autoFix: false,
      alertThreshold: 0.1,
      enabled: true,
    },
  });

  console.log("✓ Seeding completed");
}

main()
  .catch((e) => {
    console.error("✗ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
