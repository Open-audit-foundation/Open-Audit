import { notFound } from "next/navigation";
import { AdminDashboardClient } from "./AdminDashboardClient";

export default function AdminPage() {
  if (process.env.ENABLE_ADMIN_DASHBOARD !== "true") {
    notFound();
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">System Administration Dashboard</h1>
        <p className="text-muted-foreground mt-2">
          Real-time view of system operational health, security metrics, and WASM sandbox execution stats.
        </p>
      </div>
      <AdminDashboardClient />
    </div>
  );
}
