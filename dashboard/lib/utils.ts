import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function severityColor(severity: string): string {
  switch (severity?.toLowerCase()) {
    case "critical": return "text-red-400 bg-red-400/10 border-red-400/30";
    case "high": return "text-orange-400 bg-orange-400/10 border-orange-400/30";
    case "medium": return "text-yellow-400 bg-yellow-400/10 border-yellow-400/30";
    case "low": return "text-blue-400 bg-blue-400/10 border-blue-400/30";
    default: return "text-zinc-400 bg-zinc-400/10 border-zinc-400/30";
  }
}

export function attackTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    SQL_INJECTION: "SQL Injection",
    XSS: "XSS",
    PATH_TRAVERSAL: "Path Traversal",
    COMMAND_INJECTION: "Cmd Injection",
    BRUTE_FORCE: "Brute Force",
    WP_SCAN: "WP Scan",
    SCANNER_DETECTED: "Scanner",
  };
  return labels[type] || type;
}
