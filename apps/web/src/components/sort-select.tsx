"use client";

import { SORTS } from "@fundhub/core/filters";
import { Select } from "./filter-bar";
import { useFilterParams } from "./use-filter-params";

export function SortSelect() {
  const { get, update } = useFilterParams();
  return (
    <Select
      label="Sort providers"
      value={get("sort") || "score"}
      onChange={(sort) => update({ sort: sort === "score" ? undefined : sort })}
      options={Object.entries(SORTS).map(([value, label]) => ({ value, label: `Sort: ${label}` }))}
    />
  );
}
