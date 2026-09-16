import { randomUUID } from "node:crypto";
import type { Evidence } from "../storage/audit.js";
import type { Settings } from "../openclaw/config.js";
import { Outbox } from "./outbox.js";
import { initialState, isTerminal, render, transition, type SemanticEvent, type TaskState } from "./state.js";
import type { StoredTask, TaskStore } from "../storage/task-store.js";
import { TransportError, type MessageTransport, type Route } from "../telegram/transport.js";
import { cleanProgress, type Preferences } from "../telegram/presentation.js";

export interface Inbound { route: Route; sessionKey: string; inboundId: string; runId?: string }
export interface Identity { runId?: string; sessionKey?: string; route?: Partial<Route> }
interface Task extends StoredTask {
  state: TaskState; lastText?: string | null; lastSeq: number; attempts: number; finalIntent: boolean; finishedAt?: number;
}
export type AuditWriter = (event: Evidence) => void;

const laneOf = (r: Route) => JSON.stringify([r.accountId, r.chatId]);
const conversationOf = (r: Route, session: string) => JSON.stringify([r.accountId, r.chatId, r.threadId ?? null, session]);
const matchesRoute = (r: Route, route?: Partial<Route>) => !route ||
  ((!route.accountId || route.accountId === r.accountId) && (!route.chatId || route.chatId === r.chatId)
    && (route.threadId === undefined || route.threadId === r.threadId));

export class Controller {
  private tasks = new Map<string, Task>();
  private seenInbound = new Map<string, number>();
  private outbox: Outbox;
  private accepting = false;
  private sweeper?: ReturnType<typeof setInterval>;
  private failures = 0;
  private progressCalls = new Map<string, string>();
  private childOwners = new Map<string, { taskId: string; sessionKey: string }>();
  private pendingActions = new Set<(error: Error) => void>();
  constructor(private readonly settings: Settings, private readonly transport: MessageTransport, private readonly store: TaskStore, private readonly audit: AuditWriter, private readonly preferences?: (route: Route) => Preferences) {
    this.outbox = new Outbox(settings.editIntervalMs);
  }

  async start(): Promise<void> {
    for (const stored of await this.store.load()) {
      if (stored.route.accountId !== this.settings.accountId || !this.settings.allowedChatIds.includes(stored.route.chatId)) continue;
      const task: Task = { ...stored, state: { ...initialState(), phase: stored.phase }, lastSeq: 0, attempts: 0, finalIntent: false };
      this.tasks.set(task.id, task);
      this.seenInbound.set(this.inboundKey(task), task.createdAt);
      for (const inboundId of task.inboundIds ?? []) this.seenInbound.set(this.inboundKey({ ...task, inboundId }), task.createdAt);
      if (!isTerminal(task.phase)) {
        task.state = transition(task.state, { type: "orphan" });
        task.phase = task.state.phase; task.settled = false;
      }
      // Never resend an uncertain create on restart, and never resume an old run.
      if (task.messageId !== undefined && !task.settled) { task.sendState = "sent"; this.schedule(task); }
      else if (!task.messageId) { task.sendState = "muted"; task.settled = true; }
    }
    this.save();
    this.accepting = true;
    this.sweeper = setInterval(() => this.sweep(), 5_000);
    this.sweeper.unref?.();
  }

  private inboundKey(r: Inbound): string { return `${conversationOf(r.route, r.sessionKey)}:${r.inboundId}`; }
  private display(t: Task): string | null {
    const prefs = this.preferences?.(t.route);
    return render(t.state, prefs && { ...prefs, elapsedMs: Date.now() - t.createdAt, idleMs: Date.now() - t.updatedAt });
  }
  private log(event: string, t: Task, extra: Partial<Evidence> = {}): void {
    this.audit({ event, sessionKey: t.sessionKey, runId: t.runId, ...t.route, inboundId: t.inboundId, messageId: t.messageId, phase: t.phase, ...extra });
  }
  private save(): void {
    this.store.save([...this.tasks.values()].map(t => ({
      id: t.id, route: t.route, sessionKey: t.sessionKey, inboundId: t.inboundId, runId: t.runId,
      inboundIds: t.inboundIds,
      messageId: t.messageId, phase: t.phase, createdAt: t.createdAt, updatedAt: t.updatedAt, sendState: t.sendState, settled: t.settled,
    })));
  }

