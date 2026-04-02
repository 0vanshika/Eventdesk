import test from 'node:test';
import assert from 'node:assert/strict';

import {
  markStaleExternalEvents,
  upsertExternalEvents
} from '../src/lib/firestore.js';

class FakeDocSnapshot {
  constructor(collectionStore, id) {
    this._collectionStore = collectionStore;
    this.id = id;
  }

  get exists() {
    return this._collectionStore.has(this.id);
  }

  data() {
    return this._collectionStore.get(this.id);
  }

  get ref() {
    return new FakeDocRef(this._collectionStore, this.id);
  }
}

class FakeDocRef {
  constructor(collectionStore, id) {
    this._collectionStore = collectionStore;
    this.id = id;
  }

  async get() {
    return new FakeDocSnapshot(this._collectionStore, this.id);
  }

  async set(payload, options = {}) {
    const current = this._collectionStore.get(this.id) || {};
    const nextValue = options.merge ? { ...current, ...payload } : { ...payload };
    this._collectionStore.set(this.id, nextValue);
  }
}

class FakeQuery {
  constructor(collectionStore, filters = []) {
    this._collectionStore = collectionStore;
    this._filters = filters;
  }

  where(field, operator, value) {
    return new FakeQuery(this._collectionStore, [...this._filters, { field, operator, value }]);
  }

  async get() {
    const docs = [...this._collectionStore.entries()]
      .filter(([, data]) => this._filters.every((filter) => {
        if (filter.operator !== '==') {
          throw new Error(`Unsupported operator in fake query: ${filter.operator}`);
        }

        return data?.[filter.field] === filter.value;
      }))
      .map(([id]) => new FakeDocSnapshot(this._collectionStore, id));

    return { docs };
  }
}

class FakeCollectionRef extends FakeQuery {
  constructor(collectionStore) {
    super(collectionStore, []);
    this._collectionStore = collectionStore;
  }

  doc(id) {
    return new FakeDocRef(this._collectionStore, id);
  }
}

class FakeDb {
  constructor() {
    this._collections = new Map();
  }

  collection(name) {
    if (!this._collections.has(name)) {
      this._collections.set(name, new Map());
    }

    return new FakeCollectionRef(this._collections.get(name));
  }

  read(name, id) {
    return this._collections.get(name)?.get(id) || null;
  }

  count(name) {
    return this._collections.get(name)?.size || 0;
  }
}

function buildSampleItem(overrides = {}) {
  return {
    docId: 'unstop_12345',
    externalId: '12345',
    source: 'unstop',
    sourceType: 'external',
    title: 'Sample Challenge',
    category: 'Competition',
    summary: 'Apply on Unstop',
    description: 'External opportunity',
    organizerName: 'Example Organizer',
    startDate: new Date('2026-04-10T10:00:00Z'),
    registrationDeadline: new Date('2026-04-08T10:00:00Z'),
    mode: 'Online',
    location: 'Remote',
    venue: '',
    teamSizeText: '2 - 4 Members',
    prizesText: 'Winner • 10,000',
    eligibilityText: 'Open to students',
    sourceUrl: 'https://unstop.com/competitions/sample-12345',
    posterUrl: 'https://cdn.example.com/sample.png',
    tags: ['Competition', 'Online'],
    status: 'Upcoming',
    searchableText: 'sample challenge apply on unstop',
    rawSourceMeta: {
      usedAmpPage: true
    },
    ...overrides
  };
}

test('upsertExternalEvents updates deterministic docs instead of duplicating them', async () => {
  const db = new FakeDb();
  const firstItem = buildSampleItem();

  await upsertExternalEvents(db, 'unstop', [firstItem]);
  assert.equal(db.count('externalEvents'), 1);

  await upsertExternalEvents(db, 'unstop', [
    buildSampleItem({
      title: 'Sample Challenge Updated'
    })
  ]);

  assert.equal(db.count('externalEvents'), 1);
  assert.equal(db.read('externalEvents', 'unstop_12345').title, 'Sample Challenge Updated');
  assert.equal(db.read('externalEvents', 'unstop_12345').isActive, true);
});

test('markStaleExternalEvents deactivates docs after three missed successful runs', async () => {
  const db = new FakeDb();

  await upsertExternalEvents(db, 'unstop', [buildSampleItem()]);

  await markStaleExternalEvents(db, 'unstop', new Set());
  assert.equal(db.read('externalEvents', 'unstop_12345').syncMissCount, 1);
  assert.equal(db.read('externalEvents', 'unstop_12345').isActive, true);

  await markStaleExternalEvents(db, 'unstop', new Set());
  assert.equal(db.read('externalEvents', 'unstop_12345').syncMissCount, 2);
  assert.equal(db.read('externalEvents', 'unstop_12345').isActive, true);

  await markStaleExternalEvents(db, 'unstop', new Set());
  assert.equal(db.read('externalEvents', 'unstop_12345').syncMissCount, 3);
  assert.equal(db.read('externalEvents', 'unstop_12345').isActive, false);
});
