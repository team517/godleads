// Las gráficas de PulseBot (recharts, ~100 KB gz). Se cargan SOLO cuando hay una gráfica que
// pintar: antes venían en el trozo del chatbot, que a su vez se bajaba en todas las páginas.
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area, CartesianGrid, Legend,
} from "recharts";

export type ChartData = {
  type: "campaign_comparison" | "daily_activity" | "status_pie";
  title: string;
  data: any[];
};

const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2, 173 58% 39%))",
  "hsl(var(--chart-3, 197 37% 24%))",
  "hsl(var(--destructive))",
  "hsl(var(--chart-5, 27 87% 67%))",
];

export default function ChatbotChart({ chart, isFullscreen }: { chart: ChartData; isFullscreen: boolean }) {
  const h = isFullscreen ? 260 : 180;

  if (chart.type === "campaign_comparison") {
    return (
      <ResponsiveContainer width="100%" height={h}>
        <BarChart data={chart.data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="sent" name="Enviados" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
          <Bar dataKey="replied" name="Respondidos" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
          <Bar dataKey="bounced" name="Rebotados" fill={CHART_COLORS[3]} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (chart.type === "daily_activity") {
    return (
      <ResponsiveContainer width="100%" height={h}>
        <AreaChart data={chart.data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={4} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area type="monotone" dataKey="sent" name="Enviados" stroke={CHART_COLORS[0]} fill={CHART_COLORS[0]} fillOpacity={0.15} />
          <Area type="monotone" dataKey="replied" name="Respondidos" stroke={CHART_COLORS[1]} fill={CHART_COLORS[1]} fillOpacity={0.15} />
          <Area type="monotone" dataKey="bounced" name="Rebotados" stroke={CHART_COLORS[3]} fill={CHART_COLORS[3]} fillOpacity={0.15} />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  if (chart.type === "status_pie") {
    return (
      <ResponsiveContainer width="100%" height={h}>
        <PieChart>
          <Pie
            data={chart.data}
            cx="50%"
            cy="50%"
            innerRadius={isFullscreen ? 50 : 35}
            outerRadius={isFullscreen ? 85 : 60}
            paddingAngle={3}
            dataKey="value"
            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
            labelLine={{ strokeWidth: 1 }}
            style={{ fontSize: isFullscreen ? 11 : 9 }}
          >
            {chart.data.map((_: any, i: number) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  return null;
}
