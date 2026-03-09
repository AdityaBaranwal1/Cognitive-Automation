import { CartesianGrid, Line, LineChart, XAxis } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { RefreshCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UsageSummary } from "@/lib/storage/api-usage.storage";

const formatNumber = (num: number): string => {
  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(1).replace(/\.0$/, "") + "B";
  }
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  }
  return num.toString();
};

export function Usage({
  loading,
  onRefresh,
  onClear,
  summary,
}: {
  loading: boolean;
  onRefresh: () => void;
  onClear: () => void;
  summary: UsageSummary;
}) {
  const chartConfig = {
    views: {
      label: "Requests",
    },
    requests: {
      label: "Requests",
      color: "var(--chart-1)",
    },
  } satisfies ChartConfig;

  const providerEntries = Object.entries(summary.byProvider).sort(
    ([, a], [, b]) => b.requests - a.requests
  );
  const modelEntries = Object.entries(summary.byModel).sort(
    ([, a], [, b]) => b.requests - a.requests
  );

  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <Card className="py-4 sm:py-0 mt-2 shadow-none border border-border/70 rounded-xl">
        <CardHeader className="flex flex-row items-stretch border-b !p-0 ">
          <div className="flex flex-row justify-between items-center">
            <div className="flex flex-1 flex-col justify-center gap-1 px-6 pb-0">
              <CardTitle className="text-md lg:text-lg">API Usage</CardTitle>
              <CardDescription className="text-xs lg:text-sm">
                Local usage tracking (last 30 days)
              </CardDescription>
            </div>

            <div className="flex gap-1">
              <Button
                disabled={loading}
                variant="ghost"
                size="icon"
                onClick={onRefresh}
                title="Refresh"
              >
                <RefreshCcw
                  className={`size-4 ${loading ? "animate-spin" : ""}`}
                />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClear}
                title="Clear usage data"
              >
                <Trash2 className="size-4 text-muted-foreground" />
              </Button>
            </div>
          </div>
          <div className="flex flex-1">
            {[
              {
                label: "Total Requests",
                value: summary.totalRequests,
              },
              {
                label: "Total Tokens",
                value: summary.totalTokens,
              },
            ].map((key, index) => {
              return (
                <button
                  key={index}
                  className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left even:border-l sm:border-t-0 sm:border-l sm:px-8 sm:py-6"
                >
                  <span className="text-muted-foreground text-[10px] lg:text-xs">
                    {key.label}
                  </span>
                  <span className="text-lg lg:text-3xl leading-none font-bold">
                    {formatNumber(key.value)}
                  </span>
                </button>
              );
            })}
          </div>
        </CardHeader>
        <CardContent className="px-2 sm:p-6">
          <ChartContainer
            config={chartConfig}
            className="aspect-auto h-[250px] w-full"
          >
            <LineChart
              accessibilityLayer
              data={summary.dailyData}
              margin={{
                left: 12,
                right: 12,
              }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={(value) => {
                  const date = new Date(value);
                  return date.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  });
                }}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    className="w-[150px]"
                    nameKey="views"
                    labelFormatter={(value) => {
                      return new Date(value).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      });
                    }}
                  />
                }
              />
              <Line
                dataKey="requests"
                type="monotone"
                stroke={`var(--color-requests)`}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Provider Breakdown */}
      {providerEntries.length > 0 && (
        <Card className="shadow-none border border-border/70 rounded-xl">
          <CardHeader className="!p-4 !pb-2">
            <CardTitle className="text-sm">By Provider</CardTitle>
          </CardHeader>
          <CardContent className="!p-4 !pt-0">
            <div className="space-y-2">
              {providerEntries.map(([provider, data]) => (
                <div
                  key={provider}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="font-medium truncate max-w-[200px]">
                    {provider}
                  </span>
                  <div className="flex gap-4 text-muted-foreground text-xs">
                    <span>{data.requests} requests</span>
                    <span>{formatNumber(data.tokens)} tokens</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Model Breakdown */}
      {modelEntries.length > 0 && (
        <Card className="shadow-none border border-border/70 rounded-xl">
          <CardHeader className="!p-4 !pb-2">
            <CardTitle className="text-sm">By Model</CardTitle>
          </CardHeader>
          <CardContent className="!p-4 !pt-0">
            <div className="space-y-2">
              {modelEntries.map(([model, data]) => (
                <div
                  key={model}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="font-medium truncate max-w-[200px]">
                    {model}
                  </span>
                  <div className="flex gap-4 text-muted-foreground text-xs">
                    <span>{data.requests} requests</span>
                    <span>{formatNumber(data.tokens)} tokens</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {summary.totalRequests === 0 && (
        <Card className="shadow-none border border-border/70 rounded-xl">
          <CardContent className="!p-8 text-center">
            <p className="text-muted-foreground text-sm">
              No API usage data yet. Run a workflow or send a message to start
              tracking usage.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
