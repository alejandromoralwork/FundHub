"use client";

import { useEffect, useRef, useState } from "react";
import { ASSET_CLASSES, LICENCES, PROVIDER_TYPES, REGULATORY_SCOPES, TECH_STACKS } from "@fundhub/db/schema";
import { DENSITY_CEILING, PRICE_CEILING, PRICE_FLOOR } from "@fundhub/core/filters";
import { formatNumber } from "@fundhub/core/format";
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

function CheckGroup({
  title,
  options,
  selected,
  onToggle,
  counts,
}: {
  title: string;
  options: readonly string[];
  selected: string[];
  onToggle: (v: string) => void;
  counts?: Record<string, number>;
}) {
  return (
    <fieldset className="space-y-2.5">
      <legend className="mb-2.5">
        <Heading>{title}</Heading>
      </legend>
      {options.map((o) => (
        <label key={o} className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-600">
          <input type="checkbox" className="check h-4 w-4" checked={selected.includes(o)} onChange={() => onToggle(o)} />
          {o}
          {counts && <span className="ml-auto text-xs tnum text-slate-400">{counts[o] ?? 0}</span>}
        </label>
      ))}
    </fieldset>
  );
}

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

      <CheckGroup
        title="Provider Type"
        options={PROVIDER_TYPES}
        selected={getList("type")}
        onToggle={(v) => toggleInList("type", v)}
        counts={typeCounts}
      />

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

      <CheckGroup
        title="Asset Classes"
        options={ASSET_CLASSES}
        selected={getList("asset")}
        onToggle={(v) => toggleInList("asset", v)}
      />

      <hr className="border-slate-100" />

      <CheckGroup
        title="Licences & Authorisations"
        options={LICENCES}
        selected={getList("licence")}
        onToggle={(v) => toggleInList("licence", v)}
      />

      <hr className="border-slate-100" />

      <CheckGroup
        title="Regulatory Scope"
        options={REGULATORY_SCOPES}
        selected={getList("reg")}
        onToggle={(v) => toggleInList("reg", v)}
      />

      <hr className="border-slate-100" />

      <CheckGroup
        title="Tech Stack"
        options={TECH_STACKS}
        selected={getList("stack")}
        onToggle={(v) => toggleInList("stack", v)}
      />
    </div>
  );
}
