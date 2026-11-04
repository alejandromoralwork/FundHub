"use client";
/**
 * FILE: apps/web/src/components/profile-editor.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The form a service provider uses (from their account area) to edit their public profile:
 *   company overview, services offered (mapped to FundHub's category taxonomy), licences, asset classes,
 *   regulatory scope, certifications, tech stack, clients, office countries and tags. A sticky bar at the
 *   bottom shows the save button and the result ("saved" or an error).
 * WHERE IT RUNS: in the browser ("use client" on the first line) because it keeps the form's result state.
 *   Saving happens on the server in the `updateProviderProfile` server action, which also checks that the
 *   logged-in user is allowed to edit this provider and validates every field.
 * FRAMEWORK NOTES:
 *   - A React component is a function returning JSX (HTML-like markup). This file defines several small
 *     private components (Section, Text, Lines, Checks) and one exported one (ProfileEditor).
 *   - `useActionState(action, initialState)` wires a <form> to a server action and remembers its last result.
 *   - The fields are "uncontrolled": they start with `defaultValue`/`defaultChecked` and the browser keeps
 *     track of edits itself; React only reads them when the form is submitted. This is simpler than storing
 *     every field in React state.
 *   - A form field's `name` is the key the server reads from the submitted FormData. Several checkboxes with
 *     the same name send a list of values.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `type X` inside an import list = import only a type.
 *   - intersection `A & B` = an object having the fields of both A and B.
 *   - `Omit<T, "key">` = type T without the property "key"; `React.InputHTMLAttributes<HTMLInputElement>` =
 *     every attribute a normal <input> accepts (type, min, placeholder, …).
 *   - rest/spread props: `...rest` collects the remaining props; `{...rest}` passes them all on.
 *   - type assertion `X as readonly string[]` = "treat X as this type"; optional chaining `labels?.[o]`.
 *   - `Record<string, string>`; nullish coalescing `a ?? b`; `Object.fromEntries`.
 */

// `import { a } from "b"` brings named things from another file or library into this one.
// React's hook for wiring a form to a server action (from the `react` npm package).
import { useActionState } from "react";
// Icons from `lucide-react` (npm): a tick in a circle, a spinner, and a floppy-disk "save" icon.
import { CheckCircle2, Loader2, Save } from "lucide-react";
// From our database package (packages/db): the fixed lists of allowed values for several profile fields, and
// the `Provider` type (one row of the providers table).
import {
  ASSET_CLASSES,
  CERTIFICATIONS,
  LICENCES,
  PROVIDER_TYPES,
  REGULATORY_SCOPES,
  TECH_STACKS,
  type Provider,
} from "@fundhub/db/schema";
// From this app's src/lib/account-actions.ts: the server action that saves the profile, and its result type
// `ActionState` = { ok?: string; error?: string; fieldErrors?: Record<string, string> }.
import { updateProviderProfile, type ActionState } from "@/lib/account-actions";
// The list of service categories, each with its own list of services (packages/core).
import { TAXONOMY } from "@fundhub/core/taxonomy";

/**
 * Kind: constant (string). The Tailwind classes shared by every text box, textarea and dropdown in this form:
 * full width, rounded border, padding, and a green border + soft green ring while focused (`focus:`).
 */
const inputClass =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-ink focus:border-emerald focus:outline-none focus:ring-2 focus:ring-emerald/20";

/**
 * Kind: React component (private to this file).
 * A titled white box grouping related fields.
 * Props: title (`string`), hint (`string`, optional explanation), children (`React.ReactNode`, the fields).
 * Returns: JSX — a <fieldset>. The <legend> is hidden visually (`sr-only` = "screen-reader only") but tells
 *   assistive technology the group's name; the visible heading is the <h2>.
 */
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

/**
 * Kind: React component (private to this file).
 * A labelled single-line input with an optional error message under it.
 * Props:
 *   - label         `string` — visible label text.
 *   - name          `string` — the form field name (also used as the HTML id that links the label to it).
 *   - defaultValue  `string | number | null`, optional — the starting value (null/undefined → empty box).
 *   - error         `string`, optional — a validation message from the server for this field.
 *   - ...rest       any other normal <input> attribute (type, min, placeholder…), passed straight through.
 * The type `{…} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "defaultValue">` means: our own props
 * plus every standard input attribute except the standard `defaultValue` (we replaced it with our own version
 * that also accepts null, since database fields can be empty).
 * Returns: JSX — label, input and optional error.
 */
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
      {/* `htmlFor` (JSX's name for HTML's `for`) links the label to the input with the same id, so clicking
          the label focuses the box. */}
      <label htmlFor={name} className="mb-1 block text-xs font-medium text-ink-600">
        {label}
      </label>
      {/* `defaultValue ?? ""` turns null/undefined into an empty string. `{...rest}` spreads all extra
          attributes (e.g. type="number") onto the input. */}
      <input id={name} name={name} defaultValue={defaultValue ?? ""} className={inputClass} {...rest} />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

/**
 * Kind: React component (private to this file).
 * A labelled multi-line box for list fields, one entry per line.
 * Props: label (`string`), name (`string`), values (`string[]`, the current list), hint (`string`, optional;
 *   defaults to "One per line").
 * Returns: JSX — label, a 3-row <textarea> pre-filled with the list joined by line breaks ("\n"), and the hint.
 *   The server splits the text back into a list.
 */
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

/**
 * Kind: React component (private to this file).
 * A grid of checkboxes, one per allowed option, all sharing the same field `name` so the server receives a
 * list of the ticked values.
 * Props:
 *   - name      `string` — the form field name.
 *   - options   `readonly string[]` — every allowed value.
 *   - selected  `string[]` — the values currently ticked.
 *   - labels    `Record<string, string>`, optional — display text per value (when the value itself is a code
 *               like a slug); without it the value is shown as-is.
 * Returns: JSX — the checkbox grid (two columns from `sm:` screens).
 */
