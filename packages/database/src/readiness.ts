import type { Pool } from 'pg';

export async function isDatabaseReady(database: Pick<Pool, 'query'>): Promise<boolean> {
  // Advance this marker when a new migration becomes required by application code.
  // A reachable database or an empty ledger does not mean the application schema exists.
  const result = await database.query<{ ready: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = $1) AS ready',
    ['004_project_property_types.sql'],
  );
  return result.rows[0]?.ready === true;
}
