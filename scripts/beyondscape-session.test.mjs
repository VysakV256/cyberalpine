import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../public/assets/beyondscape-session.js', import.meta.url), 'utf8');
const { createRouteMirror } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

function channelFixture() {
 const instances = [];
 class FakeChannel {
  constructor(name) { this.name = name; this.onmessage = null; this.closed = false; this.messages = []; this.fail = false; instances.push(this); }
  postMessage(packet) {
   if (this.fail || this.closed) throw Error('Transport is not available.');
   this.messages.push(structuredClone(packet));
   for (const other of instances) if (other !== this && !other.closed && other.name === this.name) other.onmessage?.({ data: structuredClone(packet) });
  }
  close() { this.closed = true; }
 }
 return { Channel: FakeChannel, instances };
}

const packet = (changes = {}) => ({ version: 1, type: 'route', session: 'shared-session', datasetId: 'bls-cpi', holdIndex: 4, ...changes });

test('two open views mirror exact canonical route state without self-echo or extra fields', () => {
 const fixture = channelFixture(), first = [], second = [], statuses = [];
 const a = createRouteMirror({ session: 'shared-session', Channel: fixture.Channel, onUpdate: value => first.push(value), onStatus: value => statuses.push(value) });
 const b = createRouteMirror({ session: 'shared-session', Channel: fixture.Channel, onUpdate: value => second.push(value) });
 assert.equal(a.available, true); assert.equal(b.available, true);
 assert.deepEqual(fixture.instances.map(channel => channel.name), ['cyberalpine-route-shared-session', 'cyberalpine-route-shared-session']);
 assert.ok(statuses.includes('same-browser'));
 a.publish({ datasetId: 'bls-cpi', holdIndex: 4, ignored: 'not forwarded', session: 'forged' });
 assert.deepEqual(first, []); assert.deepEqual(second, [{ datasetId: 'bls-cpi', holdIndex: 4 }]);
 assert.deepEqual(fixture.instances[0].messages.at(-1), packet());
 b.publish({ datasetId: 'research-crossref', holdIndex: 23 });
 assert.deepEqual(first, [{ datasetId: 'research-crossref', holdIndex: 23 }]);
 a.close(); b.close();
});

test('malformed, noncanonical and wrong-session incoming packets cannot update the route', () => {
 const fixture = channelFixture(), received = [];
 const mirror = createRouteMirror({ session: 'shared-session', Channel: fixture.Channel, onUpdate: value => received.push(value) });
 const transport = fixture.instances[0];
 const invalid = [null, {}, packet({ type: 'unknown' }), packet({ session: 'other-session' }), packet({ version: 2 }),
  packet({ datasetId: '' }), packet({ datasetId: ' ' }), packet({ datasetId: '<script>' }), packet({ datasetId: 'x'.repeat(81) }),
  packet({ datasetId: null }), packet({ holdIndex: -1 }), packet({ holdIndex: 64 }), packet({ holdIndex: .5 }),
  packet({ holdIndex: '4' }), packet({ holdIndex: Infinity }), packet({ holdIndex: NaN }), packet({ holdIndex: Number.MAX_SAFE_INTEGER + 1 })];
 for (const value of invalid) transport.onmessage({ data: value });
 assert.deepEqual(received, []);
 transport.onmessage({ data: packet({ datasetId: 'books-crossref', holdIndex: 0, injected: 'not forwarded' }) });
 transport.onmessage({ data: packet({ datasetId: 'crossref-reference-edges', holdIndex: 63 }) });
 assert.deepEqual(received, [{ datasetId: 'books-crossref', holdIndex: 0 }, { datasetId: 'crossref-reference-edges', holdIndex: 63 }]);
 mirror.close();
});

test('separate sessions remain independent and outgoing invalid state is never broadcast', () => {
 const fixture = channelFixture(), received = [];
 const first = createRouteMirror({ session: 'shared-session', Channel: fixture.Channel });
 const other = createRouteMirror({ session: 'other-session', Channel: fixture.Channel, onUpdate: value => received.push(value) });
 first.publish({ datasetId: 'bls-cpi', holdIndex: 7 }); assert.deepEqual(received, []);
 const before = fixture.instances[0].messages.length;
 for (const value of [{ datasetId: '', holdIndex: 4 }, { datasetId: 'research-crossref', holdIndex: -2 }, { datasetId: 'bls-cpi', holdIndex: 1.5 }, { datasetId: 'bls-cpi', holdIndex: '2' }]) first.publish(value);
 assert.equal(fixture.instances[0].messages.length, before);
 first.close(); other.close();
});

test('unavailable browser support and constructor rejection leave a usable standalone no-op', () => {
 for (const options of [{ Channel: null }, { Channel: class { constructor() { throw Error('Blocked by browser policy.'); } } }, { Channel: channelFixture().Channel, session: 'invalid session' }]) {
  const mirror = createRouteMirror({ session: 'shared-session', ...options });
  assert.equal(mirror.available, false);
  assert.doesNotThrow(() => mirror.publish({ datasetId: 'bls-cpi', holdIndex: 0 }));
  assert.doesNotThrow(() => { mirror.close(); mirror.close(); });
 }
});

test('handshake and later postMessage rejection never break standalone navigation', () => {
 const handshake = createRouteMirror({ session: 'shared-session', Channel: class { postMessage() { throw Error('Clone or policy failure.'); } close() {} } });
 assert.equal(handshake.available, false);
 assert.doesNotThrow(() => handshake.publish({ datasetId: 'bls-cpi', holdIndex: 2 }));
 const fixture = channelFixture(), received = [];
 const mirror = createRouteMirror({ session: 'shared-session', Channel: fixture.Channel, onUpdate: value => received.push(value) });
 fixture.instances[0].fail = true;
 assert.doesNotThrow(() => mirror.publish({ datasetId: 'bls-cpi', holdIndex: 2 }));
 assert.deepEqual(received, []); assert.doesNotThrow(() => mirror.close());
});

test('closing the mirror stops broadcasts and ignores queued incoming updates', () => {
 const fixture = channelFixture(), received = [];
 const mirror = createRouteMirror({ session: 'shared-session', Channel: fixture.Channel, onUpdate: value => received.push(value) });
 const transport = fixture.instances[0], queuedHandler = transport.onmessage, sent = transport.messages.length;
 mirror.close(); mirror.close(); mirror.publish({ datasetId: 'bls-cpi', holdIndex: 4 });
 queuedHandler({ data: packet() });
 assert.equal(transport.closed, true); assert.equal(transport.messages.length, sent); assert.deepEqual(received, []);
});
