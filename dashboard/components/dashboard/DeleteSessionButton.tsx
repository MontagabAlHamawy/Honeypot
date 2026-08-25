// honeypot/dashboard/components/dashboard/DeleteSessionButton.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, AlertTriangle } from "lucide-react";

export default function DeleteSessionButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/delete`, {
        method: "DELETE",
      });
      if (res.ok) {
        router.push("/sessions");
        router.refresh();
      } else {
        alert("Failed to delete session");
        setLoading(false);
        setConfirm(false);
      }
    } catch {
      alert("Network error");
      setLoading(false);
      setConfirm(false);
    }
  }

  if (confirm) {
    return (
      <div className="flex flex-wrap items-center gap-2 bg-red-400/10 border border-red-400/30 rounded-lg px-3 sm:px-4 py-2">
        <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
        <span className="text-xs text-red-400 font-mono">Delete all session data?</span>
        <button
          onClick={handleDelete}
          disabled={loading}
          className="bg-red-500 text-white px-3 py-1 rounded text-xs font-medium hover:bg-red-600 disabled:opacity-50 transition-all"
        >
          {loading ? "Deleting…" : "Confirm"}
        </button>
        <button
          onClick={() => setConfirm(false)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirm(true)}
      className="w-full sm:w-auto justify-center sm:justify-start flex items-center gap-2 bg-secondary hover:bg-red-400/10 hover:text-red-400 text-muted-foreground px-4 py-2 rounded-lg text-sm font-medium border border-border hover:border-red-400/30 transition-all"
    >
      <Trash2 className="w-4 h-4" />
      Delete Session
    </button>
  );
}
