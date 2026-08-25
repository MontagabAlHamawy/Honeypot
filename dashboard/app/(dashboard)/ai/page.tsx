// PATH: dashboard/app/(dashboard)/ai/page.tsx
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import AIAnalysisClient from "./AIAnalysisClient";

export const metadata = { title: "AI Security Analysis — HoneyShield" };

export default async function AIPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return <AIAnalysisClient />;
}
