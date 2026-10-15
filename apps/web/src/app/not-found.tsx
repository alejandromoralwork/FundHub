import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center p-10 text-center">
      <p className="font-mono text-sm text-emerald-700">404</p>
      <h1 className="mt-2 text-xl font-semibold text-ink">Page not found</h1>
      <p className="mt-1 text-sm text-ink-600">This provider or page isn&apos;t in the index.</p>
      <Link href="/compare" className="mt-5 rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800">
        Back to comparator
      </Link>
    </main>
  );
}
