import type { EventFilter, EventStore, KairoEvent } from "./types";

export class RingBufferEventStore implements EventStore {
  private buffer: KairoEvent[] = [];
  
  constructor(private capacity: number = 1000) {}

  async append(event: KairoEvent): Promise<void> {
    this.buffer.push(event);
    if (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }
  }

  async query(filter: EventFilter): Promise<KairoEvent[]> {
    let result = this.buffer;

    if (filter.fromTime) {
      result = result.filter(e => new Date(e.time).getTime() >= filter.fromTime!);
    }
    
    if (filter.toTime) {
      result = result.filter(e => new Date(e.time).getTime() <= filter.toTime!);
    }

    if (filter.types && filter.types.length > 0) {
      result = result.filter(e => filter.types!.includes(e.type));
    }

    if (filter.sources && filter.sources.length > 0) {
      result = result.filter(e => filter.sources!.includes(e.source));
    }

    if (filter.limit) {
      // Return the *last* N events if limit is specified? Or first N?
      // Usually for replay we want the most recent ones or chronological.
      // If we filter a range, we usually want chronological.
      // If we just ask for "last 10", we might need to slice from end.
      // But filter usually implies "search". Let's just slice from the beginning of the filtered result (oldest first).
      // If the user wants "last N", they might need to handle it or we add sort order.
      // For now, let's just take the first N of the filtered result.
      // Wait, if I want context, I usually want "recent events".
      // Let's assume standard behavior: return matches. Limit truncates result.
      result = result.slice(0, filter.limit);
    }

    return result;
  }
}
