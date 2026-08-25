import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  variant?: "default" | "danger" | "warning" | "success";
}

export default function StatCard({ title, value, subtitle, icon: Icon, variant = "default" }: StatCardProps) {
  const variantStyles = {
    default: "border-border text-muted-foreground",
    danger: "border-red-500/20 text-red-400",
    warning: "border-yellow-500/20 text-yellow-400",
    success: "border-primary/20 text-primary",
  };

  const iconBg = {
    default: "bg-secondary",
    danger: "bg-red-400/10",
    warning: "bg-yellow-400/10",
    success: "bg-primary/10",
  };

  return (
    <div className={cn("bg-card border rounded-xl p-4 sm:p-6", variantStyles[variant])}>
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">{title}</p>
          <p className="text-2xl sm:text-3xl font-bold text-foreground font-mono">{value}</p>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", iconBg[variant])}>
          <Icon className={cn("w-5 h-5", variantStyles[variant])} />
        </div>
      </div>
    </div>
  );
}
