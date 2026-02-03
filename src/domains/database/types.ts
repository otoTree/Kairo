import type { Generated } from 'kysely';

export interface EventsTable {
  id: string;
  type: string;
  source: string;
  payload: string; // JSON string
  metadata: string; // JSON string
  created_at: number;
}

export interface Database {
  events: EventsTable;
}
