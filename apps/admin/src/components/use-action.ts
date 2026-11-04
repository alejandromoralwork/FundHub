"use client";

/**
 * FILE: apps/admin/src/components/use-action.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: Defines `useAction`, a custom React hook used by Console buttons. It runs a server action
 *   (a function that executes on the server, e.g. "approve this review"), shows a green or red pop-up
 *   message with the result, and then reloads the data shown on the page.
 * WHERE IT RUNS: in the browser. Hooks only work inside client components, hence "use client".
 * FRAMEWORK NOTES:
 *   - A "hook" is a React function whose name starts with `use`. It can only be called at the top of a
 *     component (or another hook) and lets the component keep state or use React features.
 *   - A "custom hook" (like this one) is just our own function that bundles several built-in hooks together.
 *   - Server actions are functions in files marked "use server". The browser calls them like normal async
 *     functions; Next.js sends the call over the network to the server behind the scenes.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - type alias `type Result = …` and union types `A | B` ("either A or B").
 *   - optional properties `ok?: string` (may be missing) and `void` (no value at all).
 *   - function types `() => Promise<Result>` = "a function with no arguments that returns a Promise of Result".
 *   - array destructuring `const [a, b] = …`, object destructuring `const { message } = …`.
 *   - async/await, try/catch, optional chaining `res?.error`, ternary `c ? x : y`, `instanceof`.
 */

// `import { a } from "b"` pulls the named thing `a` out of the module/library "b" so this file can use it.
// Plain names like "antd" or "react" are libraries installed from npm.
// `App` from Ant Design (antd): its `App.useApp()` hook gives access to the shared pop-up `message` API.
import { App } from "antd";
// `useRouter` from Next.js: lets browser code ask Next.js to re-fetch the current page's server data.
import { useRouter } from "next/navigation";
// `useTransition` from React: runs slow work in the background and tells us whether it is still running.
import { useTransition } from "react";

/**
 * Kind: type alias.
 * The shape a server action may return: an object with an optional success text (`ok`) and/or an optional
 * error text (`error`), OR `void` (nothing at all) for actions that do not report anything.
 */
type Result = { ok?: string; error?: string } | void;

/**
 * Kind: custom React hook (a function whose name starts with `use`).
 * Runs a server action, shows its result as a toast, and refreshes server data.
 * Parameters: none.
 * @returns an object `{ run, pending }`:
 *   - `run(fn)` — call this with a function that calls a server action, e.g. `run(() => approveReview(id))`.
 *   - `pending` — `true` while the action is still running, so buttons can show a loading spinner.
 * Why: every Console button that changes data needs the same "run, show message, refresh" steps;
 *   keeping them here avoids repeating that code in every component.
 */
export function useAction() {
  // `App.useApp()` returns an object; `{ message }` takes just its `message` property (object destructuring).
  // `message.success("…")` / `message.error("…")` show a small pop-up ("toast") at the top of the screen.
  const { message } = App.useApp();
  // The Next.js router for this page; used below to refresh.
  const router = useRouter();
  // `useTransition()` returns a pair: `pending` (a true/false flag) and `start` (a function that runs work
  // as a "transition"). Array destructuring `[pending, start]` names the two items.
  const [pending, start] = useTransition();
  // `run` is an arrow function that takes `fn` (any function returning a Promise of Result).
  const run = (fn: () => Promise<Result>) =>
    // Wrap the work in `start(...)`, so `pending` stays true until the async function below finishes.
    start(async () => {
      // `try { … } catch (err) { … }`: if anything inside `try` throws an error, jump to `catch` instead of crashing.
      try {
        // `await` pauses until the server action answers, then stores its answer in `res`.
        const res = await fn();
        // `res?.error` = "res.error, but only if res exists" (optional chaining; res may be void/undefined).
        // If the action reported an error, show it in red; otherwise, if it reported success, show it in green.
        if (res?.error) message.error(res.error);
        else if (res?.ok) message.success(res.ok);
        // Ask Next.js to re-run the server components of this page so tables show the updated data.
        router.refresh();
      } catch (err) {
        // A thrown error might not be an `Error` object. `err instanceof Error` checks that it is; if so we show
        // its message, otherwise a generic text. `c ? x : y` is the ternary operator: "if c then x else y".
        message.error(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  // `{ run, pending }` is shorthand for `{ run: run, pending: pending }`.
  return { run, pending };
}
