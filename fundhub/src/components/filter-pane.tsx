"use client";

import { useEffect, useRef, useState } from "react";
import { PROVIDER_TYPES, REGULATORY_SCOPES } from "@/db/schema";
import { DENSITY_CEILING, PRICE_CEILING, PRICE_FLOOR } from "@/lib/filters";
import { formatNumber } from "@/lib/format";
import { useFilterParams } from "./use-filter-params";

function useDebounced(fn: (v: Record<string, number | undefined>) => void, ms = 350) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (v: Record<string, number | undefined>) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fn(v), ms);
  };
}

const Heading = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</p>
);

export function FilterPane({ typeCounts }: { typeCounts: Record<string, number> }) {
  const { get, getList, update, toggleInList, reset } = useFilterParams();

  const urlMin = Number(get("min")) || PRICE_FLOOR;
  const urlMax = Number(get("max")) || PRICE_CEILING;
  const urlDensity = Number(get("density")) || 0;

  // Local slider state so dragging is smooth; URL is updated debounced.
  const [min, setMin] = useState(urlMin);
  const [max, setMax] = useState(urlMax);
  const [density, setDensity] = useState(urlDensity);
  useEffect(() => setMin(urlMin), [urlMin]);
  useEffect(() => setMax(urlMax), [urlMax]);
  useEffect(() => setDensity(urlDensity), [urlDensity]);

  const commitDensity = useDebounced(update);
  const commitPriceBounds = useDebounced(update);
  const commitPrice = (lo: number, hi: number) =>
    commitPriceBounds({
      min: lo > PRICE_FLOOR ? lo : undefined,
      max: hi < PRICE_CEILING ? hi : undefined,
    });

  const types = getList("type");
  const regs = getList("reg");
  const [lo, hi] = min <= max ? [min, max] : [max, min];

  return (
    <div className="space-y-6 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Strict Parameters</h2>
        <button type="button" onClick={reset} className="text-xs font-medium text-emerald-700 hover:underline">
          Reset all
        </button>
      </div>

      <div className="space-y-3">
        <Heading>Price Bounds (€/qtr)</Heading>
        <div className="flex items-center justify-between text-xs tnum text-ink-600">
          <span>Min €{formatNumber(lo)}</span>
          <span>
            Max €{formatNumber(hi)}
            {hi >= PRICE_CEILING && "+"}
          </span>
        </div>
        <input
          type="range"
          className="range w-full"
          aria-label="Minimum quarterly fee"
          min={PRICE_FLOOR}
          max={PRICE_CEILING}
          step={100}
          value={min}
          onChange={(e) => {
            const v = Number(e.target.value);
            setMin(v);
            commitPrice(Math.min(v, max), Math.max(v, max));
          }}
        />
        <input
          type="range"
          className="range w-full"
          aria-label="Maximum quarterly fee"
          min={PRICE_FLOOR}
          max={PRICE_CEILING}
          step={100}
          value={max}
          onChange={(e) => {
            const v = Number(e.target.value);
            setMax(v);
            commitPrice(Math.min(min, v), Math.max(min, v));
          }}
        />
      </div>

      <hr className="border-slate-100" />

      <fieldset className="space-y-2.5">
        <legend className="mb-2.5">
          <Heading>Provider Type</Heading>
        </legend>
        {PROVIDER_TYPES.map((t) => (
          <label key={t} className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-600">
            <input
              type="checkbox"
              className="check h-4 w-4"
              checked={types.includes(t)}
              onChange={() => toggleInList("type", t)}
            />
            {t}
            <span className="ml-auto text-xs tnum text-slate-400">{typeCounts[t] ?? 0}</span>
          </label>
        ))}
      </fieldset>

      <hr className="border-slate-100" />

      <div className="space-y-3">
        <Heading>Client Portfolio Density</Heading>
        <div className="flex items-center justify-between text-xs tnum text-ink-600">
          <span>Min. active mandates</span>
          <span className="font-medium text-ink">{density ? `${density}+` : "Any"}</span>
        </div>
        <input
          type="range"
          className="range w-full"
          aria-label="Minimum active client mandates"
          min={0}
          max={DENSITY_CEILING}
          step={5}
          value={density}
          onChange={(e) => {
            const v = Number(e.target.value);
            setDensity(v);
            commitDensity({ density: v || undefined });
          }}
        />
      </div>

      <hr className="border-slate-100" />

      <fieldset className="space-y-2.5">
        <legend className="mb-2.5">
          <Heading>Regulatory Scope</Heading>
        </legend>
        {REGULATORY_SCOPES.map((r) => (
          <label key={r} className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-600">
            <input
              type="checkbox"
              className="check h-4 w-4"
              checked={regs.includes(r)}
              onChange={() => toggleInList("reg", r)}
            />
            {r}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
