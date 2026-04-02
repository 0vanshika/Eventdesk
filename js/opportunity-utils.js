const SOURCE_LABELS = {
  unstop: 'Unstop'
};

const CATEGORY_LABELS = {
  hackathons: 'Hackathon',
  competitions: 'Competition',
  events: 'Event',
  'workshops-webinars': 'Workshop',
  'college-fests': 'College Fest',
  conferences: 'Conference'
};

function toText(value) {
  return String(value || '').trim();
}

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') {
    return value.toDate();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function dedupeStrings(values) {
  return [...new Set(values.map((value) => toText(value)).filter(Boolean))];
}

function toArray(value) {
  if (Array.isArray(value)) {
    return dedupeStrings(value);
  }

  return dedupeStrings(
    toText(value)
      .split(',')
      .map((item) => item.trim())
  );
}

function normalizeMode(value) {
  const normalized = toText(value).toLowerCase();

  if (!normalized) return '';
  if (normalized.includes('hybrid')) return 'Hybrid';
  if (normalized.includes('online') || normalized.includes('virtual') || normalized.includes('remote')) return 'Online';
  if (normalized.includes('offline') || normalized.includes('in-person') || normalized.includes('in person') || normalized.includes('on campus')) return 'Offline';

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function parseTeamRange(value) {
  const text = toText(value);
  if (!text) return null;

  const numericValues = text
    .match(/\d+/g)
    ?.map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0);

  if (!numericValues?.length) {
    return null;
  }

  return {
    min: Math.min(...numericValues),
    max: Math.max(...numericValues)
  };
}

function getOpportunityTeamRange(item = {}) {
  if (item?.sourceType === 'external') {
    return parseTeamRange(item.teamSizeText);
  }

  const teamSize = getCampusTeamSize(item);
  return teamSize ? { min: teamSize, max: teamSize } : null;
}

function getCampusTeamSize(item) {
  const raw = item?.teamSize ?? item?.teamLimit ?? 1;

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(1, raw);
  }

  const range = parseTeamRange(raw);
  return range?.max || 1;
}

function getParticipationKind(item) {
  const range = getOpportunityTeamRange(item);
  if (!range?.max) return 'unknown';
  return range.max === 1 ? 'solo' : 'team';
}

