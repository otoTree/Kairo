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
    
    // Run migrations（打包后迁移文件可能不可用，降级为直接建表）
    console.log('[Database] Running migrations...');
    try {
      await migrateToLatest(db);
    } catch (e: any) {
      console.warn('[Database] 文件迁移不可用，使用内联建表:', e?.message);
      await this.ensureTables(db);
    }
  }

  // 内联建表：打包环境中 FileMigrationProvider 无法扫描迁移目录
  private async ensureTables(db: any) {
    await sql`CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, source TEXT NOT NULL,
      payload TEXT NOT NULL, metadata TEXT NOT NULL, created_at INTEGER NOT NULL
    )`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_events_type ON events(type)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at)`.execute(db);
    await sql`CREATE TABLE IF NOT EXISTS system_state (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL
    )`.execute(db);
    await sql`CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, data TEXT NOT NULL
    )`.execute(db);
    console.log('[Database] 内联建表完成');
  }

  async stop() {
    console.log('[Database] Closing connection...');
    await closeDatabase();
  }
}
