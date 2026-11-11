import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createVotesHandler } from '../netlify/functions/votes.mjs';

const voterId = '12345678-1234-4234-8234-123456789abc';
const post = (body) => new Request('https://example.test/api/votes', {
  method: 'POST', body: JSON.stringify(body),
});
function database() {
  const rows = new Map();
  return {
    insert: () => ({ values: (vote) => ({ onConflictDoUpdate: async () => {
      rows.set(vote.voterId, vote.team);
    } }) }),
    select: () => ({ from: async () => [{
      boy: [...rows.values()].filter(team => team === 'boy').length,
      girl: [...rows.values()].filter(team => team === 'girl').length,
    }] }),
  };
}

test('empty counts, retries, team changes, and concurrent guests', async () => {
  const db = database();
  const handler = createVotesHandler(() => db);
  const initial = await handler(new Request('https://example.test/api/votes'));
  assert.equal(initial.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await initial.json()).votes, { boy: 0, girl: 0 });
  await handler(post({ voterId, team: 'boy' }));
  const retry = await handler(post({ voterId, team: 'boy' }));
  assert.equal((await retry.json()).total, 1);
  const change = await handler(post({ voterId, team: 'girl', previousTeam: 'boy' }));
  assert.deepEqual((await change.json()).votes, { boy: 0, girl: 1 });
  await Promise.all(Array.from({ length: 20 }, (_, i) => handler(post({
    voterId: `12345678-1234-4234-8234-${String(i).padStart(12, '0')}`, team: 'boy',
  }))));
  const final = await handler(new Request('https://example.test/api/votes'));
  assert.deepEqual((await final.json()).votes, { boy: 20, girl: 1 });
});

test('invalid requests never connect to the database', async () => {
  const handler = createVotesHandler(() => { throw new Error('unexpected connection'); });
  for (const body of [null, {}, { team: 'other', voterId }, { team: 'boy' }]) {
    assert.equal((await handler(post(body))).status, 400);
  }
  assert.equal((await handler(new Request('https://example.test', { method: 'POST', body: '{' }))).status, 400);
  assert.equal((await handler(new Request('https://example.test', { method: 'DELETE' }))).status, 405);
});

test('database failures return a safe error', async () => {
  const handler = createVotesHandler(() => { throw new Error('private connection details'); });
  const response = await handler(new Request('https://example.test/api/votes'));
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('private connection details'));
});

function browser(fetch) {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const source = html.slice(html.indexOf('        let votes ='), html.indexOf('        // CONFIRMACIÓN DE ASISTENCIA'));
  const elements = new Map();
  const storage = new Map();
  const context = vm.createContext({
    fetch, AbortSignal, crypto: { randomUUID: () => voterId },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (k, v) => storage.set(k, v) },
    document: { getElementById: id => {
      if (!elements.has(id)) elements.set(id, { style: {}, classList: { add() {}, remove() {} } });
      return elements.get(id);
    } },
    setInterval() {}, triggerConfetti() {},
  });
  vm.runInContext(source, context);
  return { context, elements, storage };
}
const totals = (boy, girl) => Response.json({ success: true, votes: { boy, girl } });

test('failed POST keeps confirmed totals and selection, enables retry', async () => {
  const page = browser(async (_url, options) => options?.method === 'POST'
    ? Response.json({ error: 'offline' }, { status: 503 }) : totals(3, 2));
  await new Promise(resolve => setImmediate(resolve));
  await vm.runInContext("castVote('boy')", page.context);
  assert.equal(page.elements.get('boyCount').innerText, 3);
  assert.equal(page.storage.has('genderRevealConfirmedTeam'), false);
  assert.equal(page.elements.get('btnVoteBoy').disabled, false);
  assert.match(page.elements.get('voteStatus').textContent, /reintentar/);
});

test('failed polling preserves the last confirmed total', async () => {
  let offline = false;
  const page = browser(async () => { if (offline) throw Error('offline'); return totals(8, 5); });
  await new Promise(resolve => setImmediate(resolve));
  offline = true;
  await vm.runInContext('fetchNetlifyVotes()', page.context);
  assert.equal(page.elements.get('boyCount').innerText, 8);
  assert.equal(page.elements.get('girlCount').innerText, 5);
});

test('confirmed POST sends a stable ID and stores the confirmed team', async () => {
  let body;
  const page = browser(async (_url, options) => {
    if (options?.method === 'POST') { body = JSON.parse(options.body); return totals(1, 0); }
    return totals(0, 0);
  });
  await new Promise(resolve => setImmediate(resolve));
  await vm.runInContext("castVote('boy')", page.context);
  assert.deepEqual(body, { team: 'boy', voterId });
  assert.equal(page.storage.get('genderRevealConfirmedTeam'), 'boy');
  assert.equal(page.elements.get('boyCount').innerText, 1);
});
