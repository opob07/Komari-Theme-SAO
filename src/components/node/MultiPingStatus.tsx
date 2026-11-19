import { memo, useMemo, useState } from "react";
import { clsx } from "clsx";
import { useMetricColorsVersion } from "@/hooks/useMetricColors";
import { usePreferences } from "@/hooks/usePreferences";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import type { HomepagePingDisplayLine } from "@/types/komari";
import { resolveCustomLatencyColor, resolveCustomLossColor } from "@/utils/metricTone";
import { isFallbackTaskName } from "@/utils/pingTasks";
import { HealthBucketTooltip } from "./HealthBucketTooltip";
import { LatencyBars } from "./LatencyBars";
import { QualityBars } from "./QualityBars";
import { formatHealthBucketTooltip } from "./pingBucketText";

type MultiPingStatusDensity = "large" | "compact";
type MultiPingMetric = "latency" | "loss";

interface GroupedPingLine {
  groupKey: string;
  baseName: string;
  isFallback: boolean;
  v4?: HomepagePingDisplayLine;
  v6?: HomepagePingDisplayLine;
}

function groupPingLinesByBaseName(lines: HomepagePingDisplayLine[]): GroupedPingLine[] {
  const groups = new Map<string, GroupedPingLine>();

  for (const line of lines) {
    // 统一将全角字符转为半角并去除首尾空格
    const normalized = line.taskName
      .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .trim();
    const isFallback = isFallbackTaskName(normalized);

    // 匹配名称中任意位置的 IPv4 / V4 / IPv6 / V6（忽略大小写及前后分隔符）
    const v6Regex = /[\s\-_()[\]【】]*(?:ipv?6)[\s\-_()[\]【】]*/i;
    const v4Regex = /[\s\-_()[\]【】]*(?:ipv?4)[\s\-_()[\]【】]*/i;

    let protocol: "v4" | "v6" = "v4";
    let baseName = normalized;

    if (!isFallback) {
      if (v6Regex.test(normalized)) {
        protocol = "v6";
        baseName = normalized.replace(v6Regex, " ").trim();
      } else if (v4Regex.test(normalized)) {
        protocol = "v4";
        baseName = normalized.replace(v4Regex, " ").trim();
      }
    }

    if (!baseName) {
      baseName = normalized;
    }

    const groupKey = isFallback ? `fallback-${line.taskId}` : baseName;

    let group = groups.get(groupKey);
    if (!group) {
      group = { groupKey, baseName, isFallback };
      groups.set(groupKey, group);
    }

    if (group[protocol]) {
      groups.set(`${groupKey}-${line.taskId}`, {
        groupKey: `${groupKey}-${line.taskId}`,
        baseName: normalized,
        isFallback,
        [protocol]: line,
      });
    } else {
      group[protocol] = line;
    }
  }

  return Array.from(groups.values());
}

function MetricValueReadout({
  line,
  metric,
  protocolLabel,
}: {
  line: HomepagePingDisplayLine;
  metric: MultiPingMetric;
  protocolLabel: "V4" | "V6";
}) {
  const themeSettings = useThemeSettings();
  const latencyColor = resolveCustomLatencyColor(
    line.lastValue,
    themeSettings.pingLatencyThresholds,
    themeSettings.pingLatencyColors,
  );
  const lossColor = resolveCustomLossColor(
    line.loss,
    themeSettings.pingLossThresholds,
    themeSettings.pingLossColors,
  );

  const isLoading = line.loadState === "pending";
  const isError = line.loadState === "error";
  const value = metric === "latency" ? line.lastValue : line.loss;
  const valueColor = metric === "latency" ? latencyColor : lossColor;
  const unit = metric === "latency" ? "ms" : "%";
  const waiting = isLoading && value == null;

  const displayValue = waiting
    ? "..."
    : isError && value == null
      ? "!"
      : value == null
        ? "-"
        : metric === "latency"
          ? Math.round(value)
          : value.toFixed(1);

  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: "1px", whiteSpace: "nowrap" }}>
      <span style={{ fontSize: "10px", color: "var(--text-secondary)", fontWeight: 500 }}>
        {protocolLabel}
      </span>
      <strong
        className="multi-ping-value tabular"
        style={{
          color: value == null ? "var(--text-tertiary)" : valueColor,
          fontSize: "11px",
        }}
      >
        {displayValue}
        {value != null && <small style={{ fontSize: "9px" }}>{unit}</small>}
      </strong>
    </span>
  );
}

