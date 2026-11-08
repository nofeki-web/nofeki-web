// NOFEKI PQR idempotency harness — deterministic in-memory adapter tests.
// Run: deno test --allow-read supabase/functions/tests/pqr-idempotency-harness.test.ts
// This validates the proposed contract and failure behavior only.
// It does NOT prove PostgreSQL UNIQUE/transaction concurrency or production behavior.
// No network, Supabase, Resend, Turnstile, Storage, secrets, or real PQR data are used.

type Status = "reserved" | "sending" | "sent" | "failed" | "uncertain";
type Decision = "claimed" | "already_sent" | "in_progress" | "uncertain" | "key_conflict" | "failed";
type Operation = {
  key: string; submission: string; kind: string; hash: string;
  status: Status; attempts: number; providerId?: string;
};
type ReserveResult = { decision: Decision; operation: Operation };

class Mutex {
  private tail: Promise<void> = Promise.resolve();
  async run<T>(fn: () => T | Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  }
}

// Atomicity is simulated by one mutex. A real integration suite must replace
// this adapter with PostgreSQL and independent connections.
class FakeOperationStore {
  private readonly lock = new Mutex();
  readonly rows = new Map<string, Operation>();

  async reserve(input: {key:string; submission:string; kind:string; hash:string}): Promise<ReserveResult> {
    return this.lock.run(() => {
      const existing = this.rows.get(input.key);
      if (existing) {
        if (existing.hash !== input.hash || existing.submission !== input.submission || existing.kind !== input.kind)
          return {decision:"key_conflict", operation:existing};
        const decision: Decision = existing.status === "sent" ? "already_sent"
          : existing.status === "uncertain" ? "uncertain"
          : existing.status === "failed" ? "failed" : "in_progress";
        return {decision, operation:existing};
      }
      const operation: Operation = {...input, status:"reserved", attempts:0};
      this.rows.set(input.key, operation);
      return {decision:"claimed", operation};
    });
  }

  async markSending(key:string): Promise<boolean> {
    return this.lock.run(() => {
      const op=this.rows.get(key);
      if (!op || op.status!=="reserved") return false;
      op.status="sending"; op.attempts++; return true;
    });
  }

  async finish(key:string, outcome:"sent"|"failed"|"uncertain", providerId?:string): Promise<boolean> {
    return this.lock.run(() => {
      const op=this.rows.get(key);
      if (!op || op.status!=="sending") return false;
      op.status=outcome;
      if (outcome==="sent") op.providerId=providerId;
      return true;
    });
  }
}

class FakeProvider {
  calls=0;
  mode:"accept"|"reject"|"timeout"="accept";
  async send():Promise<string> {
    this.calls++;
    if(this.mode==="reject") throw new Error("definitive_rejection");
    if(this.mode==="timeout") throw new Error("ambiguous_timeout");
    return "fake-message-"+this.calls;
  }
}

async function dispatch(store:FakeOperationStore, provider:FakeProvider, input:{key:string;submission:string;kind:string;hash:string}) {
  const reserved=await store.reserve(input);
  if(reserved.decision!=="claimed") return reserved.decision;
  if(!await store.markSending(input.key)) return "in_progress";
  try {
    const providerId=await provider.send();
    await store.finish(input.key,"sent",providerId);
    return "sent";
  } catch(error) {
    const message=error instanceof Error ? error.message : String(error);
    await store.finish(input.key,message==="definitive_rejection"?"failed":"uncertain");
    return message==="definitive_rejection"?"failed":"uncertain";
  }
}

Deno.test("50 concurrent identical requests claim once and call provider once", async () => {
  const store=new FakeOperationStore(), provider=new FakeProvider();
  const input={key:"k-1",submission:"s-1",kind:"response",hash:"a".repeat(64)};
  const results=await Promise.all(Array.from({length:50},()=>dispatch(store,provider,input)));
  if(results.filter(x=>x==="sent").length!==1) throw new Error("expected one successful send");
  if(provider.calls!==1) throw new Error("provider must be called exactly once");
  if(store.rows.get("k-1")?.status!=="sent") throw new Error("operation must end sent");
});

