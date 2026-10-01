"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

/** Reads and writes comparator filters in the URL query string. */
export function useFilterParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const get = useCallback((key: string) => searchParams.get(key) ?? "", [searchParams]);

  const getList = useCallback(
    (key: string) => (searchParams.get(key) ?? "").split(",").filter(Boolean),
    [searchParams],
  );

  /** Set several params at once; empty string / empty array / undefined removes the key. */
  const update = useCallback(
    (changes: Record<string, string | string[] | number | undefined>) => {
      // Other pages' query params (e.g. /rfi?provider=) don't belong on the comparator.
      const next = new URLSearchParams(pathname === "/" ? searchParams.toString() : "");
      for (const [key, value] of Object.entries(changes)) {
        const str = Array.isArray(value) ? value.join(",") : value === undefined ? "" : String(value);
        if (str) next.set(key, str);
        else next.delete(key);
      }
      const qs = next.toString();
      const href = qs ? `/?${qs}` : "/";
      startTransition(() => {
        // Filters only apply on the comparator, so navigate there from other pages.
        if (pathname === "/") router.replace(href, { scroll: false });
        else router.push(href);
      });
    },
    [pathname, router, searchParams],
  );

  const toggleInList = useCallback(
    (key: string, value: string) => {
      const list = getList(key);
      update({ [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] });
    },
    [getList, update],
  );

  const reset = useCallback(() => {
    startTransition(() => router.replace("/", { scroll: false }));
  }, [router]);

  return { get, getList, update, toggleInList, reset, isPending, pathname };
}
