"use client";

import type { BaseRecord, CrudFilters, DataProvider, HttpError } from "@refinedev/core";

/** Same-origin API under the /admin basePath. */
export const API_BASE = "/admin/api/resources";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: HttpError = { message: body.message ?? res.statusText, statusCode: res.status };
    throw err;
  }
  return body as T;
}

function filterParams(filters: CrudFilters | undefined, qs: URLSearchParams) {
  for (const f of filters ?? []) {
    if (!("field" in f) || f.value === undefined || f.value === null || f.value === "") continue;
    if (f.field === "q") qs.set("q", String(f.value));
    else qs.set(`filter[${f.field}]`, String(f.value));
  }
}

export const dataProvider: DataProvider = {
  getApiUrl: () => API_BASE,

  getList: async ({ resource, pagination, sorters, filters }) => {
    const qs = new URLSearchParams();
    qs.set("page", String(pagination?.currentPage ?? 1));
    qs.set("pageSize", String(pagination?.pageSize ?? 20));
    const sorter = sorters?.[0];
    if (sorter) {
      qs.set("sort", sorter.field);
      qs.set("order", sorter.order);
    }
    filterParams(filters, qs);
    const { data, total } = await request<{ data: BaseRecord[]; total: number }>(`${API_BASE}/${resource}?${qs}`);
    return { data: data as never, total };
  },

  getOne: async ({ resource, id }) => request(`${API_BASE}/${resource}/${id}`),

  create: async ({ resource, variables }) =>
    request(`${API_BASE}/${resource}`, { method: "POST", body: JSON.stringify(variables) }),

  update: async ({ resource, id, variables }) =>
    request(`${API_BASE}/${resource}/${id}`, { method: "PATCH", body: JSON.stringify(variables) }),

  deleteOne: async ({ resource, id }) => request(`${API_BASE}/${resource}/${id}`, { method: "DELETE" }),

  // Refine expects custom() to resolve to { data }.
  custom: async ({ url, method, payload }) => ({
    data: await request(url, { method: method.toUpperCase(), body: payload ? JSON.stringify(payload) : undefined }),
  }),
};
