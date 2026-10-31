"use client";

import { monthShort } from "@/lib/format";

/**
 * Ink line chart per the direction: no gradients, straight segments, no fill,
 * 3-4 solid 1px gridlines, round y ticks at 12px, 2px line in ink with the
 * selected series in #1d5fbf when on the main data element. Hover dot with a
 * dashed guide. One chart answers one question.
 */

export interface SeriesPoint {
  label: string; // "2026-04" or short label
  value: number;
}

interface Props {
  series: SeriesPoint[];
  hue?: string; // the one chart hue for this data element
  height?: number;
  format: (v: number) => string;
  formatTick: (v: number) => string;
  ariaLabel: string;
}

export function LineChart({
  series,
  hue = "#141414",
  height = 220,
  format,
  formatTick,
  ariaLabel,
}: Props) {
  if (series.length < 2) {
    return (
      <p className="text-muted text-sm py-10 text-center">
        Two periods of data are needed to draw this.
      </p>
    );
  }

  const W = series.length >= 10 ? 1136 : 800;
  const padL = 56;
  const padR = 8;
  const padT = 10;
  const padB = 26;

  const values = series.map((p) => p.value);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || Math.max(1, Math.abs(max));
  const nice = Math.ceil(span / 4) * 4 || 1;
  const vmax = Math.ceil((max + span * 0.05) / nice) * nice;
  const vmin = Math.floor((min - span * 0.05) / nice) * nice;
  const vs = vmax - vmin || 1;

  const x = (i: number) => padL + (i * (W - padL - padR)) / (series.length - 1);
  const y = (v: number) => padT + ((vmax - v) / vs) * (height - padT - padB);

  const gridCount = 4;
  const gridVals = Array.from({ length: gridCount + 1 }, (_, i) => vmin + (vs * i) / gridCount);

  const path = series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");

  // hover state
  const [hover, setHover] = useHoverState();
  const hi = hover?.i;

  return (
    <div className="relative select-none" role="img" aria-label={ariaLabel} style={{ width: "100%" }}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        style={{ width: "100%", height, display: "block" }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.target as SVGElement).closest("svg")!.getBoundingClientRect();
          const rel = ((e.clientX - rect.left) / rect.width) * W;
          const i = Math.round(((rel - padL) / (W - padL - padR)) * (series.length - 1));
          setHover({ i: Math.max(0, Math.min(series.length - 1, i)) });
        }}
      >
        {/* gridlines + y ticks */}
        {gridVals.map((v, gi) => (
          <g key={gi}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#f0f0f0" strokeWidth={1} />
            <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize={12} fill="#9a9a9a" style={{ fontVariantNumeric: "tabular-nums" }}>
              {formatTick(v)}
            </text>
          </g>
        ))}
        {/* x labels: show every ceil(n/8) */}
        {series.map((p, i) =>
          i % Math.max(1, Math.ceil(series.length / 8)) === 0 || i === series.length - 1 ? (
            <text
              key={i}
              x={x(i)}
              y={height - 6}
              textAnchor={i === 0 ? "start" : i === series.length - 1 ? "end" : "middle"}
              fontSize={12}
              fill="#9a9a9a"
            >
              {p.label.includes("-") ? monthShort(p.label) : p.label}
            </text>
          ) : null,
        )}
        {/* the line — straight segments, no fill */}
        <path d={path} fill="none" stroke={hue} strokeWidth={2} strokeLinejoin="round" />
        {/* hover: dashed guide, pale-grey rest, dot */}
        {hi != null && (
          <g>
            <line
              x1={x(hi)}
              x2={x(hi)}
              y1={padT}
              y2={height - padB}
              stroke="#d4d4d4"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle cx={x(hi)} cy={y(series[hi]!.value)} r={4} fill="#fff" stroke={hue} strokeWidth={1.5} />
          </g>
        )}
      </svg>
      {hi != null && (
        <div
          className="absolute -translate-x-1/2 pointer-events-none card px-2.5 py-1.5 text-xs whitespace-nowrap shadow-sm"
          style={{ left: `calc(${(x(hi) / W) * 100}% )`, top: Math.max(0, y(series[hi]!.value) - 46) }}
        >
          <span className="text-muted">{series[hi]!.label.includes("-") ? monthShort(series[hi]!.label) : series[hi]!.label}</span>
          <span className="ml-2 money">{format(series[hi]!.value)}</span>
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
function useHoverState(): [{ i: number } | null, (v: { i: number } | null) => void] {
  const [hover, setHover] = useState<{ i: number } | null>(null);
  return [hover, setHover];
}
