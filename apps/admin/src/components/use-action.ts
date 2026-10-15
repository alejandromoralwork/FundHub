"use client";

import { App } from "antd";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

type Result = { ok?: string; error?: string } | void;

/** Runs a server action, shows its result as a toast, and refreshes server data. */
export function useAction() {
  const { message } = App.useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      try {
        const res = await fn();
        if (res?.error) message.error(res.error);
        else if (res?.ok) message.success(res.ok);
        router.refresh();
      } catch (err) {
        message.error(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  return { run, pending };
}
