import { loadConfig } from '../config/env';
import { runMigrations } from './migrator';

const config = loadConfig();
await runMigrations(config.DATABASE_URL);
console.log('Database migrations applied.');
process.exit(0);
