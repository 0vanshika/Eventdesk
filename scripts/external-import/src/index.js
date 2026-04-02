import { initializeFirestoreContext } from './config.js';
import { parseCliArgs, printUsage } from './lib/cli.js';
import { createLogger } from './lib/logger.js';
import {
  getSourceSyncStatus,
  markStaleExternalEvents,
  upsertExternalEvents,
  writeSyncAttempt,
  writeSyncFailure,
  writeSyncResult
} from './lib/firestore.js';
import { fetchUnstopOpportunities } from './sources/unstop.js';

function getCutoffDate(options, sourceStatus) {
  if (options.sinceHours) {
    return new Date(Date.now() - (options.sinceHours * 60 * 60 * 1000));
  }

  const lastSuccess = sourceStatus?.lastSuccessAt;
  if (typeof lastSuccess?.toDate === 'function') {
    return lastSuccess.toDate();
  }

  return null;
}

async function main() {
  let options;

  try {
    options = parseCliArgs();
  } catch (error) {
    console.error(error.message || error);
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    printUsage();
    return;
  }

  const logger = createLogger({ verbose: options.verbose });
  const db = initializeFirestoreContext({
    requireCredentials: !options.dryRun,
    logger
  });

  const sourceStatus = await getSourceSyncStatus(db, options.source).catch((error) => {
    logger.warn(`Could not read previous sync status: ${error.message}`);
    return null;
  });

  const cutoffDate = getCutoffDate(options, sourceStatus);
  if (cutoffDate) {
    logger.info(`Using cutoff date ${cutoffDate.toISOString()}`);
  }

  if (!options.dryRun) {
    await writeSyncAttempt(db, options.source);
  }

  let partialResult = {
    fetchedCount: 0,
    upsertedCount: 0,
    deactivatedCount: 0
  };

  try {
    const result = await fetchUnstopOpportunities({
      maxUrls: options.maxUrls,
      cutoffDate,
      logger
    });

    partialResult.fetchedCount = result.items.length;
    logger.info(`Parsed ${result.items.length} public Unstop opportunities from ${result.candidateCount} candidates.`);

    if (result.errors.length) {
      logger.warn(`Encountered ${result.errors.length} skipped candidate URLs during parsing.`);
    }

    if (options.dryRun) {
      const preview = result.items.slice(0, 3).map((item) => ({
        docId: item.docId,
        title: item.title,
        category: item.category,
        registrationDeadline: item.registrationDeadline,
        sourceUrl: item.sourceUrl
      }));

      logger.info('Dry run preview:', preview);
      return;
    }

    const upsertResult = await upsertExternalEvents(db, options.source, result.items, { logger });
    partialResult.upsertedCount = upsertResult.upsertedCount;

    if (result.items.length > 0) {
      partialResult.deactivatedCount = await markStaleExternalEvents(
        db,
        options.source,
        upsertResult.seenDocIds,
        { logger }
      );
    } else {
      logger.warn('Skipping stale deactivation because this run returned no parsed opportunities.');
    }

    await writeSyncResult(db, options.source, partialResult);
    logger.info(`Sync complete. Upserted ${partialResult.upsertedCount} opportunities and deactivated ${partialResult.deactivatedCount}.`);
  } catch (error) {
    if (!options.dryRun) {
      await writeSyncFailure(db, options.source, error, partialResult);
    }

    logger.error(error.message || error);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
