/**
 * Single-series horizontal bar list (one hue, magnitude). Values are printed as text,
 * so color is never the only carrier; each row has a native hover tooltip.
 */
export function BarList({
  rows,
  max,
  caption,
}: {
  rows: { label: string; value: number; display: string; hint?: string }[];
  max?: number;
  caption?: string;
}) {
  const top = max ?? Math.max(...rows.map((r) => r.value), 1);
  return (
    <figure>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={r.label}
            title={`${r.label}: ${r.hint ?? r.display}`}
            className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 rounded px-1 py-0.5 text-xs hover:bg-canvas sm:grid-cols-[minmax(0,14rem)_1fr_auto]"
          >
            <span className="truncate text-ink-600">{r.label}</span>
            <span className="h-2 rounded-full bg-slate-100">
              <span
                className="block h-2 rounded-full bg-emerald"
                style={{ width: `${Math.max(2, (r.value / top) * 100)}%` }}
              />
            </span>
            <span className="tnum w-16 text-right font-medium text-ink">{r.display}</span>
          </li>
        ))}
      </ul>
      {caption && <figcaption className="mt-3 text-[11px] text-slate-400">{caption}</figcaption>}
    </figure>
  );
}
