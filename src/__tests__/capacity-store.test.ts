import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Capacity Store', () => {
  it('persists Gmail counts to the configured state file', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'capacity-store-'));
    const stateFile = join(tempDir, 'capacity.json');
    process.env.CAPACITY_STATE_FILE = stateFile;

    const store = await import('../lib/capacity-store.js');
    store.resetCapacityStoreForTests();

    assert.equal(store.getGmailSendCount('rep@example.com'), 0);
    store.incrementGmailSendCount('rep@example.com');
    store.incrementGmailSendCount('rep@example.com');

    assert.equal(store.getGmailSendCount('rep@example.com'), 2);
    assert.equal(existsSync(stateFile), true);

    store.resetCapacityStoreForTests();
    assert.equal(store.getGmailSendCount('rep@example.com'), 2);

    const capacity = {
      total: Math.max(0, 5 - store.getGmailSendCount('rep@example.com')),
      remaining: Math.max(0, 5 - store.getGmailSendCount('rep@example.com')),
    };

    assert.equal(capacity.total, 3);
    assert.equal(capacity.remaining, 3);

    unlinkSync(stateFile);
    delete process.env.CAPACITY_STATE_FILE;
    store.resetCapacityStoreForTests();
  });

  it('tracks call and LinkedIn counts independently', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'capacity-store-'));
    const stateFile = join(tempDir, 'capacity.json');
    process.env.CAPACITY_STATE_FILE = stateFile;

    const store = await import('../lib/capacity-store.js');
    store.resetCapacityStoreForTests();

    store.incrementCallCount();
    store.incrementCallCount();
    store.incrementLinkedInSendCount();

    assert.equal(store.getCallCount(), 2);
    assert.equal(store.getLinkedInSendCount(), 1);

    delete process.env.CAPACITY_STATE_FILE;
    store.resetCapacityStoreForTests();
  });
});
