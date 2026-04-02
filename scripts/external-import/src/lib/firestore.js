import { FieldValue } from 'firebase-admin/firestore';

function getSourceStatusRef(db, source) {
  return db.collection('externalSyncStatus').doc(source);
}

export async function getSourceSyncStatus(db, source) {
  if (!db) return null;

  const snapshot = await getSourceStatusRef(db, source).get();
  return snapshot.exists ? snapshot.data() : null;
}

export async function writeSyncAttempt(db, source) {
  if (!db) return;

  await getSourceStatusRef(db, source).set({
    source,
    lastAttemptAt: FieldValue.serverTimestamp(),
    lastError: null
  }, { merge: true });
}

export async function writeSyncResult(db, source, result) {
  if (!db) return;

  await getSourceStatusRef(db, source).set({
    source,
    lastAttemptAt: FieldValue.serverTimestamp(),
    lastSuccessAt: FieldValue.serverTimestamp(),
    lastError: null,
    fetchedCount: result.fetchedCount || 0,
    upsertedCount: result.upsertedCount || 0,
    deactivatedCount: result.deactivatedCount || 0
  }, { merge: true });
}

export async function writeSyncFailure(db, source, error, partial = {}) {
  if (!db) return;

  await getSourceStatusRef(db, source).set({
    source,
    lastAttemptAt: FieldValue.serverTimestamp(),
    lastError: String(error?.message || error || 'Unknown sync error'),
    fetchedCount: partial.fetchedCount || 0,
    upsertedCount: partial.upsertedCount || 0,
    deactivatedCount: partial.deactivatedCount || 0
  }, { merge: true });
}

export async function upsertExternalEvents(db, source, items, { logger } = {}) {
  const seenDocIds = new Set();
  let upsertedCount = 0;

  for (const item of items) {
    seenDocIds.add(item.docId);

    const docRef = db.collection('externalEvents').doc(item.docId);
    const snapshot = await docRef.get();
    const payload = {
      ...item,
      importedAt: snapshot.exists ? (snapshot.data().importedAt || FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
      syncMissCount: 0,
      isActive: true
    };

    delete payload.docId;

    await docRef.set(payload, { merge: true });
    upsertedCount += 1;
    logger?.debug(`Upserted ${source}:${item.docId}`);
  }

  return {
    upsertedCount,
    seenDocIds
  };
}

export async function markStaleExternalEvents(db, source, seenDocIds, { logger, maxMisses = 3 } = {}) {
  const snapshot = await db
    .collection('externalEvents')
    .where('source', '==', source)
    .where('isActive', '==', true)
    .get();

  let deactivatedCount = 0;

  for (const docSnapshot of snapshot.docs) {
    if (seenDocIds.has(docSnapshot.id)) {
      continue;
    }

    const current = docSnapshot.data();
    const nextMissCount = Number(current.syncMissCount || 0) + 1;
    const shouldDeactivate = nextMissCount >= maxMisses;

    await docSnapshot.ref.set({
      syncMissCount: nextMissCount,
      isActive: !shouldDeactivate
    }, { merge: true });

    if (shouldDeactivate) {
      deactivatedCount += 1;
      logger?.warn(`Marked stale opportunity inactive: ${docSnapshot.id}`);
    }
  }

  return deactivatedCount;
}
