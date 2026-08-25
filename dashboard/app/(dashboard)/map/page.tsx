import AttackerMapClient from "@/components/dashboard/AttackerMap";

export default function MapPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Attacker Map</h1>
        <p className="text-sm text-muted-foreground mt-1 font-mono">
          Global distribution of attack origins
        </p>
      </div>
      <AttackerMapClient />
    </div>
  );
}
