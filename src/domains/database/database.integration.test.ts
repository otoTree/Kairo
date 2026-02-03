import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { initDatabase, closeDatabase } from './client';
import { migrateToLatest } from './migrator';
import { EventRepository } from './repositories/event-repository';
import type { KairoEvent } from '../events/types';
import { randomUUID } from 'crypto';

describe('Database Domain Integration', () => {
  const testDbPath = ':memory:'; // Use in-memory DB for tests

  beforeAll(async () => {
    const db = initDatabase(testDbPath);
    await migrateToLatest(db);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('should save and retrieve an event', async () => {
    const repo = new EventRepository();
    
    const event: KairoEvent = {
      id: randomUUID(),
      type: 'test.event',
      source: 'test-suite',
      specversion: '1.0',
      time: new Date().toISOString(),
      data: { foo: 'bar' },
      correlationId: '123',
    };

    await repo.saveEvent(event);

    const events = await repo.getEvents({ type: 'test.event' });
    expect(events.length).toBe(1);
    
    const retrieved = events[0]!;
    expect(retrieved.id).toBe(event.id);
    expect(retrieved.type).toBe(event.type);
    expect(retrieved.data).toEqual(event.data);
    expect(retrieved.correlationId).toBe(event.correlationId);
  });
});
