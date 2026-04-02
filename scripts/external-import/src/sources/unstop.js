import * as cheerio from 'cheerio';
import { fetchText, sleep } from '../lib/http.js';
import {
  buildNormalizedExternalEvent,
  dedupeStrings,
  deriveExternalStatus,
  toDate,
  toText
} from '../lib/normalize.js';

const SITEMAP_INDEX_URL = 'https://unstop.com/sitemap';
const SUPPORTED_CATEGORY_KEYS = new Set([
  'hackathons',
  'competitions',
  'events',
  'workshops-webinars',
  'college-fests',
  'conferences'
]);

const CATEGORY_LABELS = {
  hackathons: 'Hackathon',
  competitions: 'Competition',
  events: 'Event',
  'workshops-webinars': 'Workshop',
  'college-fests': 'College Fest',
  conferences: 'Conference'
};

const MONTH_LOOKUP = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11
};

function parseSitemapIndex(xml) {
  return xml
    .split('<sitemap>')
    .slice(1)
    .map((chunk) => ({
      loc: toText(chunk.match(/<loc>([^<]+)<\/loc>/i)?.[1]),
      lastmod: toText(chunk.match(/<lastmod>([^<]+)<\/lastmod>/i)?.[1])
    }))
    .filter((item) => item.loc);
}

function parseUrlSet(xml) {
  return xml
    .split('<url>')
    .slice(1)
    .map((chunk) => ({
      loc: toText(chunk.match(/<loc>([^<]+)<\/loc>/i)?.[1]),
      lastmod: toText(chunk.match(/<lastmod>([^<]+)<\/lastmod>/i)?.[1])
    }))
    .filter((item) => item.loc);
}

function getCategoryKeyFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    return pathname.split('/').filter(Boolean)[0] || '';
  } catch {
    return '';
  }
}

function isOpportunitySitemap(url) {
  return /\/sitemaps\/opportunity\/sitemap\d+\.xml$/i.test(toText(url));
}

export function isRelevantOpportunityUrl(url) {
  return SUPPORTED_CATEGORY_KEYS.has(getCategoryKeyFromUrl(url));
}

function stripStrongText($node) {
  const clone = $node.clone();
  clone.find('strong').remove();
  return toText(clone.text());
}

function collectStructuredText($, root) {
  if (!root?.length) return '';

  const blocks = [];
  root.find('h3, h4, p, li').each((_, node) => {
    const text = toText($(node).text());
    if (!text) return;
    blocks.push($(node).is('li') ? `- ${text}` : text);
  });

  return dedupeStrings(blocks).join('\n');
}

function parseRegBoxFields($) {
  const fields = new Map();

  $('.reg_box .item .text').each((_, node) => {
    const $node = $(node);
    const label = stripStrongText($node).toLowerCase();
    const value = toText($node.find('strong').first().text());
    if (label && value) {
      fields.set(label, value);
    }
  });

  return fields;
}

function parseImportantDates($) {
  return $('.dates_box li').map((_, node) => {
    const $node = $(node);
    const label = toText($node.find('.cptn span').first().text());
    const value = toText($node.find('.cptn strong').first().text());

    return {
      label,
      value,
      parsedDate: parseUnstopDate(value)
    };
  }).get().filter((item) => item.label && item.value);
}

function parsePrizeText($) {
  const lines = $('.prize_list').map((_, node) => {
    const $node = $(node);
    const heading = toText($node.find('h3').first().text());
    const copy = toText($node.find('p').first().text());
    const amount = toText($node.find('.trophy strong').first().text());
    const reward = toText($node.find('.certificate').first().text());

    return [heading, amount, reward, copy].filter(Boolean).join(' • ');
  }).get();

  return lines.slice(0, 6).join('\n');
}

function deriveModeFromText(text) {
  const normalized = toText(text).toLowerCase();

  if (!normalized) return '';

  const hasOnline = normalized.includes('online') || normalized.includes('virtual');
  const hasOffline = normalized.includes('offline') || normalized.includes('on campus') || normalized.includes('in-person') || normalized.includes('in person');

  if (hasOnline && hasOffline) return 'Hybrid';
  if (hasOnline) return 'Online';
  if (hasOffline) return 'Offline';

  return '';
}

function guessLocationFromOrganizer(organizerName) {
  const parts = organizerName
    .split(',')
    .map((item) => toText(item))
    .filter(Boolean);

  if (parts.length < 2) {
    return '';
  }

  const candidate = parts[parts.length - 1];
  if (/^(india|ltd|limited|pvt|pvt ltd)$/i.test(candidate)) {
    return '';
  }

  return candidate;
}

