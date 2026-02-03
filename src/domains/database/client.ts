import { Database } from 'bun:sqlite';
import { Kysely } from 'kysely';
import { BunSqliteDialect } from 'kysely-bun-sqlite';
import type { Database as DatabaseType } from './types';

// Singleton instance
let dbInstance: Kysely<DatabaseType> | null = null;

export function getDatabase(): Kysely<DatabaseType> {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return dbInstance;
}

export function initDatabase(dbPath: string): Kysely<DatabaseType> {
  if (dbInstance) {
    return dbInstance;
  }

  const dialect = new BunSqliteDialect({
    database: new Database(dbPath),
  });

  dbInstance = new Kysely<DatabaseType>({
    dialect,
  });
  
  return dbInstance;
}

export async function closeDatabase() {
    if (dbInstance) {
        await dbInstance.destroy();
        dbInstance = null;
    }
}
