// Leases a page holds on something costly while it shows it, such as fast polling of a running job while its log is
// open: each lease runs out unless renewed, so a tab closed without saying so stops the cost soon.

// ── Settings ─────────────────────────────────────────────────────────────────

export const default_lease_seconds = 30;

interface Lease {
  end: () => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── Leases ───────────────────────────────────────────────────────────────────

export class Leases {
  readonly seconds: number;
  private readonly leases = new Map<string, Lease>();
  private next_id = 1;

  constructor(seconds = default_lease_seconds) {
    this.seconds = seconds;
  }

  get size(): number {
    return this.leases.size;
  }

  // Starts a lease whose `end` runs once it is closed or runs out; its id starts with `prefix` when given.
  open(end: () => void, prefix = ""): string {
    const lease_id = prefix ? `${prefix}-${this.next_id++}` : String(this.next_id++);
    this.leases.set(lease_id, { end, timer: this.expiry(lease_id) });
    return lease_id;
  }

  // Keeps a lease going for another stretch; false when it has already ended.
  renew(lease_id: string): boolean {
    const lease = this.leases.get(lease_id);
    if (lease === undefined) return false;
    clearTimeout(lease.timer);
    lease.timer = this.expiry(lease_id);
    return true;
  }

  close(lease_id: string): void {
    const lease = this.leases.get(lease_id);
    if (lease === undefined) return;
    clearTimeout(lease.timer);
    this.leases.delete(lease_id);
    lease.end();
  }

  close_all(): void {
    for (const lease_id of this.leases.keys()) this.close(lease_id);
  }

  private expiry(lease_id: string): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => this.close(lease_id), this.seconds * 1000);
    timer.unref?.();
    return timer;
  }
}
