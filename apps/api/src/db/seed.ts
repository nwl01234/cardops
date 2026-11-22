import { loadConfig } from '../config/env';
import { createDatabase } from './client';
import { seedDatabase } from './seed-runner';

const config = loadConfig();
if (!config.SEED_DEMO) {
  console.log('SEED_DEMO=false: demo fixtures are disabled.');
  process.exit(0);
}

const handle = createDatabase(config.DATABASE_URL, { max: 1 });

try {
  const result = await seedDatabase(handle.db, { includeDemoCards: true });
  console.log(
    `Seed complete: ${result.users} users, ${result.warehouses} warehouses, ` +
      (result.cards > 0 ? `${result.cards} demo cards.` : 'demo cards already present.'),
  );
} finally {
  await handle.close();
}