function ProtocolBucketBar({
  line,
  metric,
  chartHeight,
  redrawKey,
}: {
  line: HomepagePingDisplayLine;
  metric: MultiPingMetric;
  chartHeight: number;
  redrawKey: string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const hoveredBucket =
    hoveredIndex == null ? null : (line.buckets[hoveredIndex] ?? null);
  const tooltip = hoveredBucket
    ? formatHealthBucketTooltip(hoveredBucket, metric)
    : null;

  return (
    <span
      className="multi-ping-buckets"
      title=""
      style={{ flex: 1, minWidth: 0, position: "relative" }}
    >
      {metric === "latency" ? (
        <LatencyBars
          buckets={line.buckets}
          redrawKey={redrawKey}
          height={chartHeight}
          onHoverIndex={setHoveredIndex}
        />
      ) : (
        <QualityBars
          buckets={line.buckets}
          redrawKey={redrawKey}
          height={chartHeight}
          onHoverIndex={setHoveredIndex}
        />
      )}
      <HealthBucketTooltip
        text={tooltip}
        index={hoveredIndex}
        count={line.buckets.length}
      />
    </span>
  );
}

const MultiPingGroupedRow = memo(function MultiPingGroupedRow({
  group,
  metric,
  density,
  redrawKey,
}: {
  group: GroupedPingLine;
  metric: MultiPingMetric;
  density: MultiPingStatusDensity;
  redrawKey: string;
}) {
  const { v4, v6, baseName, isFallback } = group;
  const hasBoth = Boolean(v4 && v6);
  const primaryLine = v4 ?? v6!;
  const isLoadingAny =
    (v4?.loadState === "pending" && v4.lastValue == null) ||
    (v6?.loadState === "pending" && v6.lastValue == null);
  const showNameSkeleton = isLoadingAny && isFallback;
  const displayName = showNameSkeleton ? "加载中" : baseName;
  const chartHeight = density === "compact" ? 9 : 11;

  const v4Text = v4
    ? `V4 ${v4.lastValue == null ? "-" : Math.round(v4.lastValue) + "ms"}`
    : "";
  const v6Text = v6
    ? `V6 ${v6.lastValue == null ? "-" : Math.round(v6.lastValue) + "ms"}`
    : "";
  const rowTitle = [displayName, v4Text, v6Text].filter(Boolean).join(" / ");

  return (
    <div
      className="multi-ping-metric-row"
      data-load-state={primaryLine.loadState ?? "ready"}
      title={rowTitle}
    >
      <div
        className="multi-ping-metric-head"
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "4px",
          whiteSpace: "nowrap",
        }}
      >
        <span
          className="multi-ping-name"
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            gap: "3px",
            minWidth: 0,
          }}
        >
          {showNameSkeleton ? (
            <span className="multi-ping-name-skeleton" aria-label="加载中" />
          ) : (
            <>
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: "11px",
                }}
              >
                {baseName}
              </span>
              <span
                style={{
                  fontSize: "10px",
                  color: "var(--text-tertiary)",
                  fontWeight: 400,
                  flexShrink: 0,
                }}
              >
                {metric === "latency" ? "延时" : "丢包"}
              </span>
            </>
          )}
        </span>

        <span
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            gap: "3px",
            flexShrink: 0,
          }}
        >
          {v4 && <MetricValueReadout line={v4} metric={metric} protocolLabel="V4" />}
          {hasBoth && (
            <span style={{ color: "var(--text-tertiary)", fontSize: "10px" }}>/</span>
          )}
          {v6 && <MetricValueReadout line={v6} metric={metric} protocolLabel="V6" />}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "5px", width: "100%" }}>
        {v4 && (
          <ProtocolBucketBar
            line={v4}
            metric={metric}
            chartHeight={chartHeight}
            redrawKey={redrawKey}
          />
        )}
        {v6 && (
          <ProtocolBucketBar
            line={v6}
            metric={metric}
            chartHeight={chartHeight}
            redrawKey={redrawKey}
          />
        )}
      </div>
    </div>
  );
});

const MultiPingMetricColumn = memo(function MultiPingMetricColumn({
  groups,
  metric,
  density,
  redrawKey,
}: {
  groups: GroupedPingLine[];
  metric: MultiPingMetric;
  density: MultiPingStatusDensity;
  redrawKey: string;
}) {
  return (
    <div
      className="multi-ping-metric-column"
      aria-label={metric === "latency" ? "延迟" : "丢包"}
    >
      {groups.map((group) => (
        <MultiPingGroupedRow
          key={group.groupKey}
          group={group}
          metric={metric}
          density={density}
          redrawKey={redrawKey}
        />
      ))}
    </div>
  );
});

export const MultiPingStatus = memo(function MultiPingStatus({
  lines,
  density,
  className,
}: {
  lines: HomepagePingDisplayLine[];
  density: MultiPingStatusDensity;
  className?: string;
}) {
  const { resolvedAppearance } = usePreferences();
  const colorsVersion = useMetricColorsVersion();
  const redrawKey = `${resolvedAppearance}:${colorsVersion}`;

  const groupedLines = useMemo(() => groupPingLinesByBaseName(lines), [lines]);

  return (
    <div
      className={clsx("multi-ping-status", `is-${density}`, className)}
      role="group"
      aria-label="三网延迟与丢包"
    >
      <div className="multi-ping-columns">
        <MultiPingMetricColumn
          groups={groupedLines}
          metric="latency"
          density={density}
          redrawKey={redrawKey}
        />
        <MultiPingMetricColumn
          groups={groupedLines}
          metric="loss"
          density={density}
          redrawKey={redrawKey}
        />
      </div>
    </div>
  );
});
