import path from 'path';
import type { Plugin } from '../../core/plugin';
import { initDatabase, closeDatabase } from './client';
import { migrateToLatest } from './migrator';
import { sql } from 'kysely';

export class DatabasePlugin implements Plugin {
  name = 'database-plugin';

  async setup(app: any) {
    const dbPath = process.env.SQLITE_DB_PATH 
      ? path.resolve(process.cwd(), process.env.SQLITE_DB_PATH)
      : path.resolve(process.cwd(), 'kairo.db');
    console.log(`[Database] Initializing SQLite at ${dbPath}`);
    
    const db = initDatabase(dbPath);
    
    // Enable WAL mode for performance
    await sql`PRAGMA journal_mode = WAL`.execute(db);
    
    // Run migrations
    console.log('[Database] Running migrations...');
    await migrateToLatest(db);
  }

  async stop() {
    console.log('[Database] Closing connection...');
    await closeDatabase();
  }
}
