// Runs each watched item's cycle on its own timer: every `interval`, or every `job_poll` while a long run is going.

// ── Shapes ───────────────────────────────────────────────────────────────────

// What the poller drives; every item needs an id no other item takes, so their timers never collide.
export interface Watched {
  readonly id: string;
  readonly settings: { interval: number; job_poll: number };
  cycle(options?: { force_eval?: boolean }): Promise<void>;
  busy(): boolean;
  // How soon a busy one is polled again, when sooner than its job_poll.
  poll_interval?(): number;
}

// Where a failing cycle is reported, such as Fastify's logger.
export interface PollerLog {
  error(details: { err: unknown; id: string }, message: string): void;
}

// ── Settings ─────────────────────────────────────────────────────────────────

// How soon an item is polled after an action, so a started job's output shows without waiting a whole interval.
const soon_in_seconds = 2;

// ── Poller ───────────────────────────────────────────────────────────────────

export class CyclePoller<Item extends Watched = Watched> {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly items: () => Iterable<Item>;
  private readonly log: PollerLog | null;
  private running = false;

  constructor(items: () => Iterable<Item>, log: PollerLog | null = null) {
    this.items = items;
    this.log = log;
  }

  start(): void {
    this.running = true;
    for (const item of this.items()) void this.tick(item);
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  // Runs a cycle now, as a person asking for fresh facts, and starts the timer over from it.
  async refresh(item: Item): Promise<void> {
    clearTimeout(this.timers.get(item.id));
    await this.tick(item, true);
  }

  // Polls soon after an action.
  soon(item: Item): void {
    this.schedule(item, soon_in_seconds);
  }

  private async tick(item: Item, force_eval = false): Promise<void> {
    try {
      await item.cycle({ force_eval });
    } catch (error) {
      this.log?.error({ err: error, id: item.id }, "Cycle failed");
    }
    this.schedule(item, item.busy() ? (item.poll_interval?.() ?? item.settings.job_poll) : item.settings.interval);
  }

  private schedule(item: Item, delay_in_seconds: number): void {
    if (!this.running) return;
    clearTimeout(this.timers.get(item.id));
    this.timers.set(item.id, setTimeout(() => void this.tick(item), delay_in_seconds * 1000));
  }
}