function buildSearchableText(item) {
  return [
    item.title,
    item.summary,
    item.description,
    item.organizerName,
    item.category,
    item.mode,
    item.location,
    item.venue,
    item.teamSizeText,
    item.prizesText,
    item.eligibilityText,
    item.sourceLabel,
    ...(item.tags || [])
  ]
    .map((value) => toText(value))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function truncateText(value, maxLength = 72) {
  const text = toText(value);
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

export function getOpportunitySourceLabel(source = '') {
  const normalized = toText(source).toLowerCase();
  return SOURCE_LABELS[normalized] || 'External Source';
}

export function getOpportunitySourceTypeLabel(item = {}) {
  return item?.sourceType === 'external' ? 'External' : 'Campus';
}

export function normalizeExternalOpportunity(item = {}) {
  const source = toText(item.source).toLowerCase() || 'external';
  const sourceLabel = getOpportunitySourceLabel(source);
  const tags = dedupeStrings([
    ...(Array.isArray(item.tags) ? item.tags : []),
    item.category,
    item.mode
  ]);

  const normalized = {
    ...item,
    id: item.id || item.externalId || item.sourceUrl || '',
    externalId: toText(item.externalId),
    source,
    sourceType: 'external',
    sourceLabel,
    title: toText(item.title) || 'External Opportunity',
    category: toText(item.category) || CATEGORY_LABELS[toText(item.rawSourceMeta?.categoryKey)] || 'External Opportunity',
    summary: toText(item.summary),
    description: toText(item.description),
    organizerName: toText(item.organizerName),
    mode: normalizeMode(item.mode || item.format),
    location: toText(item.location),
    venue: toText(item.venue),
    teamSizeText: toText(item.teamSizeText),
    prizesText: toText(item.prizesText),
    eligibilityText: toText(item.eligibilityText),
    sourceUrl: toText(item.sourceUrl),
    posterUrl: toText(item.posterUrl),
    tags,
    status: toText(item.status) || 'Unknown',
    isActive: item.isActive !== false
  };

  if (!normalized.summary) {
    normalized.summary = normalized.description;
  }

  normalized.searchableText = toText(item.searchableText) || buildSearchableText(normalized);
  return normalized;
}

export function getOpportunityModeValue(item = {}) {
  if (item?.sourceType === 'external') {
    return normalizeMode(item.mode || item.format);
  }

  return normalizeMode(item.format || item.mode) || 'Offline';
}

export function getOpportunityLocationValue(item = {}) {
  if (item?.sourceType === 'external') {
    return toText(item.location) || toText(item.venue);
  }

  return toText(item.location) || toText(item.city) || toText(item.venue) || 'Campus';
}

export function getOpportunityDateValue(item = {}) {
  if (item?.sourceType === 'external') {
    return toDate(item.startDate)
      || toDate(item.registrationDeadline)
      || toDate(item.updatedAt)
      || toDate(item.importedAt);
  }

  return toDate(item.date);
}

export function getOpportunityDeadlineValue(item = {}) {
  if (item?.sourceType === 'external') {
    return toDate(item.registrationDeadline) || toDate(item.startDate);
  }

  return toDate(item.regDeadline) || toDate(item.date);
}

export function getOpportunityCountdownContext(item = {}) {
  if (item?.sourceType === 'external') {
    if (toDate(item.registrationDeadline)) {
      return { kind: 'deadline', label: 'Closes' };
    }

    if (toDate(item.startDate)) {
      return { kind: 'start', label: 'Starts' };
    }

    return { kind: 'synced', label: 'Synced' };
  }

  return { kind: 'start', label: 'Starts' };
}

export function getOpportunityTeamSizeMax(item = {}) {
  return getOpportunityTeamRange(item)?.max || null;
}

export function getOpportunityParticipationValue(item = {}) {
  if (item?.sourceType === 'external') {
    return toText(item.teamSizeText);
  }

  const teamSize = getCampusTeamSize(item);
  return teamSize > 1 ? `Teams up to ${teamSize}` : 'Individual';
}

export function getOpportunityTrackValue(item = {}) {
  if (item?.sourceType === 'external') {
    if (item.prizesText) {
      return truncateText(item.prizesText);
    }

    if (Array.isArray(item.tags) && item.tags.length) {
      return item.tags[0];
    }

    return '';
  }

  const tracks = Array.isArray(item.tracks) ? item.tracks : toArray(item.tracks);
  return tracks[0] || '';
}

export function filterOpportunityFeed(items, filters = {}) {
  const {
    source = 'All',
    category = 'All',
    search = '',
    location = 'All',
    format = 'All',
    team = 'All'
  } = filters;

  const normalizedSearch = toText(search).toLowerCase();

  return items.filter((item) => {
    const sourceType = item?.sourceType === 'external' ? 'external' : 'campus';
    const opportunityLocation = getOpportunityLocationValue(item);
    const opportunityMode = getOpportunityModeValue(item);
    const opportunityText = `${buildSearchableText(item)} ${toText(item.searchableText)}`.toLowerCase();
    const participationKind = getParticipationKind(item);
    const participationRange = getOpportunityTeamRange(item);
    const teamSize = getOpportunityTeamSizeMax(item);
    const hasExternalLocation = sourceType !== 'external' || Boolean(opportunityLocation);
    const hasExternalMode = sourceType !== 'external' || Boolean(opportunityMode);
    const hasExternalTeamData = sourceType !== 'external' || Boolean(participationRange?.max);
    const supportsSolo = Boolean(participationRange?.min) && participationRange.min <= 1;
    const supportsTeam = Boolean(participationRange?.max) && participationRange.max > 1;

    const matchesSource = source === 'All' || source === sourceType;
    const matchesCategory = category === 'All' || toText(item.category) === category;
    const matchesLocation = location === 'All'
      || !hasExternalLocation
      || opportunityLocation === location;
    const matchesFormat = format === 'All'
      || !hasExternalMode
      || opportunityMode === format;
    const matchesSearch = !normalizedSearch || opportunityText.includes(normalizedSearch);
    const matchesTeam = team === 'All'
      || !hasExternalTeamData
      || (team === 'Solo' && (participationKind === 'solo' || supportsSolo))
      || (team === 'Team' && (participationKind === 'team' || supportsTeam))
      || (team === 'TeamUpTo4' && supportsTeam && teamSize && teamSize <= 4);

    return matchesSource && matchesCategory && matchesLocation && matchesFormat && matchesSearch && matchesTeam;
  });
}

function getSortableTime(value, fallback = Number.POSITIVE_INFINITY) {
  const date = toDate(value);
  return date ? date.getTime() : fallback;
}

export function sortOpportunityFeed(items, sortValue = 'date') {
  const opportunities = [...items];

  if (sortValue === 'deadline') {
    return opportunities.sort((left, right) => {
      return getSortableTime(getOpportunityDeadlineValue(left)) - getSortableTime(getOpportunityDeadlineValue(right));
    });
  }

  if (sortValue === 'synced') {
    return opportunities.sort((left, right) => {
      return getSortableTime(right.updatedAt || right.importedAt, Number.NEGATIVE_INFINITY)
        - getSortableTime(left.updatedAt || left.importedAt, Number.NEGATIVE_INFINITY);
    });
  }

  if (sortValue === 'alpha') {
    return opportunities.sort((left, right) => toText(left.title).localeCompare(toText(right.title)));
  }

  return opportunities.sort((left, right) => {
    return getSortableTime(getOpportunityDateValue(left)) - getSortableTime(getOpportunityDateValue(right));
  });
}
