"use client";

import { useEffect, useRef } from "react";

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
}

interface Props {
  points: MapPoint[];
  onSelect: (p: MapPoint) => void;
}

export default function LeafletMap({ points, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // إذا كانت الخريطة موجودة مسبقاً (StrictMode double-mount)، امسحها
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    import("leaflet").then((L) => {
      if (!containerRef.current || mapRef.current) return;

      // أضف CSS مرة واحدة فقط
      if (!document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id = "leaflet-css";
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }

      const map = L.default.map(containerRef.current, {
        center: [20, 0],
        zoom: 2,
      });
      mapRef.current = map;

      L.default
        .tileLayer(
          "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
          {
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: "abcd",
            maxZoom: 20,
          }
        )
        .addTo(map);

      points.forEach((p) => {
        const color = p.attackCount > 0 ? "#ef4444" : "#4ade80";
        const radius = p.attackCount > 0 ? Math.min(6 + p.attackCount, 20) : 5;

        const marker = L.default
          .circleMarker([p.lat, p.lng], {
            color,
            fillColor: color,
            fillOpacity: 0.7,
            weight: 1,
            radius,
          })
          .addTo(map);

        marker.bindPopup(`
          <div style="font-family:monospace;font-size:12px;padding:4px">
            <strong>${p.ip}</strong><br/>
            ${[p.city, p.country].filter(Boolean).join(", ") || "Unknown"}
            ${p.attackCount > 0 ? `<br/><span style="color:#ef4444">⚠ ${p.attackCount} attacks</span>` : ""}
            ${p.isp ? `<br/><small>${p.isp}</small>` : ""}
          </div>`);

        marker.on("click", () => onSelect(p));
      });

    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [points]);

  useEffect(() => {
    const syncMapSize = () => {
      const map = mapRef.current;
      if (!map) return;
      try {
        map.invalidateSize();
      } catch {
        // ignore resize race conditions
      }
    };

    window.addEventListener("resize", syncMapSize);
    const timer = window.setTimeout(syncMapSize, 80);
    return () => {
      window.removeEventListener("resize", syncMapSize);
      window.clearTimeout(timer);
    };
  }, [points]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", background: "#0a0e14" }}
      className="h-[360px] sm:h-[440px] lg:h-[500px] rounded-xl"
    />
  );
}
