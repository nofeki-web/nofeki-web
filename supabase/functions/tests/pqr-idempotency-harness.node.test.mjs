// NOFEKI PQR idempotency contract harness (Node.js built-in test runner).
// Run from repository root: node --test supabase/functions/tests/pqr-idempotency-harness.node.test.mjs
// In-memory deterministic simulation only. Does NOT prove PostgreSQL concurrency,
// transaction behavior, RLS/ACL, Supabase Edge runtime, or Resend delivery.
// No external packages, network, secrets, Supabase, or real user data.

import test from "node:test";
import assert from "node:assert/strict";

class Mutex {
  tail = Promise.resolve();
  async run(fn) {
    let release;
    const previous = this.tail;
    this.tail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  }
}
class Store {
  lock = new Mutex();
  rows = new Map();
  async reserve(input) {
    return this.lock.run(() => {
      const old = this.rows.get(input.key);
      if (old) {
        if (old.hash !== input.hash || old.submission !== input.submission || old.kind !== input.kind)
          return "key_conflict";
        return old.status === "sent" ? "already_sent"
          : old.status === "uncertain" ? "uncertain"
          : old.status === "failed" ? "failed" : "in_progress";
      }
      this.rows.set(input.key, {...input, status:"reserved", attempts:0});
      return "claimed";
    });
  }
  async sending(key) {
    return this.lock.run(() => {
      const row=this.rows.get(key);
      if (!row || row.status!=="reserved") return false;
      row.status="sending"; row.attempts++; return true;
    });
  }
  async finish(key,status) {
    return this.lock.run(() => {
      const row=this.rows.get(key);
      if (!row || row.status!=="sending") return false;
      row.status=status; return true;
    });
  }
}
class Provider {
  calls=0; mode="accept";
  async send() {
    this.calls++;
    if(this.mode==="reject") throw Error("definitive_rejection");
    if(this.mode==="timeout") throw Error("ambiguous_timeout");
    return "fake-"+this.calls;
  }
}
async function dispatch(store,provider,input) {
  const decision=await store.reserve(input);
  if(decision!=="claimed") return decision;
  if(!await store.sending(input.key)) return "in_progress";
  try { await provider.send(); await store.finish(input.key,"sent"); return "sent"; }
  catch(e) {
    const status=e.message==="definitive_rejection"?"failed":"uncertain";
    await store.finish(input.key,status); return status;
  }
}
const input=(key,hash="a".repeat(64),extra={})=>({key,hash,submission:"submission-1",kind:"response",...extra});

test("50 concurrent identical requests claim and send exactly once", async()=>{
  const store=new Store(), provider=new Provider();
  const results=await Promise.all(Array.from({length:50},()=>dispatch(store,provider,input("race-1"))));
  assert.equal(results.filter(x=>x==="sent").length,1);
  assert.equal(provider.calls,1);
  assert.equal(store.rows.get("race-1").status,"sent");
});
test("same key with changed payload is rejected",async()=>{
  const store=new Store(),provider=new Provider();
  await dispatch(store,provider,input("conflict-1"));
  assert.equal(await dispatch(store,provider,input("conflict-1","b".repeat(64))),"key_conflict");
  assert.equal(provider.calls,1);
});
test("sent operation is terminal",async()=>{
  const store=new Store(),provider=new Provider(),data=input("sent-1");
  await dispatch(store,provider,data);
  assert.equal(await dispatch(store,provider,data),"already_sent");
  assert.equal(provider.calls,1);
});
test("ambiguous timeout blocks automatic retry",async()=>{
  const store=new Store(),provider=new Provider(),data=input("uncertain-1");
  provider.mode="timeout";
  assert.equal(await dispatch(store,provider,data),"uncertain");
  provider.mode="accept";
  assert.equal(await dispatch(store,provider,data),"uncertain");
  assert.equal(provider.calls,1);
});
test("definitive rejection cannot reuse same key",async()=>{
  const store=new Store(),provider=new Provider(),data=input("failed-1");
  provider.mode="reject";
  assert.equal(await dispatch(store,provider,data),"failed");
  provider.mode="accept";
  assert.equal(await dispatch(store,provider,data),"failed");
  assert.equal(provider.calls,1);
});
test("key is bound to submission and operation type",async()=>{
  const store=new Store(),data=input("scope-1");
  assert.equal(await store.reserve(data),"claimed");
  assert.equal(await store.reserve({...data,submission:"submission-2"}),"key_conflict");
  assert.equal(await store.reserve({...data,kind:"retry_notification"}),"key_conflict");
});
test("state machine disallows repeated sending and terminal mutation",async()=>{
  const store=new Store();
  await store.reserve(input("state-1"));
  assert.equal(await store.sending("state-1"),true);
  assert.equal(await store.sending("state-1"),false);
  assert.equal(await store.finish("state-1","sent"),true);
  assert.equal(await store.finish("state-1","failed"),false);
});
test("initial and internal notifications are independent operations",async()=>{
  const store=new Store();
  assert.equal(await store.reserve(input("mail-a","c".repeat(64),{kind:"initial_confirmation"})),"claimed");
  assert.equal(await store.reserve(input("mail-b","c".repeat(64),{kind:"internal_notification"})),"claimed");
  assert.equal(store.rows.size,2);
});
