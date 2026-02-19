import { getDatabase } from '../client';

export interface CheckpointData {
  processes: any[];
  devices: any[];
  eventLogOffset?: number;
}

export class CheckpointRepository {
  async save(id: string, data: CheckpointData) {
    const db = getDatabase();
    await db.insertInto('checkpoints')
      .values({
        id,
        created_at: Date.now(),
        data: JSON.stringify(data),
      })
      .execute();
  }

  async get(id: string): Promise<CheckpointData | null> {
    const db = getDatabase();
    const result = await db.selectFrom('checkpoints')
      .select('data')
      .where('id', '=', id)
      .executeTakeFirst();
    
    if (!result) return null;
    try {
      return JSON.parse(result.data);
    } catch (e) {
      console.error(`[CheckpointRepository] Failed to parse checkpoint ${id}:`, e);
      return null;
    }
  }

  async getLatest(): Promise<{ id: string; data: CheckpointData } | null> {
    const db = getDatabase();
    const result = await db.selectFrom('checkpoints')
      .select(['id', 'data'])
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (!result) return null;
    try {
      return {
          id: result.id,
          data: JSON.parse(result.data)
      };
    } catch (e) {
      console.error(`[CheckpointRepository] Failed to parse latest checkpoint:`, e);
      return null;
    }
  }
}
