/**
 * Email recipient segments. Marketing goes only to people who opted in; account segments
 * are for service messages (product changes, terms), as GDPR requires.
 */
export const SEGMENTS = {
  newsletter: "Newsletter subscribers (opted in)",
  providers: "All provider accounts (service message)",
  approved_providers: "Provider accounts with an approved company (service message)",
  visitors_service: "All visitor accounts (service message)",
} as const;
export type Segment = keyof typeof SEGMENTS;
