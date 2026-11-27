/**
 * FILE: services/engine/src/pipeline/lifecycle.ts
 * PART: scraping engine (services/engine) — fund lifecycle (core.fund_events, companies.launch_date / closure_date)
 * WHAT IT DOES: Job `fund_lifecycle`. Rebuilds the generated fund events from what the sources state, then sets each
 *   fund's launch and closure date. Staff events (source "manual") are kept. Events, per fund / sub-fund:
 *     incorporated       creation date (GLEIF entity creation, RCS registration)
 *     authorised         CSSF authorisation, or the date the fund entered its CSSF list
 *     launched           a CSSF sub-fund's start date (on the sub-fund)
 *     sub_fund_added     the same date, on the umbrella (related = the sub-fund)
 *     sub_fund_closed    a CSSF sub-fund's end date (on the umbrella; "closed" on the sub-fund)
 *     deregistered       the fund left its CSSF list
 *     closed             struck off the RCS
 *     manager_appointed  a manager mandate's start (core.mandates); manager_changed when it replaced another
 *   launch_date = the sub-fund start for sub-funds, else the CSSF authorisation, else the creation date.
 *   Everything is set-based SQL in one transaction (about 100k funds and sub-funds).
 * WHERE IT RUNS: engine workers (group "maintenance"), daily after build_groups.
 */

import { sql } from "drizzle-orm";
import { db } from "@fundhub/engine-db/client";
import { withActor } from "@fundhub/engine-db/core/entity";
import { log } from "../log";