function Checks({ name, options, selected, labels }: { name: string; options: readonly string[]; selected: string[]; labels?: Record<string, string> }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {/* One clickable label + checkbox per option; the option text is unique, so it is the `key`. */}
      {options.map((o) => (
        <label key={o} className="flex cursor-pointer items-center gap-2 text-sm text-ink-600">
          {/* Ticked to start with if the provider already has this value (`.includes` returns true/false).
              `check` is a custom CSS class from our stylesheet for the checkbox look. */}
          <input type="checkbox" name={name} value={o} defaultChecked={selected.includes(o)} className="check h-4 w-4 shrink-0" />
          {/* `labels?.[o]` = "if labels exists, look up o in it" (optional chaining); `?? o` = else show o. */}
          {labels?.[o] ?? o}
        </label>
      ))}
    </div>
  );
}

/**
 * Kind: React component (client component, exported).
 * Props: provider — type `Provider`, the provider being edited, renamed to `p` for brevity.
 * Returns: JSX — the whole edit form.
 */
export function ProfileEditor({ provider: p }: { provider: Provider }) {
  // `state` = last result from the server action (starts as `{}`); `action` = what the <form> calls;
  // `pending` = true while saving. The generics say: state is ActionState, the input is FormData.
  const [state, action, pending] = useActionState<ActionState, FormData>(updateProviderProfile, {});
  // Per-field error messages (e.g. { website: "Enter a valid URL" }), or an empty object if there are none,
  // so `fe.website` below is simply undefined when that field is fine.
  const fe = state.fieldErrors ?? {};
  // Split the provider's tech stack into systems from FundHub's standard list (shown as checkboxes) and any
  // others (shown in the free-text "Other systems" box). `.filter` returns a new list of the items for which
  // the test is true; `!` negates it. `TECH_STACKS as readonly string[]` widens the type of the fixed list so
  // `.includes` accepts any string (TypeScript otherwise only allows the exact listed values).
  const knownTech = p.techStack.filter((t) => (TECH_STACKS as readonly string[]).includes(t));
  const otherTech = p.techStack.filter((t) => !(TECH_STACKS as readonly string[]).includes(t));

  return (
    // Submitting calls the server action with all named fields. `space-y-4` = gap between the sections.
    <form action={action} className="space-y-4">
      {/* Hidden field telling the server which provider to update. The server does not trust it blindly: it
          checks the logged-in user may manage this provider before saving. */}
      <input type="hidden" name="providerId" value={p.id} />

      <Section title="Company overview">
        {/* Two-column grid from `sm:` screens; the description spans both columns (`sm:col-span-2`). */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="description" className="mb-1 block text-xs font-medium text-ink-600">
              Description
            </label>
            {/* `maxLength={1200}` stops typing beyond 1,200 characters in the browser. */}
            <textarea id="description" name="description" rows={4} maxLength={1200} defaultValue={p.description} className={inputClass} />
          </div>
          {/* `error={fe.website}` shows the server's message for that field, if any. Same pattern below. */}
          <Text label="Website" name="website" defaultValue={p.website} placeholder="https://" error={fe.website} />
          <Text label="Luxembourg location" name="headquarters" defaultValue={p.headquarters} error={fe.headquarters} />
          <div>
            <label htmlFor="providerType" className="mb-1 block text-xs font-medium text-ink-600">
              Provider size
            </label>
            {/* Dropdown of the allowed provider types. With no `value` attribute, an <option>'s value is its text. */}
            <select id="providerType" name="providerType" defaultValue={p.providerType} className={inputClass}>
              {PROVIDER_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          {/* Number fields: `type`, `min` are ordinary input attributes passed through via `...rest`. */}
          <Text label="Founded (year)" name="foundedYear" type="number" defaultValue={p.foundedYear} error={fe.foundedYear} />
          <Text label="Local headcount" name="headcount" type="number" min={1} defaultValue={p.headcount} error={fe.headcount} />
          <Text label="Active client mandates" name="mandates" type="number" min={0} defaultValue={p.mandates} error={fe.mandates} />
        </div>
      </Section>

      <Section title="Services" hint="Map your offering to FundHub's standard taxonomy so buyers can compare like for like.">
        {/* One checkbox group per service category, all under the same field name "services". */}
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
          {/* Options: every category slug except the provider's own primary category (`.map` picks the slugs,
              `.filter` drops the primary). `labels` is built with `Object.fromEntries`, which turns a list of
              [key, value] pairs into an object: { "fund-administration": "Fund administration", … }. */}
          <Checks
            name="secondaryCategories"
            options={TAXONOMY.map((c) => c.slug).filter((s) => s !== p.category)}
            selected={p.secondaryCategories}
            labels={Object.fromEntries(TAXONOMY.map((c) => [c.slug, c.label]))}
          />
        </div>
      </Section>

      {/* Four checkbox groups, each fed by one of the fixed value lists imported from the database package. */}
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
          {/* Standard systems as checkboxes; non-standard ones (computed above) in the "Other systems" box.
              The server merges both back into one tech stack list. */}
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

      {/* Save bar that sticks to the bottom of the screen while scrolling (`sticky bottom-0`). `bg-white/95`
          (95% opaque white) + `backdrop-blur` blurs the content scrolling behind it. */}
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white/95 p-4 backdrop-blur">
        {/* `aria-live="polite"` makes screen readers announce the message here when it changes. Exactly one of
            three messages shows: success (green with a tick), error (red), or — before any save — a note. */}
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
        {/* Disabled while saving; shows a spinning icon instead of the save icon during that time. */}
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
