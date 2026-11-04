"use client";

/**
 * FILE: apps/web/src/components/advisor-widget.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The floating "FundHub AI Advisor" chat bubble in the bottom-right corner of the website.
 *   A round button opens a small chat panel. The visitor types a question, the panel sends it to our own
 *   server at /api/advisor, and shows the answer (a title, text, bullet points, matching providers and a
 *   link into the comparator). It starts with a pre-written example exchange so the panel is never empty.
 * WHERE IT RUNS: in the browser. It needs to react to clicks and typing and remember what was typed, which
 *   only browser code can do. The `"use client"` line above tells Next.js to send this file to the browser.
 * FRAMEWORK NOTES: In Next.js, components are "server components" by default: they run once on the server
 *   and only their finished HTML is sent. Adding `"use client"` as the very first line makes this a
 *   "client component": its JavaScript is also shipped to the browser so it can be interactive.
 *   A React component is a function that returns JSX (HTML-like markup written inside TypeScript).
 *   `className="..."` sets CSS classes; this project uses Tailwind, where each class is one small style rule
 *   (e.g. `p-4` = padding, `text-xs` = extra-small text, `rounded-lg` = rounded corners).
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - type aliases (`type Message = ...`) give a name to a shape of data.
 *   - union types (`A | B | C`): a value that is exactly one of several shapes.
 *   - generics (`useState<Message[]>`, `useRef<HTMLDivElement>`): tell a function which type it holds.
 *   - `async`/`await`, `try/catch/finally`: waiting for the network and handling failures.
 *   - type assertion `as AdvisorReply`: "trust me, this data has that shape".
 *   - arrow functions `(x) => ...`, optional chaining `a?.b`, spread `[...arr]`.
 */

// `import { a } from "b"` pulls the named thing `a` out of module `b` so this file can use it.
// Plain names ("next/link", "react", "lucide-react") are libraries installed from npm;
// `@fundhub/...` is one of our own shared packages in packages/; `@/...` is this app's src folder.

// `Link` is Next.js's version of an <a> link: it switches pages without a full page reload.
import Link from "next/link";
// React "hooks" (functions starting with `use`) that give a component memory and side effects:
// useState = a remembered value, useEffect = run code after the screen updates, useRef = a handle to an element.
import { useEffect, useRef, useState } from "react";
// Small SVG icons, each one a ready-made React component (e.g. <Send /> draws a paper-plane icon).
import { BadgeCheck, Loader2, Send, ShieldCheck, Sparkles, X } from "lucide-react";
// Shared helper that turns a min and max price into readable text such as "€20k–€40k".
import { formatPriceRange } from "@fundhub/core/format";
// `import type` imports only a TypeScript type (removed when the code is compiled). AdvisorReply describes
// the shape of one answer from the advisor: title, body, points, providers, filterHref.
import type { AdvisorReply } from "@/lib/advisor";

/**
 * Kind: type alias (a union type).
 * One chat message. The `|` means "one of these three shapes":
 *   - `{ role: "user"; text: string }`: what the visitor typed.
 *   - `{ role: "assistant"; reply: AdvisorReply }`: a structured answer from the advisor.
 *   - `{ role: "error"; text: string }`: a failure notice shown in red.
 * `role: "user"` is a literal type: the field may only hold that exact text. Because each shape has a
 * different `role`, TypeScript can tell which shape it is by checking `m.role` (a "discriminated union").
 */
type Message = { role: "user"; text: string } | { role: "assistant"; reply: AdvisorReply } | { role: "error"; text: string };

/**
 * Kind: constant (an array of Message).
 * `Message[]` means "an array whose items are all Message". This is a demo question and answer shown when
 * the panel first opens, so visitors see the kind of thing they can ask.
 */
// Opening exchange shown before the user asks anything.
const INTRO: Message[] = [
  {
    role: "user",
    text: "We're launching a RAIF and need a depositary + central admin. What should our RFI scope cover?",
  },
  {
    role: "assistant",
    reply: {
      title: "Suggested RFI scope",
      body: "For a Luxembourg RAIF you'll want the depositary and central administration bundled under a single SLA. Key comparison points:",
      points: [
        "AIFMD Art. 21 depositary duties & oversight model",
        "NAV frequency and cut-off (T+1 vs T+3)",
        "eFront / Investran connectivity for LP reporting",
      ],
      // No provider list in the demo answer: an empty array `[]` means "none".
      providers: [],
      // Link into the comparator, pre-filtered to the RAIF regime (the `?reg=RAIF` part is a URL query).
      filterHref: "/compare?reg=RAIF",
    },
  },
];

/**
 * Kind: React component (private to this file, because it is not exported).
 * Draws one advisor answer as a white speech bubble.
 * Props (the inputs a component receives, like HTML attributes):
 *   `{ reply }: { reply: AdvisorReply }` = the component receives an object with one field `reply`;
 *   the left part `{ reply }` is destructuring, which pulls that field out into its own variable.
 * Returns: JSX, the markup to show.
 */
