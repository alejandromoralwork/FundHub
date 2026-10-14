"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BadgeCheck, Loader2, Send, ShieldCheck, Sparkles, X } from "lucide-react";
import { formatPriceRange } from "@/lib/format";
import type { AdvisorReply } from "@/lib/advisor";

type Message = { role: "user"; text: string } | { role: "assistant"; reply: AdvisorReply } | { role: "error"; text: string };

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
      providers: [],
      filterHref: "/compare?reg=RAIF",
    },
  },
];

function AssistantBubble({ reply }: { reply: AdvisorReply }) {
  return (
    <div className="max-w-[90%] rounded-lg rounded-bl-sm border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-ink-600">
      <p className="mb-1.5 flex items-center gap-1 font-semibold text-ink">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald" /> {reply.title}
      </p>
      <p>{reply.body}</p>
      {reply.points.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
          {reply.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {reply.providers.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Matching providers</p>
          {reply.providers.map((p) => (
            <Link key={p.slug} href={`/providers/${p.slug}`} className="flex items-center justify-between gap-2 hover:text-ink">
              <span className="flex min-w-0 items-center gap-1 truncate font-medium text-ink">
                {p.verified && <BadgeCheck className="h-3 w-3 shrink-0 text-emerald" />}
                <span className="truncate">{p.name}</span>
              </span>
              <span className="shrink-0 tnum text-slate-500">{formatPriceRange(p.priceMin, p.priceMax)}</span>
            </Link>
          ))}
        </div>
      )}
      {reply.filterHref && (
        <Link href={reply.filterHref} className="mt-2 inline-block font-medium text-emerald-700 hover:underline">
          Open in comparator →
        </Link>
      )}
    </div>
  );
}

export function AdvisorWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(INTRO);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Open by default on large screens, once per browser session.
  useEffect(() => {
    try {
      if (window.matchMedia("(min-width: 1280px)").matches && !sessionStorage.getItem("advisor-dismissed")) setOpen(true);
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  const close = () => {
    setOpen(false);
    try {
      sessionStorage.setItem("advisor-dismissed", "1");
    } catch {
      /* storage unavailable */
    }
  };

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setLoading(true);
    try {
      const res = await fetch("/api/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const reply = (await res.json()) as AdvisorReply;
      setMessages((m) => [...m, { role: "assistant", reply }]);
    } catch {
      setMessages((m) => [...m, { role: "error", text: "The advisor is unavailable right now. Please try again." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-40">
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full bg-ink-900 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-ink-900/20 hover:bg-ink-800"
        >
          <Sparkles className="h-4 w-4 text-emerald" /> FundHub AI Advisor
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="FundHub AI Advisor"
          className="w-[22rem] max-w-[calc(100vw-2.5rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        >
          <div className="flex items-center justify-between bg-ink-900 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald" />
              <div className="leading-tight">
                <p className="text-sm font-semibold">FundHub AI Advisor</p>
                <p className="text-[10px] text-slate-400">Operational &amp; regulatory guidance</p>
              </div>
            </div>
            <button type="button" aria-label="Close advisor" onClick={close} className="text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={scrollRef} className="thin-scroll max-h-96 space-y-3 overflow-y-auto bg-canvas p-4" aria-live="polite">
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
            {loading && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
              </div>
            )}
          </div>

          <form onSubmit={ask} className="flex items-center gap-2 border-t border-slate-200 bg-white p-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={500}
              aria-label="Ask the advisor"
              placeholder="Ask about fees, regs, or providers..."
              className="flex-1 rounded-md border border-slate-200 bg-canvas px-3 py-2 text-xs text-ink placeholder:text-slate-400 focus:border-emerald focus:bg-white focus:outline-none"
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={loading || !input.trim()}
              className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
          <p className="border-t border-slate-100 bg-white px-3 py-1.5 text-[10px] text-slate-400">
            General information only, not legal or tax advice. Independent: no referral fees.
          </p>
        </div>
      )}
    </div>
  );
}
