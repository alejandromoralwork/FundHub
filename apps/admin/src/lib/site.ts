/** Public website origin, used in links inside emails. */
export function websiteUrl(): string {
  if (process.env.PUBLIC_SITE_URL) return process.env.PUBLIC_SITE_URL.replace(/\/$/, "");
  return process.env.NODE_ENV === "production" ? "https://fundhub.lu" : "http://localhost:3000";
}
