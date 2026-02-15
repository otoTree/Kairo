import { getDatabase } from '../client';

export class StateRepository {
  async save(key: string, value: any) {
    const db = getDatabase();
    await db.insertInto('system_state')
      .values({
        key,
        value: JSON.stringify(value),
        updated_at: Date.now(),
      })
      .onConflict((oc) => oc
        .column('key')
        .doUpdateSet({
          value: JSON.stringify(value),
          updated_at: Date.now(),
        })
      )
      .execute();
  }

  async get<T>(key: string): Promise<T | null> {
    const db = getDatabase();
    const result = await db.selectFrom('system_state')
      .select('value')
      .where('key', '=', key)
      .executeTakeFirst();
    
    if (!result) return null;
    return JSON.parse(result.value);
  }

  async getByPrefix<T>(prefix: string): Promise<{ key: string; value: T }[]> {
    const db = getDatabase();
    const results = await db.selectFrom('system_state')
      .select(['key', 'value'])
      .where('key', 'like', `${prefix}%`)
      .execute();
    
    return results.map(row => ({
      key: row.key,
      value: JSON.parse(row.value),
    }));
  }

  async delete(key: string) {
    const db = getDatabase();
    await db.deleteFrom('system_state')
      .where('key', '=', key)
      .execute();
  }

  async deleteByPrefix(prefix: string) {
    const db = getDatabase();
    await db.deleteFrom('system_state')
      .where('key', 'like', `${prefix}%`)
      .execute();
  }
}