/** Kind: async function. Job "fund_lifecycle". @returns events per kind and how many funds got a launch / closure date. */
export async function fundLifecycle() {
  const t0 = Date.now();
  const result = await db.transaction(async (tx) => {
    await withActor(tx, "engine:lifecycle");
    await tx.execute(sql`delete from core.fund_events where source <> 'manual'`);
    // Funds and sub-funds only.
    await tx.execute(sql`create temp table lc_funds on commit drop as select id from core.companies where company_kind = 'fund'`);
    // A claim's date value (stored as a JSON string) → date; nonsense values are ignored.
    const claimDate = (attr: string) => sql`
      select c.company_id, c.source, min((c.value #>> '{}')::date) as d
      from clean.claims c join lc_funds f on f.id = c.company_id
      where c.valid_to is null and c.attribute = ${attr} and (c.value #>> '{}') ~ '^\\d{4}-\\d{2}-\\d{2}'
        and (c.value #>> '{}') between '1900-01-01' and to_char(current_date, 'YYYY-MM-DD')
      group by 1, 2`;

    await tx.execute(sql`
      insert into core.fund_events (company_id, kind, event_date, source, evidence)
      select company_id, 'incorporated', min(d), (array_agg(source order by d))[1], 'creation / registration date'
      from (${claimDate("registrationDate")}) x group by company_id`);
    await tx.execute(sql`
      insert into core.fund_events (company_id, kind, event_date, source, evidence)
      select company_id, 'authorised', min(d), 'cssf', 'CSSF authorisation / entry on its list'
      from (${claimDate("cssfAuthorisationDate")} union all ${claimDate("cssfValidFrom")}) x group by company_id`);
    await tx.execute(sql`
      insert into core.fund_events (company_id, kind, event_date, source, evidence)
      select company_id, 'deregistered', max(d), 'cssf', 'left its CSSF list'
      from (${claimDate("cssfValidTo")}) x group by company_id`);
    await tx.execute(sql`
      insert into core.fund_events (company_id, kind, event_date, date_precision, source, evidence)
      select id, 'closed', d, case when d is null then 'unknown' else 'day' end, 'rcs', 'struck off the RCS'
      from (
        select c.id, (select min((cl.value #>> '{}')::date) from clean.claims cl
                      where cl.company_id = c.id and cl.valid_to is null and cl.attribute = 'rcsDeletionDate'
                        and (cl.value #>> '{}') ~ '^\\d{4}-\\d{2}-\\d{2}') as d
        from core.companies c join lc_funds f on f.id = c.id where c.status = 'struck_off'
      ) x`);

    // CSSF sub-funds: launch / closure on the sub-fund, added / closed on the umbrella.
    await tx.execute(sql`
      create temp table lc_comp on commit drop as
      select distinct on (i.company_id) i.company_id as sub_id, r.company_id as umbrella_id, l.start_date, l.end_date, split_part(l.code, '-', 1) as code
      from clean.licences l
      join staging.source_records r on r.id = l.source_record_id
      join core.company_identifiers i on i.scheme = 'cssf_compartment' and i.value = split_part(l.code, '-', 1)
      where l.kind = 'compartment' and r.company_id is not null
      order by i.company_id, l.last_seen_at desc`);
    await tx.execute(sql`
      insert into core.fund_events (company_id, kind, event_date, related_company_id, source, evidence)
      select sub_id, 'launched', start_date, umbrella_id, 'cssf', 'CSSF sub-fund ' || code || ' start' from lc_comp where start_date is not null and start_date <= current_date
      union all
      select umbrella_id, 'sub_fund_added', start_date, sub_id, 'cssf', 'CSSF sub-fund ' || code from lc_comp where start_date is not null and start_date <= current_date
      union all
      select sub_id, 'closed', end_date, umbrella_id, 'cssf', 'CSSF sub-fund ' || code || ' end' from lc_comp where end_date is not null
      union all
      select umbrella_id, 'sub_fund_closed', end_date, sub_id, 'cssf', 'CSSF sub-fund ' || code || ' end' from lc_comp where end_date is not null`);

    // Manager appointments from the mandates; a later episode after an earlier one is a change.
    await tx.execute(sql`
      insert into core.fund_events (company_id, kind, event_date, date_precision, related_company_id, source, evidence)
      -- A change when an earlier episode is known, or when the manager came more than 6 months after the fund
      -- started (the earlier manager is then unknown: a fund rarely launches without one).
      select m.client_company_id,
             case when exists (select 1 from core.mandates p where p.client_company_id = m.client_company_id and p.role = m.role
                                 and p.id <> m.id and p.valid_from < m.valid_from)
                    or m.valid_from > s.started + interval '6 months' then 'manager_changed' else 'manager_appointed' end,
             m.valid_from, m.valid_from_precision, m.provider_company_id,
             case when m.decided_by like 'staff:%' then 'manual' else 'gleif' end,
             m.provider_name || case when m.valid_from > s.started + interval '6 months'
                                      and not exists (select 1 from core.mandates p where p.client_company_id = m.client_company_id and p.role = m.role and p.id <> m.id)
                                 then ' (fund started ' || s.started || '; previous manager not known)' else '' end
      from core.mandates m join lc_funds f on f.id = m.client_company_id
      left join lateral (
        select min(e.event_date) as started from core.fund_events e
        where e.company_id = m.client_company_id and e.kind in ('launched', 'authorised', 'incorporated')
      ) s on true
      where m.role in ('management_company', 'aifm') and m.valid_from is not null and m.valid_from_precision <> 'unknown'
        and m.decided_by not like 'staff:%'`);

    // Launch and closure dates on the funds.
    const launched = await tx.execute(sql`
      with l as (
        select f.id,
               coalesce(
                 (select min(event_date) from core.fund_events e where e.company_id = f.id and e.kind = 'launched'),
                 (select min(event_date) from core.fund_events e where e.company_id = f.id and e.kind = 'authorised'),
                 (select min(event_date) from core.fund_events e where e.company_id = f.id and e.kind = 'incorporated')) as d,
               case when exists (select 1 from core.fund_events e where e.company_id = f.id and e.kind = 'launched') then 'CSSF sub-fund start'
                    when exists (select 1 from core.fund_events e where e.company_id = f.id and e.kind = 'authorised') then 'CSSF authorisation'
                    when exists (select 1 from core.fund_events e where e.company_id = f.id and e.kind = 'incorporated') then 'creation date'
               end as src
        from lc_funds f
      )
      update core.companies c set launch_date = l.d, launch_date_source = l.src
      from l where c.id = l.id and (c.launch_date is distinct from l.d or c.launch_date_source is distinct from l.src)`);
    const closed = await tx.execute(sql`
      with x as (
        select f.id, min(e.event_date) as d, (array_agg(e.kind order by e.event_date))[1] as why
        from lc_funds f join core.fund_events e on e.company_id = f.id and e.kind in ('closed', 'deregistered') and e.event_date is not null
        group by f.id
      )
      update core.companies c set closure_date = x.d, closure_reason = x.why
      from x where c.id = x.id and (c.closure_date is distinct from x.d or c.closure_reason is distinct from x.why)`);
    const counts = (await tx.execute<{ kind: string; n: number }>(sql`select kind, count(*)::int as n from core.fund_events group by 1 order by 1`)).rows;
    return { events: Object.fromEntries(counts.map((c) => [c.kind, c.n])), launchDatesChanged: launched.rowCount, closureDatesChanged: closed.rowCount };
  });
  const out = { ...result, seconds: Math.round((Date.now() - t0) / 1000) };
  log.info("fund_lifecycle", out);
  return out;
}
