import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import worker from './attribution-worker.mjs';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(schema);
  return { sqlite, env: { DB: { prepare(sql) { return { bind(...values) { return { run() { return sqlite.prepare(sql).run(...values); } }; } }; } } } };
}
const body = { event: 'landing', source: 'google', utm_source: '', utm_medium: '', utm_campaign: '' };
function request(data = body, { headers = {}, cf = { country: 'US' }, method = 'POST', url = 'https://puul.ai/api/attribution' } = {}) {
  const req = new Request(url, { method, headers: { Origin: 'https://puul.ai', 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', ...headers }, ...(method === 'POST' ? { body: typeof data === 'string' ? data : JSON.stringify(data) } : {}) });
  Object.defineProperty(req, 'cf', { value: cf });
  return req;
}
test('real SQL aggregates counts, separates test data, and private report excludes tests', async () => {
  const { sqlite, env } = database();
  for (const data of [body, body, { ...body, event: 'email_click' }, { ...body, utm_campaign: 'verification' }]) assert.equal((await worker.fetch(request(data), env)).status, 204);
  const report = sqlite.prepare(readFileSync(new URL('./report.sql', import.meta.url), 'utf8')).all();
  assert.equal(report.length, 1);
  assert.equal(report[0].landings, 2);
  assert.equal(report[0].email_clicks, 1);
  assert.equal(sqlite.prepare('SELECT count FROM daily_counts WHERE is_test = 1').get().count, 1);
  assert.equal(sqlite.prepare('PRAGMA table_info(daily_counts)').all().length, 8);
});
test('rejects bad origins, metadata, methods, oversized and arbitrary fields without storing them', async () => {
  const { sqlite, env } = database();
  const cases = [
    [request(body, { headers: { Origin: 'https://attacker.example' } }), 403],
    [request(body, { headers: { 'Sec-Fetch-Site': 'cross-site' } }), 403],
    [request(body, { headers: { 'Content-Type': 'text/plain' } }), 415],
    [request(body, { method: 'GET' }), 405],
    [request(body, { url: 'https://puul.ai/api/attribution?secret=x' }), 404],
    [request({ ...body, email: 'never-store@example.com' }), 400],
    [request({ ...body, source: 'https://private.example/path?q=secret' }), 400],
    [request({ ...body, utm_campaign: 'arbitrary-sensitive-text' }), 400],
    [request('x'.repeat(513)), 413],
    [request('{'), 400],
    [request([]), 400],
    [request({ ...body, event: 'identify' }), 400]
  ];
  for (const [req, expected] of cases) assert.equal((await worker.fetch(req, env)).status, expected);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM daily_counts').get().n, 0);
});
test('excludes EU, unknown geography, privacy preferences and known bots', async () => {
  const { sqlite, env } = database();
  for (const options of [{ cf: { country: 'FR' } }, { cf: { country: 'US', isEUCountry: '1' } }, { cf: {} }, { cf: { country: 'XX' } }, { headers: { 'Sec-GPC': '1' } }, { headers: { DNT: '1' } }, { cf: { country: 'US', botManagement: { verifiedBot: true } } }]) assert.equal((await worker.fetch(request(body, options), env)).status, 204);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM daily_counts').get().n, 0);
});
test('atomic daily cap prevents aggregate growth after 5000 events', async () => {
  const { sqlite, env } = database();
  assert.equal((await worker.fetch(request(), env)).status, 204);
  sqlite.exec('UPDATE daily_counts SET count = 4999');
  await worker.fetch(request(), env);
  await worker.fetch(request({ ...body, event: 'email_click' }), env);
  assert.equal(sqlite.prepare('SELECT SUM(count) AS n FROM daily_counts').get().n, 5000);
});
const client = readFileSync(new URL('../attribution.js', import.meta.url), 'utf8');
function runClient({ referrer = '', search = '', hostname = 'puul.ai', privacy = false, fetchResult = () => Promise.resolve() } = {}) {
  const calls = [];
  let click;
  vm.runInNewContext(client, {
    location: { hostname, search }, navigator: { globalPrivacyControl: privacy },
    document: { referrer, querySelector() { return { addEventListener(_, fn) { click = fn; } }; } },
    URL, URLSearchParams, Set,
    fetch(url, options) { calls.push({ url, ...options, data: JSON.parse(options.body) }); return fetchResult(); }
  });
  return { calls, click };
}
test('client sends bounded labels only, marks verification, and leaves mailto default untouched', () => {
  const { calls, click } = runClient({ referrer: 'https://www.google.com/search?q=private-query', search: '?utm_source=google&utm_medium=organic&utm_campaign=verification&email=secret@example.com' });
  assert.equal(calls[0].data.source, 'google');
  assert.equal(calls[0].data.utm_campaign, 'verification');
  click({ isTrusted: true, preventDefault() { assert.fail('mailto intercepted'); } });
  click({ isTrusted: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].data.event, 'email_click');
  assert.equal(calls[1].keepalive, true);
  assert.equal(calls[1].credentials, 'omit');
  assert.equal(calls[1].referrerPolicy, 'origin');
  assert.equal(calls[1].url, '/api/attribution');
  assert.equal(JSON.stringify(calls).includes('private-query'), false);
  assert.equal(JSON.stringify(calls).includes('secret@example.com'), false);
});
test('client categories unknown referrals safely and honors privacy/hostname boundaries', () => {
  assert.equal(runClient({ referrer: 'https://private.internal/person', search: '?utm_source=someone@example.com' }).calls[0].data.source, 'other_referral');
  assert.equal(runClient({ search: '?utm_source=someone@example.com' }).calls[0].data.utm_source, '');
  assert.equal(runClient({ privacy: true }).calls.length, 0);
  assert.equal(runClient({ hostname: 'rtltasks.com' }).calls.length, 0);
  const { calls, click } = runClient();
  click({ isTrusted: false });
  assert.equal(calls.length, 1);
});
test('unavailable tracking never prevents the native email action or retries', async () => {
  for (const fetchResult of [() => Promise.reject(new TypeError('network unavailable')), () => { throw new TypeError('fetch unavailable'); }, () => Promise.resolve({ status: 404 }), () => Promise.resolve({ status: 503 })]) {
    const { calls, click } = runClient({ fetchResult });
    assert.equal(typeof click, 'function');
    assert.doesNotThrow(() => click({ isTrusted: true, preventDefault() { assert.fail('mailto intercepted'); } }));
    await new Promise(resolve => setImmediate(resolve));
    click({ isTrusted: true });
    assert.equal(calls.length, 2);
  }
});
