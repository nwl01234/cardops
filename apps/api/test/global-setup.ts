import { loadConfig } from '../src/config/env';
import { runMigrations } from '../src/db/migrator';

export default async function setup(): Promise<void> {
  const config = loadConfig();
  await runMigrations(config.DATABASE_URL);
}
