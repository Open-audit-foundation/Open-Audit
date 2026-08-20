import { db } from "../lib/db/client";

async function main() {
  console.log("Seeding database...");
  console.log("✓ Seeding completed (no seed data configured)");
}

main()
  .catch((e) => {
    console.error("✗ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
