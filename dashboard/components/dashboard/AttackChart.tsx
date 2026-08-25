"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface Props {
  data: { day: string; count: number }[];
}

export default function AttackChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
        No data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="attackGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#4ade80" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#4ade80" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis
          dataKey="day"
          tick={{ fill: "#6b7280", fontSize: 10, fontFamily: "IBM Plex Mono" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fill: "#6b7280", fontSize: 10, fontFamily: "IBM Plex Mono" }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(222 20% 8%)",
            border: "1px solid hsl(222 20% 14%)",
            borderRadius: "8px",
            fontSize: "12px",
            fontFamily: "IBM Plex Mono",
            color: "#e2e8f0",
          }}
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke="#4ade80"
          strokeWidth={2}
          fill="url(#attackGrad)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
