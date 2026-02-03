import path from 'path';
import { KairoPlugin } from '../../core/plugin';
import { initDatabase, closeDatabase } from './client';
import { migrateToLatest } from './migrator';
import { sql } from 'kysely';

export const DatabasePlugin: KairoPlugin = {
  name: 'database-plugin',
  async init(app) {
    const dbPath = path.resolve(process.cwd(), 'kairo.db');
    console.log(`[Database] Initializing SQLite at ${dbPath}`);
    
    const db = initDatabase(dbPath);
    
    // Enable WAL mode for performance
    await sql`PRAGMA journal_mode = WAL`.execute(db);
    
    // Run migrations
    console.log('[Database] Running migrations...');
    await migrateToLatest(db);
    
    // Optional: Expose db instance on app context if types allow, 
    // but we prefer using getDatabase() from client.ts for type safety in other modules.
  },
  async cleanup() {
    console.log('[Database] Closing connection...');
    await closeDatabase();
  }
};
