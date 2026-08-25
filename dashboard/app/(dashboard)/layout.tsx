import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import Sidebar from "@/components/dashboard/Sidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen bg-background">
      <Sidebar userEmail={session.email} userRole={session.role} />
      <main className="min-h-screen overflow-x-hidden lg:ml-64">
        <div className="px-3 py-4 pt-16 sm:px-5 sm:py-6 sm:pt-16 lg:px-8 lg:py-8 lg:pt-8">
          {children}
        </div>
      </main>
    </div>
  );
}
