import { createPool } from './pool';
import { migrate } from './migrate';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Copy .env.example to .env.');
const pool = createPool(process.env.DATABASE_URL);
try { await migrate(pool); console.info('Database migrations are up to date.'); }
finally { await pool.end(); }
