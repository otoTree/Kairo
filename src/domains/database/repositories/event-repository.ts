import type { KairoEvent } from '../../events/types';
import { getDatabase } from '../client';
import { randomUUID } from 'crypto';

export class EventRepository {
  async saveEvent(event: KairoEvent) {
    const db = getDatabase();
    
    // Extract standard fields
    const { id, type, source, data, ...meta } = event;
    
    await db.insertInto('events')
      .values({
        id: id || randomUUID(),
        type,
        source,
        payload: JSON.stringify(data),
        metadata: JSON.stringify(meta), // Store correlationId, causationId, time, specversion here
        created_at: new Date(event.time).getTime(),
      })
      .execute();
  }
  
  async getEvents(options: { limit?: number; type?: string } = {}) {
      const db = getDatabase();
      let query = db.selectFrom('events').selectAll().orderBy('created_at', 'desc');
      
      if (options.type) {
          query = query.where('type', '=', options.type);
      }
      
      if (options.limit) {
          query = query.limit(options.limit);
      }
      
      const rows = await query.execute();
      
      return rows.map(row => {
          const meta = JSON.parse(row.metadata);
          return {
              id: row.id,
              type: row.type,
              source: row.source,
              data: JSON.parse(row.payload),
              ...meta,
              // Ensure time is preserved from metadata if present, or reconstruct from created_at
              time: meta.time || new Date(row.created_at).toISOString(),
          } as KairoEvent;
      });
  }
}