  receive(inbound: Inbound): void {
    if (!this.accepting || inbound.route.accountId !== this.settings.accountId || !this.settings.allowedChatIds.includes(inbound.route.chatId)) return;
    const key = this.inboundKey(inbound);
    if (this.seenInbound.has(key)) return;
    this.seenInbound.set(key, Date.now());
    const same = [...this.tasks.values()].filter(t => !isTerminal(t.phase) && !t.state.ended && conversationOf(t.route, t.sessionKey) === conversationOf(inbound.route, inbound.sessionKey));
    if (same.length === 1 && (!inbound.runId || !same[0]!.runId || inbound.runId === same[0]!.runId)) {
      const t = same[0]!;
      t.inboundIds = [...(t.inboundIds ?? []), inbound.inboundId].slice(-128);
      this.log("supplement_received", t, { inboundId: inbound.inboundId });
      this.apply(t, { type: "supplement" }); this.save(); return;
    }
    if (same.length) { this.audit({ event: "ambiguous_inbound_skipped" }); return; }
    const task: Task = {
      ...inbound, id: randomUUID(), phase: "received", state: initialState(), createdAt: Date.now(), updatedAt: Date.now(),
      sendState: "new", settled: false, lastSeq: 0, attempts: 0, finalIntent: false,
    };
    this.tasks.set(task.id, task);
    this.log("received", task);
    this.save(); this.schedule(task);
  }

