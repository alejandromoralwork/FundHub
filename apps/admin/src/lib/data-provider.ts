"use client";

/**
 * FILE: apps/admin/src/lib/data-provider.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: The "data provider" for Refine, the framework that powers the Console's generic data tables
 *   and forms (drawn with Ant Design components). Refine does not know where data lives; it calls the
 *   functions in this object (getList, getOne, create, update, deleteOne, custom), and each one translates the
 *   request into a call to our own JSON API at /admin/api/resources/… (handled on the server via ./api.ts).
 * WHERE IT RUNS: in the browser. Unlike most files in this folder it is not server code: it holds no
 *   secrets and only talks to our own API, which does all the permission checks.
 * FRAMEWORK NOTES: `"use client";` (must stay the first line) tells Next.js this module runs in the browser.
 *   The Console is served under the basePath "/admin", so API addresses start with "/admin/api/…".
 *   The browser's own session cookie is sent automatically with these same-origin requests.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `import type` (type-only imports), generics `<T>`, optional parameters `init?:`.
 *   - an object typed with an interface from a library (`const dataProvider: DataProvider = { … }`).
 *   - arrow functions with destructured parameters `async ({ resource, id }) => …`.
 *   - spread `...obj`, optional chaining `?.`, `??`, `throw`, template strings, `as never`.
 */

// `import type { … }` brings in only TypeScript types (erased when the code runs) from the Refine library:
// BaseRecord = one row of any table; CrudFilters = the list of filters; DataProvider = the shape Refine
// expects from this file; HttpError = the error shape Refine understands and shows to the user.
import type { BaseRecord, CrudFilters, DataProvider, HttpError } from "@refinedev/core";

/** Same-origin API under the /admin basePath. Kind: constant (exported). */
export const API_BASE = "/admin/api/resources";

/**
 * Kind: async generic function (private).
 * Calls our API and returns the JSON reply.
 * @param url   type `string` — the address to call.
 * @param init  optional, type `RequestInit` — the standard fetch options (method, body, headers…).
 * @returns `Promise<T>`: the parsed reply as the type the caller asks for.
 * @throws an `HttpError` (message + status code) when the server answers with an error, so Refine can show it.
 */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  // `{ ...init, headers: { … } }` copies all given options and sets the headers: JSON by default, plus any
  // headers passed in (`...init?.headers`, which adds nothing if there are none).
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  // Parse the JSON reply; fall back to an empty object if it is not JSON.
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Use the server's message (our API sends `{ message }`), or the standard status text such as "Not Found".
    const err: HttpError = { message: body.message ?? res.statusText, statusCode: res.status };
    throw err;
  }
  return body as T;
}

/**
 * Kind: function (private).
 * Copies Refine's filters into the URL query string in the format ./api.ts expects.
 * @param filters  type `CrudFilters | undefined` — the active filters (may be none).
 * @param qs       type `URLSearchParams` — the query string being built (changed in place).
 * @returns nothing (`void`).
 */
function filterParams(filters: CrudFilters | undefined, qs: URLSearchParams) {
  // `filters ?? []` = loop over nothing if there are no filters.
  for (const f of filters ?? []) {
    // Skip grouped filters (which have no "field") and empty values.
    if (!("field" in f) || f.value === undefined || f.value === null || f.value === "") continue;
    // A filter on the special field "q" is the free-text search box; others become "filter[column]=value".
    if (f.field === "q") qs.set("q", String(f.value));
    else qs.set(`filter[${f.field}]`, String(f.value));
  }
}

/**
 * Kind: constant object (exported), typed as Refine's `DataProvider`.
 * Each property is a function Refine calls. TypeScript checks that every function has the right shape.
 */
export const dataProvider: DataProvider = {
  // The base API address.
  getApiUrl: () => API_BASE,

  // A page of rows for a table. Refine passes the table name, the pager, the sorting and the filters
  // (destructured from one object argument).
  getList: async ({ resource, pagination, sorters, filters }) => {
    const qs = new URLSearchParams();
    // Page and page size, defaulting to page 1 of 20 rows.
    qs.set("page", String(pagination?.currentPage ?? 1));
    qs.set("pageSize", String(pagination?.pageSize ?? 20));
    // Only the first sorter is used (our API sorts by one column).
    const sorter = sorters?.[0];
    if (sorter) {
      qs.set("sort", sorter.field);
      qs.set("order", sorter.order);
    }
    filterParams(filters, qs);
    // e.g. GET /admin/api/resources/providers?page=1&pageSize=20. The reply has `data` and `total`.
    const { data, total } = await request<{ data: BaseRecord[]; total: number }>(`${API_BASE}/${resource}?${qs}`);
    // `as never` silences a type mismatch: Refine's exact row type is decided by the page using it.
    return { data: data as never, total };
  },

  // One row by id: GET …/<resource>/<id>.
  getOne: async ({ resource, id }) => request(`${API_BASE}/${resource}/${id}`),

  // New row: POST …/<resource> with the form values as JSON.
  create: async ({ resource, variables }) =>
    request(`${API_BASE}/${resource}`, { method: "POST", body: JSON.stringify(variables) }),

  // Edit a row: PATCH (partial update) …/<resource>/<id>.
  update: async ({ resource, id, variables }) =>
    request(`${API_BASE}/${resource}/${id}`, { method: "PATCH", body: JSON.stringify(variables) }),

  // Delete a row: DELETE …/<resource>/<id>.
  deleteOne: async ({ resource, id }) => request(`${API_BASE}/${resource}/${id}`, { method: "DELETE" }),

  // Refine expects custom() to resolve to { data }.
  // Any other API call: the given URL and method (upper-cased, e.g. "post" → "POST"), with an optional JSON body.
  custom: async ({ url, method, payload }) => ({
    data: await request(url, { method: method.toUpperCase(), body: payload ? JSON.stringify(payload) : undefined }),
  }),
};
