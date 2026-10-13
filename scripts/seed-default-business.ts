/**
 * Creates the default business from the current env vars (COMPANY_NAME,
 * PERSONA_NAME, BUSINESS_EMAIL). Safe to re-run: an existing default
 * business is left as it is.
 *
 * Usage: npm run db:seed
 */

import { ensureDefaultBusiness } from '../src/services/business.service';
import { db } from '../src/lib/db';

async function main() {
  const business = await ensureDefaultBusiness();
  console.log(`Default business: ${business.name} (slug "${business.slug}", ${business.mode})`);
}

main()
  .catch((err) => {
    console.error('Seeding failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
