import type { Generated } from 'kysely';

export interface EventsTable {
  id: string;
  type: string;
  source: string;
  payload: string; // JSON string
  metadata: string; // JSON string
  created_at: number;
}

export interface SystemStateTable {
  key: string;
  value: string;
  updated_at: number;
}

export interface CheckpointsTable {
  id: string;
  created_at: number;
  data: string;
}

export interface Database {
  events: EventsTable;
  system_state: SystemStateTable;
  checkpoints: CheckpointsTable;
}