Deno.test("same key with changed payload conflicts and never sends twice", async () => {
  const store=new FakeOperationStore(), provider=new FakeProvider();
  const first={key:"k-2",submission:"s-1",kind:"response",hash:"b".repeat(64)};
  await dispatch(store,provider,first);
  const result=await dispatch(store,provider,{...first,hash:"c".repeat(64)});
  if(result!=="key_conflict" || provider.calls!==1) throw new Error("payload conflict was not blocked");
});

Deno.test("already sent operation is terminal", async () => {
  const store=new FakeOperationStore(), provider=new FakeProvider();
  const input={key:"k-3",submission:"s-1",kind:"response",hash:"d".repeat(64)};
  await dispatch(store,provider,input);
  const result=await dispatch(store,provider,input);
  if(result!=="already_sent" || provider.calls!==1) throw new Error("sent operation was resent");
});

Deno.test("ambiguous timeout becomes uncertain and blocks automatic retry", async () => {
  const store=new FakeOperationStore(), provider=new FakeProvider();
  provider.mode="timeout";
  const input={key:"k-4",submission:"s-1",kind:"response",hash:"e".repeat(64)};
  const first=await dispatch(store,provider,input);
  provider.mode="accept";
  const second=await dispatch(store,provider,input);
  if(first!=="uncertain" || second!=="uncertain" || provider.calls!==1)
    throw new Error("uncertain operation must block retry");
});

Deno.test("definitive provider rejection is failed and same key is not reused", async () => {
  const store=new FakeOperationStore(), provider=new FakeProvider();
  provider.mode="reject";
  const input={key:"k-5",submission:"s-1",kind:"response",hash:"f".repeat(64)};
  const first=await dispatch(store,provider,input);
  provider.mode="accept";
  const second=await dispatch(store,provider,input);
  if(first!=="failed" || second!=="failed" || provider.calls!==1)
    throw new Error("failed operation must not be retried with same key");
});

Deno.test("same key cannot cross submission or operation type", async () => {
  const store=new FakeOperationStore();
  const input={key:"k-6",submission:"s-1",kind:"response",hash:"1".repeat(64)};
  await store.reserve(input);
  const crossSubmission=await store.reserve({...input,submission:"s-2"});
  const crossKind=await store.reserve({...input,kind:"retry_notification"});
  if(crossSubmission.decision!=="key_conflict" || crossKind.decision!=="key_conflict")
    throw new Error("idempotency key escaped its operation scope");
});

Deno.test("state transition cannot send twice", async () => {
  const store=new FakeOperationStore();
  await store.reserve({key:"k-7",submission:"s-1",kind:"response",hash:"2".repeat(64)});
  if(!await store.markSending("k-7")) throw new Error("first transition should succeed");
  if(await store.markSending("k-7")) throw new Error("second transition must fail");
  if(!await store.finish("k-7","sent","fake-7")) throw new Error("finish should succeed");
  if(await store.finish("k-7","failed")) throw new Error("sent must be terminal");
});

Deno.test("separate notification types use separate idempotency operations", async () => {
  const store=new FakeOperationStore();
  const base={submission:"s-1",hash:"3".repeat(64)};
  const a=await store.reserve({...base,key:"k-8a",kind:"initial_confirmation"});
  const b=await store.reserve({...base,key:"k-8b",kind:"internal_notification"});
  if(a.decision!=="claimed" || b.decision!=="claimed" || store.rows.size!==2)
    throw new Error("independent email operations must reserve independently");
});

// TODO for isolated PostgreSQL suite:
// - Replace FakeOperationStore with RPC calls against ephemeral Postgres.
// - Use >=2 independent DB connections and a UNIQUE(idempotency_key) constraint.
// - Prove 50 concurrent inserts yield one claimed row.
// - Inject failures between provider acceptance and DB finalization.
// - Verify RLS, grants, transaction rollback for submission status + pqr_events.
// Passing this file is not evidence of those database-level guarantees.
