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

/**
 * 将同前缀的 V4 / V6 监控线路归并为一组
 */
function groupPingLinesByBaseName(lines: HomepagePingDisplayLine[]): GroupedPingLine[] {
  const groups = new Map<string, GroupedPingLine>();

  for (const line of lines) {
    const rawName = line.taskName.trim();
    const isFallback = isFallbackTaskName(rawName);
    const match = !isFallback
      ? rawName.match(/^(.*?)[\s\-_]*(ipv?4|ipv?6)$/i)
      : null;

    const baseName = match && match[1].trim() ? match[1].trim() : rawName;
    const protocol: "v4" | "v6" = match
      ? match[2].toLowerCase().includes("6")
        ? "v6"
        : "v4"
      : "v4";

    const groupKey = isFallback ? `fallback-${line.taskId}` : baseName;

    let group = groups.get(groupKey);
    if (!group) {
      group = {
        groupKey,
        baseName,
        isFallback,
      };
      groups.set(groupKey, group);
    }

    if (group[protocol]) {
      groups.set(`${groupKey}-${line.taskId}`, {
        groupKey: `${groupKey}-${line.taskId}`,
        baseName: rawName,
        isFallback,
        [protocol]: line,
      });
    } else {
      group[protocol] = line;
    }
  }

  return Array.from(groups.values());
}

/**
 * 单个协议栈的数值片段（如 V4 38ms）
 */
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
        ? "—"
        : metric === "latency"
          ? Math.round(value)
          : value.toFixed(1);

  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: "2px" }}>
      <span style={{ fontSize: "0.85em", color: "var(--text-secondary)", fontWeight: 500 }}>
        {protocolLabel}
      </span>
      <strong
        className="multi-ping-value tabular"
        style={{
          color: value == null ? "var(--text-tertiary)" : valueColor,
        }}
      >
        {displayValue}
        {value != null && <small>{unit}</small>}
      </strong>
    </span>
  );
}

/**
 * 单个协议栈的历史格子条（带独立 Hover Tooltip）
 */
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

  const buildSummary = (label: string, item?: HomepagePingDisplayLine) => {
    if (!item) return "";
    const lat = item.lastValue == null ? "无样本" : `${Math.round(item.lastValue)}ms`;
    const loss = item.loss == null ? "—" : `${item.loss.toFixed(1)}%`;
    return `${label}: 延迟 ${lat} / 丢包 ${loss}`;
  };
  const rowTitle = [
    displayName,
    buildSummary("V4", v4),
    buildSummary("V6", v6),
  ]
    .filter(Boolean)
    .join(" · ");

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
          gap: "6px",
        }}
      >
        <span
          className="multi-ping-name"
          style={{ display: "inline-flex", alignItems: "baseline", gap: "4px", minWidth: 0 }}
        >
          {showNameSkeleton ? (
            <span className="multi-ping-name-skeleton" aria-label="加载中" />
          ) : (
            <>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {baseName}
              </span>
              <span
                style={{
                  fontSize: "0.85em",
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
            gap: "4px",
            flexShrink: 0,
          }}
        >
          {v4 && (
            <MetricValueReadout line={v4} metric={metric} protocolLabel="V4" />
          )}
          {hasBoth && (
            <span style={{ color: "var(--text-tertiary)", fontSize: "0.85em" }}>/</span>
          )}
          {v6 && (
            <MetricValueReadout line={v6} metric={metric} protocolLabel="V6" />
          )}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          width: "100%",
        }}
      >
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
      className={clsx("multi-ping
