import { db } from "../lib/db/client";

async function main() {
  console.log("Seeding database...");

  const recon = (db as { reconciliationConfig?: { upsert: (args: object) => Promise<unknown> } })
    .reconciliationConfig;
  if (!recon) {
    console.log("Skipping reconciliationConfig seed (model not in Prisma schema)");
    return;
  }

  await recon.upsert({
    where: { id: "current" },
    update: {},
    create: {
      id: "current",
      cronSchedule: "0 2 * * *",
      batchSize: 1000,
      lookbackDays: 7,
      autoFix: false,
      alertThreshold: 0.1,
      enabled: true,
    },
  });

  console.log("Seeding completed");
}

main()
  .catch((e) => {
    console.error("Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
