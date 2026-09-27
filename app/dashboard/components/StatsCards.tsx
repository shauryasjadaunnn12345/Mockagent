import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Tool } from "@/types/database";

interface StatsCardsProps {
  tools: Tool[];
  totalCalls: number;
  schemaViolations: number;
}

export function StatsCards({ tools, totalCalls, schemaViolations }: StatsCardsProps) {
  const activeTools = tools.filter((t) => t.is_active).length;
  const successRate = totalCalls === 0 ? 0 : Math.round(((totalCalls - schemaViolations) / totalCalls) * 100);

  const stats = [
    { label: "Active Tools", value: activeTools, sub: `${tools.length} total` },
    { label: "Total Calls", value: totalCalls, sub: "all time" },
    { label: "Schema Violations", value: schemaViolations, sub: "flagged for agent retry" },
    { label: "Success Rate", value: `${successRate}%`, sub: "of logged calls" },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.label}>
          <CardHeader className="pb-2">
            <CardTitle>{stat.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{stat.value}</div>
            <p className="text-xs text-slate-400">{stat.sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