function AssistantBubble({ reply }: { reply: AdvisorReply }) {
  return (
    // Tailwind: `max-w-[90%]` = at most 90% wide (square brackets = a custom value); `rounded-bl-sm` = a
    // less rounded bottom-left corner so it looks like a speech bubble; `px-3 py-2` = side/top padding.
    <div className="max-w-[90%] rounded-lg rounded-bl-sm border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-ink-600">
      {/* Heading row: a shield icon and the answer title. Curly braces `{...}` insert a TypeScript value. */}
      <p className="mb-1.5 flex items-center gap-1 font-semibold text-ink">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald" /> {reply.title}
      </p>
      <p>{reply.body}</p>
      {/* `condition && (<ul>...)` shows the list only when the condition is true (there is at least one point). */}
      {reply.points.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
          {/* `.map` turns each point text into an <li> element and returns the new array of elements.
              React needs a unique `key` on each item in a list so it can track them between updates;
              here the point text itself is used as the key. */}
          {reply.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {/* Matching providers, if the advisor suggested any. */}
      {reply.providers.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Matching providers</p>
          {/* One link per provider. The template string `/providers/${p.slug}` builds the URL by inserting
              the provider's slug (its URL name). `justify-between` pushes name left and price right. */}
          {reply.providers.map((p) => (
            <Link key={p.slug} href={`/providers/${p.slug}`} className="flex items-center justify-between gap-2 hover:text-ink">
              <span className="flex min-w-0 items-center gap-1 truncate font-medium text-ink">
                {/* A green tick only for providers FundHub has verified. `shrink-0` stops the icon squashing. */}
                {p.verified && <BadgeCheck className="h-3 w-3 shrink-0 text-emerald" />}
                {/* `truncate` cuts long names off with "…" instead of wrapping onto a new line. */}
                <span className="truncate">{p.name}</span>
              </span>
              {/* `tnum` is a project class for evenly spaced numbers, so prices line up. */}
              <span className="shrink-0 tnum text-slate-500">{formatPriceRange(p.priceMin, p.priceMax)}</span>
            </Link>
          ))}
        </div>
      )}
      {/* Optional link that opens the comparator with the filters the advisor suggested. */}
      {reply.filterHref && (
        <Link href={reply.filterHref} className="mt-2 inline-block font-medium text-emerald-700 hover:underline">
          Open in comparator →
        </Link>
      )}
    </div>
  );
}

/**
 * Kind: React component (exported, so other files can place <AdvisorWidget /> on the page).
 * Props: none.
 * Returns: JSX. Either the round "open" button, or the open chat panel.
 * Why: gives visitors quick, independent guidance and points them to the comparator.
 */
export function AdvisorWidget() {
  // `useState(initial)` returns a pair: the current value and a function to change it. Calling the change
  // function makes React redraw the component with the new value. `const [a, setA] = ...` is array
  // destructuring: it names the two items of the pair. `const` means the name cannot be re-assigned.
  // Is the chat panel open? Starts closed (`false`).
  const [open, setOpen] = useState(false);
  // All messages in the conversation. `<Message[]>` tells TypeScript the type; starts with the demo exchange.
  const [messages, setMessages] = useState<Message[]>(INTRO);
  // The text currently typed in the input box.
  const [input, setInput] = useState("");
  // True while we wait for the server's answer (shows "Thinking…" and blocks double sending).
  const [loading, setLoading] = useState(false);
  // `useRef` creates a box whose `.current` will point at the real scrollable <div> once it is on screen.
  // `null` is the starting value (no element yet).
  const scrollRef = useRef<HTMLDivElement>(null);

  // `useEffect(fn, [deps])` runs `fn` after React has updated the screen, and again whenever one of the
  // listed values changes. Here: whenever a message is added or the panel opens, scroll to the bottom so
  // the newest message is visible. `?.` (optional chaining) skips the call if the element is not there yet.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  // Opens only on request: an auto-opened panel covers forms on large screens.
  // `close` is an arrow function (`() => ...`): a short way to write a function. It closes the panel.
  const close = () => setOpen(false);

  /**
   * Kind: async function (event handler for the form's submit).
   * @param e  type `React.FormEvent`: the browser event React passes when the form is submitted.
   * @returns  `Promise<void>`: nothing useful, it just finishes later because it waits for the network.
   * Sends the typed question to /api/advisor and appends the answer (or an error) to the conversation.
   */
  async function ask(e: React.FormEvent) {
    // Stop the browser's default form behaviour (reloading the page); we handle sending ourselves.
    e.preventDefault();
    // `.trim()` removes spaces at both ends, so a message of only spaces counts as empty.
    const text = input.trim();
    // `!text` is true for an empty string. Do nothing if empty or if an answer is still loading.
    if (!text || loading) return;
    // Clear the input box straight away.
    setInput("");
    // Add the visitor's message. Passing a function `(m) => ...` gets the latest list `m`; `[...m, x]`
    // (spread) makes a new array with all old items plus `x`. React needs a new array to notice the change.
    setMessages((m) => [...m, { role: "user", text }]);
    setLoading(true);
    // `try { } catch { } finally { }`: run the code in try; if anything throws an error, jump to catch;
    // the finally block runs in both cases.
    try {
      // `fetch` sends an HTTP request. `await` pauses this function until the server responds.
      // It is a POST with a JSON body like {"message": "..."}; `JSON.stringify` turns the object into text.
      const res = await fetch("/api/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      // `res.ok` is false for error status codes (e.g. 500). `throw` raises an error and jumps to catch.
      if (!res.ok) throw new Error(String(res.status));
      // Read the JSON answer. `as AdvisorReply` tells TypeScript to treat it as that shape (not checked).
      const reply = (await res.json()) as AdvisorReply;
      // Append the advisor's answer to the conversation.
      setMessages((m) => [...m, { role: "assistant", reply }]);
    } catch {
      // Any failure (no network, server error): show a friendly red message instead of crashing.
      setMessages((m) => [...m, { role: "error", text: "The advisor is unavailable right now. Please try again." }]);
    } finally {
      // Always stop the loading state, whether it worked or not.
      setLoading(false);
    }
  }

  return (
    // `fixed bottom-5 right-5` pins this to the bottom-right corner even when the page scrolls;
    // `z-40` puts it above most other content.
    <div className="fixed bottom-5 right-5 z-40">
      {/* When closed: the round launcher button. `onClick={() => setOpen(true)}` is an event handler,
          a function React calls when the button is clicked. `rounded-full` = pill shape. */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full bg-ink-900 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-ink-900/20 hover:bg-ink-800"
        >
          <Sparkles className="h-4 w-4 text-emerald" /> FundHub AI Advisor
        </button>
      )}

      {/* When open: the chat panel. `role="dialog"` and `aria-label` describe it to screen readers.
          `w-[22rem] max-w-[calc(100vw-2.5rem)]` = fixed width, but never wider than the screen minus a margin. */}
      {open && (
        <div
          role="dialog"
          aria-label="FundHub AI Advisor"
          className="w-[22rem] max-w-[calc(100vw-2.5rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        >
          {/* Dark header bar with the title on the left and a close (X) button on the right. */}
          <div className="flex items-center justify-between bg-ink-900 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald" />
              <div className="leading-tight">
                <p className="text-sm font-semibold">FundHub AI Advisor</p>
                {/* `&amp;` is the HTML way to write "&" inside JSX text. */}
                <p className="text-[10px] text-slate-400">Operational &amp; regulatory guidance</p>
              </div>
            </div>
            <button type="button" aria-label="Close advisor" onClick={close} className="text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* The scrolling message list. `ref={scrollRef}` connects this element to the ref above.
              `max-h-96 overflow-y-auto` = limited height with a vertical scrollbar. `aria-live="polite"`
              makes screen readers announce new messages. */}
          <div ref={scrollRef} className="thin-scroll max-h-96 space-y-3 overflow-y-auto bg-canvas p-4" aria-live="polite">
            {/* For each message, pick how to draw it with nested ternaries (`cond ? a : b`):
                user = dark bubble on the right; assistant = <AssistantBubble> on the left; otherwise
                (error) = red text. `i` is the position in the array, used as the `key`; fine here because
                messages are only ever added at the end, never reordered. */}
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[80%] rounded-lg rounded-br-sm bg-ink-900 px-3 py-2 text-xs leading-relaxed text-white">
                    {m.text}
                  </div>
                </div>
              ) : m.role === "assistant" ? (
                <div key={i} className="flex justify-start">
                  <AssistantBubble reply={m.reply} />
                </div>
              ) : (
                <p key={i} className="text-xs text-red-600">
                  {m.text}
                </p>
              ),
            )}
            {/* While waiting: a spinning icon (`animate-spin`) and "Thinking…". */}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
              </div>
            )}
          </div>

          {/* The question form. `onSubmit={ask}` runs `ask` when Enter is pressed or Send is clicked. */}
          <form onSubmit={ask} className="flex items-center gap-2 border-t border-slate-200 bg-white p-3">
            {/* A "controlled" input: its `value` always comes from state, and every keystroke (`onChange`)
                writes the new text back into state with `setInput`. `e.target.value` = the box's text.
                `maxLength={500}` caps the question length. `focus:` classes apply while the box is active. */}
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={500}
              aria-label="Ask the advisor"
              placeholder="Ask about fees, regs, or providers..."
              className="flex-1 rounded-md border border-slate-200 bg-canvas px-3 py-2 text-xs text-ink placeholder:text-slate-400 focus:border-emerald focus:bg-white focus:outline-none"
            />
            {/* Send button, disabled while loading or when the box is empty (`||` = "or").
                `disabled:opacity-50` greys it out when disabled. */}
            <button
              type="submit"
              aria-label="Send"
              disabled={loading || !input.trim()}
              className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
          {/* Legal disclaimer under the form. */}
          <p className="border-t border-slate-100 bg-white px-3 py-1.5 text-[10px] text-slate-400">
            General information only, not legal or tax advice. Independent: no referral fees.
          </p>
        </div>
      )}
    </div>
  );
}
