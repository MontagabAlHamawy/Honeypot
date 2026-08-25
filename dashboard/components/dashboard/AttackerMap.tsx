// honeypot/dashboard/components/dashboard/AttackerMap.tsx
"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { MapPin, Server, X } from "lucide-react";

interface MapPoint {
  id: string;
  ip: string;
  country: string | null;
  city: string | null;
  region: string | null;
  lat: number;
  lng: number;
  isp: string | null;
  startedAt: string;
  attackCount: number;
  isLocal?: boolean;
}

const SERVER_LAT_KEY = "hp_server_lat";
const SERVER_LNG_KEY = "hp_server_lng";
const SERVER_LABEL_KEY = "hp_server_label";

const MapWithNoSSR = dynamic(
  () => import("@/components/dashboard/LeafletMap"),
  {
    ssr: false,
    loading: () => (
      <div className="h-[360px] sm:h-[440px] lg:h-[500px] flex items-center justify-center text-muted-foreground text-sm">
        Loading map…
      </div>
    ),
  }
);

export default function AttackerMapClient() {
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MapPoint | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Server location state (for local network IPs)
  const [serverLat, setServerLat] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(SERVER_LAT_KEY) || "";
  });
  const [serverLng, setServerLng] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(SERVER_LNG_KEY) || "";
  });
  const [serverLabel, setServerLabel] = useState(() => {
    if (typeof window === "undefined") return "My Server";
    return localStorage.getItem(SERVER_LABEL_KEY) || "My Server";
  });

  function saveServerLocation() {
    localStorage.setItem(SERVER_LAT_KEY, serverLat);
    localStorage.setItem(SERVER_LNG_KEY, serverLng);
    localStorage.setItem(SERVER_LABEL_KEY, serverLabel);
    setShowSettings(false);
    // Re-process points with new server location
    fetchPoints();
  }

  function fetchPoints() {
    const lat = parseFloat(localStorage.getItem(SERVER_LAT_KEY) || "");
    const lng = parseFloat(localStorage.getItem(SERVER_LNG_KEY) || "");
    const label = localStorage.getItem(SERVER_LABEL_KEY) || "My Server";

    fetch("/api/map")
      .then((r) => r.json())
      .then((data: MapPoint[]) => {
        const processed = data.map((p) => {
          // Replace local network IPs with server coordinates
          if (
            p.country === "Local Network" ||
            p.ip?.startsWith("127.") ||
            p.ip?.startsWith("192.168.") ||
            p.ip?.startsWith("10.") ||
            p.ip?.startsWith("172.")
          ) {
            if (!isNaN(lat) && !isNaN(lng)) {
              return {
                ...p,
                lat,
                lng,
                country: label,
                city: "Local Network",
                isLocal: true,
              };
            }
            return { ...p, isLocal: true };
          }
          return p;
        });
        // Filter out local IPs with no coordinates
        const withCoords = processed.filter((p) => p.lat != null && p.lng != null && !isNaN(p.lat) && !isNaN(p.lng));
        setPoints(withCoords);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  useEffect(() => {
    fetchPoints();
  }, []);

  const localCount = points.filter((p) => p.isLocal).length;
  const countries = new Set(points.map((p) => p.country).filter(Boolean)).size;
  const topCountry = (() => {
    const cc: Record<string, number> = {};
    points.forEach((p) => { if (p.country) cc[p.country] = (cc[p.country] || 0) + 1; });
    const top = Object.entries(cc).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : "—";
  })();

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Locations</div>
          <div className="text-2xl font-bold font-mono text-foreground">{points.length}</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Countries</div>
          <div className="text-2xl font-bold font-mono text-foreground">{countries}</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Top Origin</div>
          <div className="text-sm font-mono text-primary font-medium truncate">{topCountry}</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Local IPs</div>
            <div className="text-2xl font-bold font-mono text-foreground">{localCount}</div>
          </div>
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg bg-secondary hover:bg-primary/10 hover:text-primary text-muted-foreground transition-all"
            title="Set server location for local network IPs"
          >
            <Server className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Server location settings modal */}
      {showSettings && (
        <div className="bg-card border border-primary/30 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">
                Server Location for Local Network IPs
              </span>
            </div>
            <button
              onClick={() => setShowSettings(false)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Local network IPs (192.168.x.x, 10.x.x.x) cannot be geolocated. Enter your server&apos;s
            coordinates to show them on the map.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-widest block mb-1">
                Latitude
              </label>
              <input
                type="number"
                step="0.0001"
                value={serverLat}
                onChange={(e) => setServerLat(e.target.value)}
                placeholder="e.g. 33.5138"
                className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-widest block mb-1">
                Longitude
              </label>
              <input
                type="number"
                step="0.0001"
                value={serverLng}
                onChange={(e) => setServerLng(e.target.value)}
                placeholder="e.g. 36.2765"
                className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-widest block mb-1">
                Label
              </label>
              <input
                type="text"
                value={serverLabel}
                onChange={(e) => setServerLabel(e.target.value)}
                placeholder="My Server"
                className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={saveServerLocation}
              className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-all"
            >
              Save & Apply
            </button>
            <p className="text-xs text-muted-foreground font-mono">
              💡 Find coordinates at maps.google.com → right-click your location
            </p>
          </div>
        </div>
      )}

      {/* Map */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="h-[360px] sm:h-[440px] lg:h-[500px] flex items-center justify-center text-muted-foreground text-sm">
            Loading map data…
          </div>
        ) : (
          <MapWithNoSSR points={points} onSelect={setSelected} />
        )}
      </div>

      {/* Selected point detail */}
      {selected && (
        <div className="bg-card border border-primary/30 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            {selected.isLocal ? (
              <Server className="w-4 h-4 text-yellow-400" />
            ) : (
              <MapPin className="w-4 h-4 text-primary" />
            )}
            <span className="font-mono text-sm font-semibold text-foreground">{selected.ip}</span>
            {selected.isLocal && (
              <span className="text-xs font-mono text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 px-2 py-0.5 rounded">
                Local Network
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono">
            <div><div className="text-muted-foreground">Country</div><div className="text-foreground">{selected.country || "—"}</div></div>
            <div><div className="text-muted-foreground">City</div><div className="text-foreground">{selected.city || "—"}</div></div>
            <div><div className="text-muted-foreground">ISP</div><div className="text-foreground truncate">{selected.isp || "—"}</div></div>
            <div>
              <div className="text-muted-foreground">Attacks</div>
              <div className={selected.attackCount > 0 ? "text-red-400" : "text-foreground"}>
                {selected.attackCount}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
