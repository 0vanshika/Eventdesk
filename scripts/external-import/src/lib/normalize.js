import crypto from 'node:crypto';

export function toText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function dedupeStrings(values = []) {
  return [...new Set(values.map((value) => toText(value)).filter(Boolean))];
}

export function buildExternalEventDocumentId({ source, externalId, sourceUrl }) {
  const normalizedSource = toText(source).toLowerCase() || 'external';

  if (toText(externalId)) {
    return `${normalizedSource}_${toText(externalId)}`;
  }

  const hash = crypto
    .createHash('sha1')
    .update(toText(sourceUrl))
    .digest('hex');

  return `${normalizedSource}_${hash}`;
}

export function deriveExternalStatus({ startDate, registrationDeadline }) {
  const now = Date.now();
  const start = toDate(startDate);
  const deadline = toDate(registrationDeadline);

  if (deadline && deadline.getTime() < now) {
    return 'Closed';
  }

  if (start && start.getTime() < now) {
    return 'Closed';
  }

  if (deadline || start) {
    return 'Upcoming';
  }

  return 'Unknown';
}

export function buildSearchableText(item) {
  return [
    item.title,
    item.category,
    item.summary,
    item.description,
    item.organizerName,
    item.mode,
    item.location,
    item.venue,
    item.teamSizeText,
    item.prizesText,
    item.eligibilityText,
    ...(item.tags || [])
  ]
    .map((value) => toText(value))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function buildNormalizedExternalEvent(source, rawItem) {
  const normalizedSource = toText(source).toLowerCase();
  const tags = dedupeStrings(rawItem.tags || []);
  const docId = buildExternalEventDocumentId({
    source: normalizedSource,
    externalId: rawItem.externalId,
    sourceUrl: rawItem.sourceUrl
  });

  const event = {
    docId,
    externalId: toText(rawItem.externalId),
    source: normalizedSource,
    sourceType: 'external',
    title: toText(rawItem.title) || 'External Opportunity',
    category: toText(rawItem.category) || 'External Opportunity',
    summary: toText(rawItem.summary),
    description: toText(rawItem.description),
    organizerName: toText(rawItem.organizerName),
    startDate: toDate(rawItem.startDate),
    registrationDeadline: toDate(rawItem.registrationDeadline),
    mode: toText(rawItem.mode),
    location: toText(rawItem.location),
    venue: toText(rawItem.venue),
    teamSizeText: toText(rawItem.teamSizeText),
    prizesText: toText(rawItem.prizesText),
    eligibilityText: toText(rawItem.eligibilityText),
    sourceUrl: toText(rawItem.sourceUrl),
    posterUrl: toText(rawItem.posterUrl),
    tags,
    status: toText(rawItem.status) || deriveExternalStatus(rawItem),
    isActive: true,
    rawSourceMeta: rawItem.rawSourceMeta || {}
  };

  if (!event.summary) {
    event.summary = event.description;
  }

  event.searchableText = toText(rawItem.searchableText) || buildSearchableText(event);
  return event;
}
