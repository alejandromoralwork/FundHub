"use client";

import { useActionState } from "react";
import { CheckCircle2, Loader2, Save } from "lucide-react";
import {
  ASSET_CLASSES,
  CERTIFICATIONS,
  LICENCES,
  PROVIDER_TYPES,
  REGULATORY_SCOPES,
  TECH_STACKS,
  type Provider,
} from "@fundhub/db/schema";
import { updateProviderProfile, type ActionState } from "@/lib/account-actions";
import { TAXONOMY } from "@fundhub/core/taxonomy";

const inputClass =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-ink focus:border-emerald focus:outline-none focus:ring-2 focus:ring-emerald/20";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-slate-200 bg-white p-5">
      <legend className="sr-only">{title}</legend>
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      <div className="mt-4">{children}</div>
    </fieldset>
  );
}

function Text({
  label,
  name,
  defaultValue,
  error,
  ...rest
}: { label: string; name: string; defaultValue?: string | number | null; error?: string } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "defaultValue"
>) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-xs font-medium text-ink-600">
        {label}
      </label>
      <input id={name} name={name} defaultValue={defaultValue ?? ""} className={inputClass} {...rest} />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function Lines({ label, name, values, hint }: { label: string; name: string; values: string[]; hint?: string }) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-xs font-medium text-ink-600">
        {label}
      </label>
      <textarea id={name} name={name} rows={3} defaultValue={values.join("\n")} className={inputClass} />
      <p className="mt-0.5 text-[11px] text-slate-400">{hint ?? "One per line"}</p>
    </div>
  );
}

function Checks({ name, options, selected, labels }: { name: string; options: readonly string[]; selected: string[]; labels?: Record<string, string> }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <label key={o} className="flex cursor-pointer items-center gap-2 text-sm text-ink-600">
          <input type="checkbox" name={name} value={o} defaultChecked={selected.includes(o)} className="check h-4 w-4 shrink-0" />
          {labels?.[o] ?? o}
        </label>
      ))}
    </div>
  );
}

export function ProfileEditor({ provider: p }: { provider: Provider }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateProviderProfile, {});
  const fe = state.fieldErrors ?? {};
  const knownTech = p.techStack.filter((t) => (TECH_STACKS as readonly string[]).includes(t));
  const otherTech = p.techStack.filter((t) => !(TECH_STACKS as readonly string[]).includes(t));

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="providerId" value={p.id} />

      <Section title="Company overview">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="description" className="mb-1 block text-xs font-medium text-ink-600">
              Description
            </label>
            <textarea id="description" name="description" rows={4} maxLength={1200} defaultValue={p.description} className={inputClass} />
          </div>
          <Text label="Website" name="website" defaultValue={p.website} placeholder="https://" error={fe.website} />
          <Text label="Luxembourg location" name="headquarters" defaultValue={p.headquarters} error={fe.headquarters} />
          <div>
            <label htmlFor="providerType" className="mb-1 block text-xs font-medium text-ink-600">
              Provider size
            </label>
            <select id="providerType" name="providerType" defaultValue={p.providerType} className={inputClass}>
              {PROVIDER_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <Text label="Founded (year)" name="foundedYear" type="number" defaultValue={p.foundedYear} error={fe.foundedYear} />
          <Text label="Local headcount" name="headcount" type="number" min={1} defaultValue={p.headcount} error={fe.headcount} />
          <Text label="Active client mandates" name="mandates" type="number" min={0} defaultValue={p.mandates} error={fe.mandates} />
        </div>
      </Section>

      <Section title="Services" hint="Map your offering to FundHub's standard taxonomy so buyers can compare like for like.">
        <div className="space-y-4">
          {TAXONOMY.map((c) => (
            <div key={c.slug}>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{c.label}</p>
              <Checks name="services" options={c.services} selected={p.services} />
            </div>
          ))}
        </div>
        {fe.services && <p className="mt-2 text-xs text-red-600">{fe.services}</p>}
        <div className="mt-5">
          <p className="mb-1.5 text-xs font-medium text-ink-600">Also list me under these categories</p>
          <Checks
            name="secondaryCategories"
            options={TAXONOMY.map((c) => c.slug).filter((s) => s !== p.category)}
            selected={p.secondaryCategories}
            labels={Object.fromEntries(TAXONOMY.map((c) => [c.slug, c.label]))}
          />
        </div>
      </Section>

      <Section title="Licences, coverage & certifications">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-600">Licences & authorisations</p>
            <Checks name="licences" options={LICENCES} selected={p.licences} />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-600">Asset classes</p>
            <Checks name="assetClasses" options={ASSET_CLASSES} selected={p.assetClasses} />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-600">Regulatory scope</p>
            <Checks name="regulatoryScope" options={REGULATORY_SCOPES} selected={p.regulatoryScope} />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-600">Certifications</p>
            <Checks name="certifications" options={CERTIFICATIONS} selected={p.certifications} />
          </div>
        </div>
      </Section>

      <Section title="Technology, clients & footprint">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-600">Tech stack</p>
            <Checks name="techStack" options={TECH_STACKS} selected={knownTech} />
          </div>
          <Lines label="Other systems" name="otherTech" values={otherTech} />
          <Lines label="Top existing clients (with their consent)" name="topClients" values={p.topClients} />
          <Lines label="Countries with an office" name="footprint" values={p.footprint} />
          <Lines label="Highlights / tags" name="tags" values={p.tags} hint="Short tags, e.g. 'Daily NAV'. One per line." />
        </div>
      </Section>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white/95 p-4 backdrop-blur">
        <div className="text-sm" aria-live="polite">
          {state.ok && (
            <span className="flex items-center gap-1.5 text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> {state.ok}
            </span>
          )}
          {state.error && <span className="text-red-600">{state.error}</span>}
          {!state.ok && !state.error && (
            <span className="text-xs text-slate-500">Changes go live immediately and are logged.</span>
          )}
        </div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-md bg-emerald px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save profile
        </button>
      </div>
    </form>
  );
}
