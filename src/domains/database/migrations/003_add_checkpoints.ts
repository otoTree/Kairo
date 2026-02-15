import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('checkpoints')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('data', 'text', (col) => col.notNull()) // JSON content
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('checkpoints').execute();
}
