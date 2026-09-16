type Job = () => Promise<void>;
type Lane = { jobs: Map<string, Job>; running: boolean; timer?: ReturnType<typeof setTimeout>; nextAt: number };

/** One serialized lane per account/chat, with replacement of pending work by task id. */
export class Outbox {
  private lanes = new Map<string, Lane>();
  private stopped = false;
  private globalUntil = 0;
  constructor(private readonly intervalMs: number) {}

  enqueue(laneId: string, id: string, job: Job): void {
    if (this.stopped) return;
    let lane = this.lanes.get(laneId);
    if (!lane) { lane = { jobs: new Map(), running: false, nextAt: 0 }; this.lanes.set(laneId, lane); }
    lane.jobs.set(id, job);
    this.pump(lane);
  }

  pause(ms: number): void { this.globalUntil = Math.max(this.globalUntil, Date.now() + ms); }

  private pump(lane: Lane): void {
    if (this.stopped || lane.running || lane.timer || !lane.jobs.size) return;
    const delay = Math.max(lane.nextAt, this.globalUntil) - Date.now();
    if (delay > 0) {
      lane.timer = setTimeout(() => { lane.timer = undefined; this.pump(lane); }, delay);
      lane.timer.unref?.(); return;
    }
    const [id, job] = lane.jobs.entries().next().value!;
    lane.jobs.delete(id);
    lane.running = true;
    void job().catch(() => { /* Individual tasks report bounded failures themselves. */ }).finally(() => {
      lane.running = false;
      lane.nextAt = Date.now() + this.intervalMs;
      this.pump(lane);
    });
  }

  get pending(): number { return [...this.lanes.values()].reduce((sum, l) => sum + l.jobs.size + Number(l.running), 0); }

  async drain(timeoutMs = 12_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.pending && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  }

  halt(): void {
    this.stopped = true;
    for (const lane of this.lanes.values()) { clearTimeout(lane.timer); lane.jobs.clear(); }
  }
}
