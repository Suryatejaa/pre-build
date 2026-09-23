import { Pool } from 'pg';
export function createPool(connectionString: string) {
  const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    statement_timeout: 10000, application_name: 'property-foundation' });
  pool.on('error', error => { console.error('Database connection failed', { code: (error as Error & { code?: string }).code ?? 'UNKNOWN' }); });
  return pool;
}
