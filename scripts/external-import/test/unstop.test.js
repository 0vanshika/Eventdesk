import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildExternalEventDocumentId,
  deriveExternalStatus
} from '../src/lib/normalize.js';
import { parseAmpOpportunityPage } from '../src/sources/unstop.js';
import {
  filterOpportunityFeed,
  normalizeExternalOpportunity,
  sortOpportunityFeed
} from '../../../js/opportunity-utils.js';

const sampleAmpHtml = `
<!doctype html>
<html amp lang="en">
  <head>
    <title>Hackathon - 2026</title>
    <link rel="canonical" href="https://unstop.com/hackathons/hackathon-e-summit-2026-international-institute-of-information-technology-iiit-naya-raipur-1644918">
    <meta name="description" content="Find out the best Hackathon that match your interests.">
    <meta property="og:title" content="Hackathon - 2026">
    <meta property="og:image" content="https://cdn.example.com/banner.png">
  </head>
  <body>
    <div class="hedr">
      <div class="cptn">
        <h1>Hackathon</h1>
        <h2><a>International Institute of Information Technology (IIIT), Naya Raipur</a></h2>
      </div>
    </div>
    <div class="reg_box">
      <div class="item">
        <div class="text">Registered <strong>755</strong></div>
      </div>
      <div class="item">
        <div class="text">Registration Deadline <strong>11 Mar'26, 11:59 PM IST</strong></div>
      </div>
      <div class="item">
        <div class="text">Team Size <strong>2 - 4 Members</strong></div>
      </div>
    </div>
    <div class="eligibility_sect">
      <div class="items">
        <div>Engineering Students</div>
        <div>Postgraduate</div>
        <div>Undergraduate</div>
      </div>
    </div>
    <div class="timeline">
      <h2 class="hdng">Hackathon: Stages and Timelines</h2>
      <div class="round-info">
        <h3>Online Submission Round</h3>
        <p>This will be an online submission round.</p>
      </div>
      <div class="round-info">
        <h3>Offline Round</h3>
        <p>Shortlisted teams will participate on campus.</p>
      </div>
    </div>
    <div id="detail-tab">
      <div class="default-editor">
        <p><strong>About the Opportunity:</strong></p>
        <ul>
          <li>A 36-hour continuous hackathon where participants design and develop technology-driven solutions.</li>
          <li>Focuses on endurance, rapid execution, scalability, and practical impact.</li>
        </ul>
        <p><strong>Eligibility:</strong></p>
        <ul>
          <li>Open to all undergraduate and postgraduate students.</li>
        </ul>
      </div>
    </div>
    <div id="prize-tab">
      <div class="prize_list">
        <h3>Winner</h3>
        <p>Cash prize for the winner.</p>
        <div class="trophy"><strong>10,000</strong></div>
        <div class="certificate">Pre-Placement Interview</div>
      </div>
    </div>
  </body>
</html>
`;

test('parseAmpOpportunityPage extracts normalized public fields', () => {
  const parsed = parseAmpOpportunityPage({
    html: sampleAmpHtml,
    url: 'https://unstop.com/hackathons/hackathon-e-summit-2026-international-institute-of-information-technology-iiit-naya-raipur-1644918',
    sitemapLastmod: '2026-04-01T10:00:00+00:00'
  });

  assert.equal(parsed.externalId, '1644918');
  assert.equal(parsed.category, 'Hackathon');
  assert.equal(parsed.organizerName, 'International Institute of Information Technology (IIIT), Naya Raipur');
  assert.equal(parsed.teamSizeText, '2 - 4 Members');
  assert.equal(parsed.mode, 'Hybrid');
  assert.equal(parsed.location, 'Naya Raipur');
  assert.match(parsed.title, /Hackathon E Summit 2026/i);
  assert.match(parsed.description, /36-hour continuous hackathon/i);
  assert.match(parsed.prizesText, /Winner/i);
  assert.ok(parsed.registrationDeadline instanceof Date);
});

test('document ids are deterministic', () => {
  assert.equal(
    buildExternalEventDocumentId({
      source: 'unstop',
      externalId: '1644918',
      sourceUrl: 'https://unstop.com/hackathons/example-1644918'
    }),
    'unstop_1644918'
  );
});

test('deriveExternalStatus closes expired opportunities', () => {
  const status = deriveExternalStatus({
    registrationDeadline: new Date('2020-01-01T00:00:00Z')
  });

  assert.equal(status, 'Closed');
});

test('mixed opportunity feed filtering and sorting works for campus and external entries', () => {
  const campusEvent = {
    id: 'campus-1',
    title: 'Campus Hack Night',
    category: 'Hackathon',
    description: 'Campus event',
    date: new Date('2026-04-10T10:00:00Z'),
    regDeadline: new Date('2026-04-08T10:00:00Z'),
    format: 'Offline',
    location: 'Delhi',
    teamSize: 4,
    sourceType: 'campus'
  };

  const externalEvent = normalizeExternalOpportunity({
    id: 'unstop_1',
    title: 'Open Innovation Challenge',
    category: 'Competition',
    summary: 'Apply on Unstop',
    description: 'External challenge',
    registrationDeadline: new Date('2026-04-05T10:00:00Z'),
    mode: 'Online',
    location: 'Remote',
    teamSizeText: '2 - 4 Members',
    source: 'unstop',
    sourceUrl: 'https://unstop.com/competitions/example-1'
  });

  const onlyExternal = filterOpportunityFeed([campusEvent, externalEvent], {
    source: 'external',
    format: 'Online'
  });
  assert.equal(onlyExternal.length, 1);
  assert.equal(onlyExternal[0].id, 'unstop_1');

  const sorted = sortOpportunityFeed([campusEvent, externalEvent], 'deadline');
  assert.equal(sorted[0].id, 'unstop_1');
});

test('external solo-friendly filters include ranges that allow one participant', () => {
  const externalEvent = normalizeExternalOpportunity({
    id: 'unstop_2',
    title: 'Open Trading Challenge',
    category: 'Competition',
    summary: 'Apply on Unstop',
    description: 'External challenge',
    mode: 'Online',
    teamSizeText: '1 - 5 Members',
    source: 'unstop',
    sourceUrl: 'https://unstop.com/competitions/example-2'
  });

  const filtered = filterOpportunityFeed([externalEvent], {
    source: 'external',
    format: 'Online',
    team: 'Solo'
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 'unstop_2');
});

test('external filters do not hide items when optional metadata is missing', () => {
  const externalEvent = normalizeExternalOpportunity({
    id: 'unstop_3',
    title: 'Mystery Challenge',
    category: 'Competition',
    summary: 'Apply on Unstop',
    description: 'External challenge',
    source: 'unstop',
    sourceUrl: 'https://unstop.com/competitions/example-3'
  });

  const filtered = filterOpportunityFeed([externalEvent], {
    source: 'external',
    format: 'Online',
    location: 'Remote',
    team: 'Team'
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 'unstop_3');
});
