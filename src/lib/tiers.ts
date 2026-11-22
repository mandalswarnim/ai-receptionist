/**
 * Which pricing tier gets which feature. The one place to change the tier
 * table (docs/MARKET-READY-PLAN.md, "The four tiers"): code asks
 * hasFeature(), never compares tier names itself.
 */

import type { Tier } from '@prisma/client';

/** Cheapest first. */
export const TIERS: readonly Tier[] = ['AGATHOS', 'ARETE', 'ARISTEIA', 'AXIOM'];

const FEATURES = {
  /** Call summaries by WhatsApp, instead of or as well as email. */
  whatsappAlerts: ['ARISTEIA', 'AXIOM'],
} satisfies Record<string, readonly Tier[]>;

export type Feature = keyof typeof FEATURES;

export function hasFeature(tier: Tier, feature: Feature): boolean {
  return (FEATURES[feature] as readonly Tier[]).includes(tier);
}

/** "Aristeia and Axiom", for error messages. */
export function tiersWith(feature: Feature): string {
  const names = FEATURES[feature].map((t) => t.charAt(0) + t.slice(1).toLowerCase());
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
}