  private resolve(identity: Identity, bind = false): Task | undefined {
    const all = [...this.tasks.values()];
    if (identity.runId) {
      const exact = all.filter(t => t.runId === identity.runId && (!identity.sessionKey || t.sessionKey === identity.sessionKey) && matchesRoute(t.route, identity.route));
      if (exact.length === 1) return exact[0];
      if (all.some(t => t.runId === identity.runId)) return;
      if (!bind || !identity.sessionKey) return;
      const pending = all.filter(t => !t.runId && !isTerminal(t.phase) && t.sessionKey === identity.sessionKey && matchesRoute(t.route, identity.route));
      if (pending.length !== 1) return;
      pending[0]!.runId = identity.runId;
      this.log("run_bound", pending[0]!); this.save();
      return pending[0];
    }
    if (!identity.sessionKey) return;
    const candidates = all.filter(t => !isTerminal(t.phase) && t.sessionKey === identity.sessionKey && matchesRoute(t.route, identity.route));
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  event(identity: Identity, event: SemanticEvent, options: { bind?: boolean; seq?: number } = {}): void {
    if (!this.accepting) return;
    const t = this.resolve(identity, options.bind);
    if (!t || isTerminal(t.phase)) return;
    if (options.seq !== undefined) {
      if (options.seq <= t.lastSeq) return;
      t.lastSeq = options.seq;
    }
    this.apply(t, event);
  }

  trackProgressCall(identity: Identity, callId: string): void {
    if (!this.accepting || !identity.runId) return;
    const t = this.resolve(identity);
    if (!t || t.state.ended || isTerminal(t.phase)) return;
    const previous = this.progressCalls.get(callId);
    // A reused call id is never re-bound to a later task.
    if (previous && previous !== t.id) { this.progressCalls.set(callId, "invalid"); return; }
    if (!previous && this.progressCalls.size >= 10_000) return;
    this.progressCalls.set(callId, t.id);
  }

  progressFromTool(callId: string, identity: Identity, value: unknown): boolean {
    if (!this.accepting || !identity.sessionKey || !identity.route?.chatId || !identity.route.accountId) return false;
    const owner = this.progressCalls.get(callId);
    const t = owner ? this.tasks.get(owner) : undefined;
    const text = cleanProgress(value);
    if (!t || !text || t.state.ended || isTerminal(t.phase) || t.sessionKey !== identity.sessionKey || !matchesRoute(t.route, identity.route)) return false;
    this.progressCalls.set(callId, "closed");
    this.apply(t, { type: "progress", text });
    return true;
  }

  childStarted(parent: Identity & { inboundId?: string }, child: { runId: string; sessionKey: string }): void {
    if (!this.accepting || this.childOwners.has(child.runId)) return;
    const candidates = [...this.tasks.values()].filter(t => !isTerminal(t.phase) && !t.state.ended
      && matchesRoute(t.route, parent.route) && (!parent.sessionKey || parent.sessionKey === t.sessionKey)
      && (!parent.inboundId || t.inboundId === parent.inboundId || t.inboundIds?.includes(parent.inboundId)));
    if ((!parent.sessionKey && !(parent.route?.chatId && parent.inboundId)) || candidates.length !== 1) return;
    const t = candidates[0]!;
    this.childOwners.set(child.runId, { taskId: t.id, sessionKey: child.sessionKey });
    this.apply(t, { type: "child_start", id: child.runId });
  }

  childEnded(child: { runId?: string; sessionKey: string }, outcome: "ok" | "error" | "timeout" | "killed" | "unknown"): void {
    if (!this.accepting) return;
    const owners = [...this.childOwners].filter(([runId, owner]) => (!child.runId || child.runId === runId) && child.sessionKey === owner.sessionKey);
    if (owners.length !== 1) return;
    const [runId, owner] = owners[0]!;
    const t = this.tasks.get(owner.taskId);
    if (!t || isTerminal(t.phase) || t.state.children[runId] !== "running") return;
    this.apply(t, { type: "child_end", id: runId, outcome });
  }

  view(route: Route, sessionKey?: string): { active: number; generation?: string; ready: boolean } {
    const candidates = [...this.tasks.values()].filter(t => matchesRoute(t.route, route) && (!sessionKey || t.sessionKey === sessionKey));
    return { active: candidates.filter(t => !isTerminal(t.phase)).length, generation: candidates.at(-1)?.id, ready: this.accepting };
  }

  refresh(route: Route): void {
    for (const t of this.tasks.values()) if (matchesRoute(t.route, route) && !isTerminal(t.phase)) this.schedule(t);
  }

  preferencesForSession(sessionKey: string): Preferences | undefined {
    const t = this.resolve({ sessionKey });
    return t && !t.state.ended ? this.preferences?.(t.route) : undefined;
  }

  dispatch<T>(route: Route, work: () => Promise<T>): Promise<T> {
    if (!this.accepting) return Promise.reject(new Error("tgux_not_ready"));
    return new Promise<T>((resolve, reject) => {
      this.pendingActions.add(reject);
      this.outbox.enqueue(laneOf(route), `action:${randomUUID()}`, async () => {
        try { if (!this.accepting) throw new Error("tgux_not_ready"); resolve(await work()); }
        catch (error) {
          if (error instanceof TransportError && error.kind === "rate_limit") this.outbox.pause(error.retryAfterMs);
          reject(new Error("tgux_action_unavailable"));
        }
        finally { this.pendingActions.delete(reject); }
      });
    });
  }

  finalIntent(identity: Identity): void { const t = this.resolve(identity); if (t) t.finalIntent = true; }

  delivered(identity: Identity, success: boolean, messageId?: number): void {
    if (!this.accepting) return;
    const t = this.resolve(identity);
    if (!t || isTerminal(t.phase)) return;
    this.log("native_delivery", t, { success, messageId });
    this.apply(t, { type: "delivered", success, final: t.state.ended || t.finalIntent });
  }

  private apply(t: Task, event: SemanticEvent): void {
    const before = this.display(t);
    t.state = transition(t.state, event);
    t.phase = t.state.phase;
    t.updatedAt = Date.now();
    if (event.type === "finish" && event.result === "success") t.finishedAt ??= Date.now();
    if (event.type === "child_end" && t.state.ended) t.finishedAt = Date.now();
    if (isTerminal(t.phase)) for (const [callId, owner] of this.progressCalls) if (owner === t.id) this.progressCalls.set(callId, "closed");
    if (before !== this.display(t) || ["finish", "progress", "child_start", "child_end", "compaction"].includes(event.type)) {
      this.log(event.type, t);
      this.save(); this.schedule(t);
    }
  }

  private schedule(t: Task): void {
    if (t.sendState === "muted" || t.settled) return;
    this.outbox.enqueue(laneOf(t.route), t.id, () => this.publish(t));
  }

  private async publish(t: Task): Promise<void> {
    const text = this.display(t);
    const phase = t.phase;
    if (t.settled || t.sendState === "muted") return;
    try {
      if (t.messageId === undefined) {
        if (t.sendState !== "new") return;
        if (isTerminal(t.phase)) { t.settled = true; this.save(); return; }
        t.sendState = "attempted";
        this.save(); await this.store.flush();
        // Persist intent before sending; never replay an uncertain send after a crash.
        t.messageId = await this.transport.create(t.route, text!);
        t.sendState = "sent"; t.lastText = text;
        this.log("created", t, { phase });
        this.save(); await this.store.flush();
        if (this.display(t) !== text) this.schedule(t);
      } else if (text !== t.lastText) {
        if (text === null) { await this.transport.delete(t.route, t.messageId); this.log("deleted", t, { phase }); }
        else { await this.transport.edit(t.route, t.messageId, text); this.log("edited", t, { phase }); }
        t.lastText = text;
        if (this.display(t) !== text) this.schedule(t);
        else if (isTerminal(t.phase)) t.settled = true;
        t.attempts = 0;
        this.save();
      }
    } catch (error) {
      const kind = error instanceof TransportError ? error.kind : "storage";
      this.failures++; t.attempts++;
      this.log("transport_error", t, { kind: error instanceof TransportError && error.networkCode ? `${kind}/${error.networkCode}` : kind });
      if (kind === "unchanged") {
        t.lastText = text;
        if (isTerminal(t.phase) && this.display(t) === text) t.settled = true;
        else if (this.display(t) !== text) this.schedule(t);
      } else if (kind === "gone") { t.sendState = "muted"; t.settled = true; }
      else if (error instanceof TransportError && (kind === "rate_limit" || kind === "connect_failed") && t.attempts < 4) {
        if (t.messageId === undefined) t.sendState = "new";
        this.outbox.pause(error.retryAfterMs); this.schedule(t);
      } else if (kind === "uncertain" && t.messageId !== undefined && t.attempts < 3) {
        this.outbox.pause(t.attempts * 2_000); this.schedule(t);
      } else {
        // An uncertain create has no recoverable id; no automatic duplicate bubble.
        t.sendState = "muted";
        if (t.messageId === undefined) t.settled = true;
      }
      this.save();
    }
  }

  cleanup(identity: Identity = {}): void {
    for (const t of this.tasks.values()) {
      if ((!identity.sessionKey || t.sessionKey === identity.sessionKey) && (!identity.runId || t.runId === identity.runId) && !isTerminal(t.phase)) this.apply(t, { type: "orphan" });
    }
  }

  sweep(now = Date.now()): void {
    for (const t of this.tasks.values()) {
      // Some native media paths emit a successful lifecycle end but no
      // message_sent hook. Close only that proven successful run after a grace
      // window; do not infer delivery, associate another run, or resend content.
      if (!isTerminal(t.phase) && t.state.ended && !Object.values(t.state.children).includes("running") && t.finishedAt !== undefined && now - t.finishedAt >= 5_000) this.apply(t, { type: "close_success" });
      if (!isTerminal(t.phase) && now - t.updatedAt > this.settings.statusTimeoutMs) this.apply(t, { type: "timeout" });
      if (!isTerminal(t.phase) && this.display(t) !== t.lastText) this.schedule(t);
      if (isTerminal(t.phase) && t.settled && now - t.updatedAt > 86_400_000) this.tasks.delete(t.id);
    }
    for (const [key, owner] of this.childOwners) if (!this.tasks.has(owner.taskId)) this.childOwners.delete(key);
    for (const [key, at] of this.seenInbound) if (now - at > 86_400_000) this.seenInbound.delete(key);
  }

  status(): { active: number; failures: number; ready: boolean } {
    return { active: [...this.tasks.values()].filter(t => !isTerminal(t.phase)).length, failures: this.failures, ready: this.accepting };
  }
  async stop(): Promise<void> {
    this.accepting = false; clearInterval(this.sweeper);
    this.cleanup(); await this.outbox.drain(); this.outbox.halt(); await this.store.flush();
    for (const reject of this.pendingActions) reject(new Error("tgux_not_ready"));
    this.pendingActions.clear(); this.progressCalls.clear(); this.childOwners.clear();
  }
  async idle(timeoutMs?: number): Promise<void> { await this.outbox.drain(timeoutMs); await this.store.flush(); }
}
