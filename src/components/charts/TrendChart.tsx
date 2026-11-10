"use client";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function TrendChart({ data }: { data: { date: string; conversations: number; leads: number }[] }) {
  return (
    <div dir="ltr" className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="gConv" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gLead" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--copper)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--copper)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: "var(--muted)", fontSize: 10.5 }}
            tickFormatter={(d: string) => d.slice(5).replace("-", "/")}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis
            tick={{ fill: "var(--muted)", fontSize: 10.5 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              fontSize: 12,
              fontFamily: "inherit",
              direction: "rtl",
            }}
            labelStyle={{ color: "var(--muted)" }}
            formatter={(value: any, name: any) => [value, name === "conversations" ? "محادثات" : "عملاء"]}
          />
          <Area
            type="monotone"
            dataKey="conversations"
            stroke="var(--primary)"
            strokeWidth={2}
            fill="url(#gConv)"
            name="conversations"
          />
          <Area
            type="monotone"
            dataKey="leads"
            stroke="var(--copper)"
            strokeWidth={2}
            fill="url(#gLead)"
            name="leads"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
