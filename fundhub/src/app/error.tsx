"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center p-10 text-center">
      <h1 className="text-xl font-semibold text-ink">Something went wrong</h1>
      <p className="mt-1 max-w-md text-sm text-ink-600">
        We couldn&apos;t load this page. If this keeps happening, the database may be unreachable.
      </p>
      {error.digest && <p className="mt-2 font-mono text-xs text-slate-400">Ref: {error.digest}</p>}
      <button
        type="button"
        onClick={reset}
        className="mt-5 rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800"
      >
        Try again
      </button>
    </main>
  );
}