function normalizeTitleBase(value) {
  return toText(value)
    .toLowerCase()
    .replace(/\b20\d{2}\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titleCase(value) {
  return toText(value)
    .split(' ')
    .filter(Boolean)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join(' ');
}

function deriveTitleFromCanonicalUrl(canonicalUrl, organizerName) {
  try {
    const pathname = new URL(canonicalUrl).pathname;
    const slug = pathname.split('/').filter(Boolean).at(-1)?.replace(/-\d+$/, '') || '';
    const organizerTokens = new Set(
      organizerName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(' ')
        .filter((item) => item.length > 2)
    );

    const words = slug.split('-').filter(Boolean);
    while (words.length > 3 && organizerTokens.has(words[words.length - 1].toLowerCase())) {
      words.pop();
    }

    return titleCase(words.join(' '));
  } catch {
    return '';
  }
}

function isGenericTitle(title, category) {
  const normalizedTitle = normalizeTitleBase(title);
  const normalizedCategory = normalizeTitleBase(category);
  return normalizedTitle === normalizedCategory;
}

function buildSummary(description, metaDescription) {
  const lines = description
    .split('\n')
    .map((line) => toText(line.replace(/^- /, '')))
    .filter(Boolean)
    .filter((line) => !/^(about the opportunity|eligibility|event structure|registration fee|important dates|rewards and prizes|rulebook)/i.test(line));

  if (lines.length) {
    return lines.slice(0, 2).join(' ');
  }

  const normalizedMeta = toText(metaDescription);
  if (normalizedMeta && !/^find out the best /i.test(normalizedMeta)) {
    return normalizedMeta;
  }

  return normalizedMeta;
}

export function parseUnstopDate(value) {
  const normalized = toText(value).replace(/[’]/g, "'");
  const match = normalized.match(/^(\d{1,2})\s+([A-Za-z]{3})'?(\d{2,4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)(?:\s*IST)?$/i);

  if (!match) {
    return toDate(normalized);
  }

  const [, dayText, monthText, yearText, hourText, minuteText, meridiem] = match;
  const month = MONTH_LOOKUP[monthText.toLowerCase()];

  if (month === undefined) {
    return null;
  }

  let year = Number(yearText);
  if (year < 100) {
    year += 2000;
  }

  let hour = Number(hourText) % 12;
  if (meridiem.toUpperCase() === 'PM') {
    hour += 12;
  }

  const utcMillis = Date.UTC(
    year,
    month,
    Number(dayText),
    hour - 5,
    Number(minuteText) - 30
  );

  return new Date(utcMillis);
}

function parseCanonicalFallbackPage(html, url) {
  const $ = cheerio.load(html);
  const canonicalUrl = toText($('link[rel="canonical"]').attr('href')) || url;
  const categoryKey = getCategoryKeyFromUrl(canonicalUrl);

  return {
    externalId: canonicalUrl.match(/-(\d+)(?:\/)?$/)?.[1] || '',
    sourceUrl: canonicalUrl,
    title: toText($('meta[property="og:title"]').attr('content')) || deriveTitleFromCanonicalUrl(canonicalUrl, ''),
    category: CATEGORY_LABELS[categoryKey] || 'External Opportunity',
    summary: toText($('meta[name="description"]').attr('content')),
    description: '',
    organizerName: '',
    startDate: null,
    registrationDeadline: null,
    mode: '',
    location: '',
    venue: '',
    teamSizeText: '',
    prizesText: '',
    eligibilityText: '',
    posterUrl: toText($('meta[property="og:image"]').attr('content')),
    tags: [],
    status: 'Unknown',
    rawSourceMeta: {
      categoryKey,
      fallbackMetaOnly: true
    }
  };
}

function mergeFallback(primary, fallback) {
  const merged = { ...fallback, ...primary };

  Object.keys(fallback).forEach((key) => {
    if (!merged[key] && fallback[key]) {
      merged[key] = fallback[key];
    }
  });

  merged.rawSourceMeta = {
    ...(fallback.rawSourceMeta || {}),
    ...(primary.rawSourceMeta || {})
  };

  return merged;
}

function isSufficientOpportunity(item) {
  return Boolean(toText(item?.title) && toText(item?.sourceUrl));
}

export function parseAmpOpportunityPage({ html, url, sitemapLastmod = '' }) {
  const $ = cheerio.load(html);
  const canonicalUrl = toText($('link[rel="canonical"]').attr('href')) || url;
  const categoryKey = getCategoryKeyFromUrl(canonicalUrl);
  const category = CATEGORY_LABELS[categoryKey] || 'External Opportunity';
  const organizerName = toText($('.hedr .cptn h2').first().text());
  const rawTitle = toText($('meta[property="og:title"]').attr('content'))
    || toText($('title').first().text())
    || toText($('.hedr .cptn h1').first().text());
  const derivedSlugTitle = deriveTitleFromCanonicalUrl(canonicalUrl, organizerName);
  const detailRoot = $('[id="detail-tab"] .default-editor').first();
  const description = collectStructuredText($, detailRoot);
  const metaDescription = toText($('meta[name="description"]').attr('content'));
  const regBoxFields = parseRegBoxFields($);
  const importantDates = parseImportantDates($);
  const eligibilityItems = $('.eligibility_sect .items > div').map((_, node) => toText($(node).text())).get();
  const roundText = collectStructuredText($, $('.timeline').first());
  const combinedText = [description, roundText].filter(Boolean).join('\n');
  const fallbackTitle = derivedSlugTitle || rawTitle;
  const title = isGenericTitle(rawTitle, category) ? fallbackTitle : rawTitle;
  const registrationDeadline = parseUnstopDate(
    regBoxFields.get('registration deadline')
    || regBoxFields.get('application deadline')
    || importantDates.find((item) => /registration deadline|application deadline/i.test(item.label))?.value
  );
  const startDate = importantDates.find((item) => !/registration deadline|application deadline/i.test(item.label))?.parsedDate || null;
  const mode = deriveModeFromText(combinedText);
  const location = guessLocationFromOrganizer(organizerName);
  const teamSizeText = regBoxFields.get('team size') || '';
  const prizesText = parsePrizeText($);
  const summary = buildSummary(description, metaDescription);
  const posterUrl = toText($('meta[property="og:image"]').attr('content'))
    || toText($('.banner_sect amp-img').first().attr('src'));

  const parsed = {
    externalId: canonicalUrl.match(/-(\d+)(?:\/)?$/)?.[1] || '',
    sourceUrl: canonicalUrl,
    title,
    category,
    summary,
    description,
    organizerName,
    startDate,
    registrationDeadline,
    mode,
    location,
    venue: mode && mode !== 'Online' ? organizerName : '',
    teamSizeText,
    prizesText,
    eligibilityText: eligibilityItems.join(', '),
    posterUrl,
    tags: dedupeStrings([
      category,
      mode,
      ...eligibilityItems.slice(0, 4)
    ]),
    status: deriveExternalStatus({
      startDate,
      registrationDeadline
    }),
    rawSourceMeta: {
      categoryKey,
      sitemapLastmod,
      registrationCountText: regBoxFields.get('registered') || '',
      usedAmpPage: true
    }
  };

  return parsed;
}

function buildAmpUrl(canonicalUrl) {
  return canonicalUrl.endsWith('/') ? `${canonicalUrl}amp` : `${canonicalUrl}/amp`;
}

export async function fetchUnstopOpportunities({
  maxUrls = 50,
  cutoffDate = null,
  logger,
  delayMs = 350
} = {}) {
  const sitemapIndexXml = await fetchText(SITEMAP_INDEX_URL);
  const sitemapEntries = parseSitemapIndex(sitemapIndexXml).filter((entry) => isOpportunitySitemap(entry.loc));
  const candidates = [];
  const seenUrls = new Set();

  logger?.info(`Found ${sitemapEntries.length} Unstop opportunity sitemap files.`);

  for (const sitemapEntry of sitemapEntries) {
    if (candidates.length >= maxUrls) {
      break;
    }

    logger?.debug(`Reading sitemap ${sitemapEntry.loc}`);
    const sitemapXml = await fetchText(sitemapEntry.loc);
    const urlEntries = parseUrlSet(sitemapXml);

    for (const entry of urlEntries) {
      if (!isRelevantOpportunityUrl(entry.loc) || seenUrls.has(entry.loc)) {
        continue;
      }

      const lastModified = toDate(entry.lastmod);
      if (cutoffDate && lastModified && lastModified.getTime() < cutoffDate.getTime()) {
        continue;
      }

      seenUrls.add(entry.loc);
      candidates.push(entry);

      if (candidates.length >= maxUrls) {
        break;
      }
    }
  }

  logger?.info(`Collected ${candidates.length} candidate Unstop URLs.`);

  const items = [];
  const errors = [];

  for (const candidate of candidates) {
    try {
      const ampUrl = buildAmpUrl(candidate.loc);
      const ampHtml = await fetchText(ampUrl);
      let parsed = parseAmpOpportunityPage({
        html: ampHtml,
        url: candidate.loc,
        sitemapLastmod: candidate.lastmod
      });

      if (!isSufficientOpportunity(parsed)) {
        const canonicalHtml = await fetchText(candidate.loc);
        const fallback = parseCanonicalFallbackPage(canonicalHtml, candidate.loc);
        parsed = mergeFallback(parsed, fallback);
      }

      if (!isSufficientOpportunity(parsed)) {
        throw new Error('Unable to extract enough public metadata from this opportunity.');
      }

      items.push(buildNormalizedExternalEvent('unstop', parsed));
      logger?.debug(`Parsed ${parsed.title} (${candidate.loc})`);
    } catch (error) {
      errors.push({
        url: candidate.loc,
        message: error.message
      });
      logger?.warn(`Skipped ${candidate.loc}: ${error.message}`);
    }

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return {
    items,
    candidateCount: candidates.length,
    errors
  };
}
