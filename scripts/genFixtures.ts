/**
 * Fixture generator for the "pricing-study" demo study.
 *
 * This is dev tooling: it turns a declarative schedule (per session, which
 * themes appear and how strongly they recur) into the session fixtures the
 * mock MCP server serves. Authoring the curve in one place keeps the saturation
 * story reproducible and tunable. Run:  npx tsx scripts/genFixtures.ts
 *
 * Each theme appears in a session in one of three modes, which control how much
 * NEW information it adds (and therefore the session's novelty):
 *   new    first appearance — canonical summary (≈ full novelty)
 *   angle  a reworded recurrence — shares some wording (≈ partial novelty)
 *   repeat near-verbatim recurrence — canonical summary again (≈ no novelty)
 */

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STUDY_DIR = join(ROOT, 'fixtures', 'studies', 'pricing-study');
const SESSIONS_DIR = join(STUDY_DIR, 'sessions');

type Mode = 'new' | 'angle' | 'angle2' | 'repeat';

interface ThemeDef {
  key: string;
  label: string;
  /** Canonical summary (used for new/repeat). */
  summary: string;
  /** Reworded summary for "angle" mode (shares roughly half the wording). */
  angle: string;
  /** A second, distinct angle so a theme can add a materially-new angle twice. */
  angle2?: string;
  /** Moderator question that surfaces the theme. */
  question: string;
  /** Pool of participant answers expressing the theme. */
  answers: string[];
}

const THEMES: Record<string, ThemeDef> = {
  pricing: {
    key: 'pricing_opacity',
    label: 'Pricing opacity erodes trust before the first invoice',
    summary:
      'Buyers cannot predict what the product will cost next quarter, so they stop advocating for it internally with their manager and finance.',
    angle:
      'Unpredictable renewal pricing makes the budget line impossible to defend to finance ahead of time.',
    angle2:
      'Without a firm number to give finance, the spend could not be pre-approved and the deal slipped a whole quarter.',
    question: 'How did pricing factor into your decision?',
    answers: [
      'The pricing was opaque — I genuinely could not forecast the cost for next quarter.',
      'Every time usage changed the bill moved, so budgeting for it was guesswork.',
    ],
  },
  onboarding: {
    key: 'onboarding_permissions',
    label: 'Onboarding stalls at the permissions handoff',
    summary:
      'New teams stall at the handoff between inviting teammates and granting the data access that an admin has to approve.',
    angle:
      'Admins get stuck deciding who is allowed to grant data access during the initial setup.',
    question: 'Walk me through getting your team set up.',
    answers: [
      'Inviting people was easy, but granting data access needed an admin and nobody knew who.',
      'Setup stalled on permissions — the handoff to whoever could approve access was unclear.',
    ],
  },
  integration: {
    key: 'integration_setup',
    label: 'Integration setup costs engineering time',
    summary:
      'Connecting the existing data warehouse and tools takes several engineering sessions to configure and sync correctly.',
    angle:
      'Wiring up the warehouse connection needed repeated engineering work before the sync was reliable.',
    question: 'How did connecting your existing tools go?',
    answers: [
      'The integration took our engineers a few sessions to configure and sync properly.',
      'Connecting the data warehouse was fiddly and ate real engineering time.',
    ],
  },
  reporting: {
    key: 'reporting_export',
    label: 'Reporting to stakeholders is manual',
    summary:
      'Sharing findings with stakeholders means exporting dashboards into slides and pdf by hand every week.',
    angle:
      'Getting results in front of stakeholders takes weekly manual export into slide decks.',
    question: 'How do you share results with stakeholders?',
    answers: [
      'Every week I export the dashboard to slides and a pdf by hand to share it up.',
      'Reporting out is manual — I rebuild the same deck for stakeholders each week.',
    ],
  },
  search: {
    key: 'search_relevance',
    label: 'Search returns noisy results',
    summary:
      'Finding the right past study or highlight returns noisy results that need manual filtering by tag and date.',
    angle:
      'Locating an old highlight means wading through irrelevant matches and filtering by hand.',
    question: 'How do you find past research in the tool?',
    answers: [
      'Search is noisy — I filter by tag and date manually to find the right study.',
      'Finding an old highlight returns too many irrelevant results.',
    ],
  },
  collaboration: {
    key: 'collaboration_comments',
    label: 'Async feedback gets lost',
    summary:
      'Teammates review and comment asynchronously but mentions and notifications get lost so feedback is missed.',
    angle:
      'Comment notifications slip through the cracks, so teammates miss feedback left for them.',
    question: 'How does your team collaborate on findings?',
    answers: [
      'People comment async, but mentions get buried so feedback gets missed.',
      'Notifications for comments are easy to miss, so review feedback falls through.',
    ],
  },
  mobile: {
    key: 'mobile_access',
    label: 'Mobile review lacks offline support',
    summary:
      'Reviewing sessions on a phone while travelling is awkward because the mobile experience lacks offline support.',
    angle:
      'On a phone without a connection the review experience falls apart for travelling researchers.',
    question: 'Do you ever review sessions on the go?',
    answers: [
      'On my phone while travelling it was awkward — no offline support for reviewing.',
      'The mobile experience needs offline access; reviewing on the go barely works.',
    ],
  },
  support: {
    key: 'support_latency',
    label: 'Support is slow under deadline',
    summary:
      'When something breaks the support ticket response is slow and chat help is hard to reach during a deadline.',
    angle:
      'Reaching support under a deadline is hard — ticket replies lag and chat is unstaffed.',
    question: 'What happened when you ran into a problem?',
    answers: [
      'Support was slow — the ticket sat and chat help was hard to reach on a deadline.',
      'When it broke before a readout, the slow support response really hurt.',
    ],
  },
  trust: {
    key: 'data_trust',
    label: 'Insights need citable sources',
    summary:
      'Teams hesitate to trust a synthesized insight without seeing the source quote and a citation they can verify.',
    angle:
      'Without a verifiable source quote behind it, a synthesized insight is hard to trust.',
    question: 'How much do you trust the synthesized insights?',
    answers: [
      'I will not trust an insight unless I can see the source quote and verify it.',
      'Synthesis is only useful if every claim links back to a citable quote.',
    ],
  },
  learning: {
    key: 'learning_curve',
    label: 'Powerful but steep to learn',
    summary:
      'New researchers find the tool powerful but complex, and want better training and documentation to ramp up.',
    angle:
      'Ramping new researchers is slow; the power comes with a steep learning curve and thin docs.',
    question: 'How was it for new people picking up the tool?',
    answers: [
      'It is powerful but complex — new researchers need more training and docs to ramp.',
      'The learning curve is steep; better documentation would help new folks.',
    ],
  },
};

interface ThemeRef {
  key: keyof typeof THEMES;
  mode: Mode;
  /** Exact verbatim quote to place (overrides the answer pool + timestamp). */
  signature?: { t: string; text: string };
  /** Stage an unfaithful quote the verifier should catch (claim != transcript). */
  unfaithfulClaim?: string;
}

interface SessionPlan {
  id: string;
  participant: { id: string; role: string; segment: string };
  durationSec: number;
  themes: ThemeRef[];
}

// Signature quotes mirror the citations on the marketing site.
const SCHEDULE: SessionPlan[] = [
  {
    id: 's1',
    participant: { id: 'P1', role: 'Researcher', segment: 'Enterprise' },
    durationSec: 1860,
    themes: [
      { key: 'pricing', mode: 'new' },
      { key: 'integration', mode: 'new' },
      { key: 'search', mode: 'new' },
    ],
  },
  {
    id: 's2',
    participant: { id: 'P2', role: 'Admin', segment: 'Mid-market' },
    durationSec: 1920,
    themes: [
      {
        key: 'onboarding',
        mode: 'new',
        signature: {
          t: '00:07:48',
          text: 'We sat in a meeting trying to figure out who could even click the button.',
        },
      },
      { key: 'reporting', mode: 'new' },
      { key: 'pricing', mode: 'angle' },
    ],
  },
  {
    id: 's3',
    participant: { id: 'P3', role: 'Researcher', segment: 'Enterprise' },
    durationSec: 1740,
    themes: [
      { key: 'collaboration', mode: 'new' },
      { key: 'integration', mode: 'angle' },
      { key: 'pricing', mode: 'repeat' },
    ],
  },
  {
    id: 's4',
    participant: { id: 'P4', role: 'Product Manager', segment: 'Enterprise' },
    durationSec: 1980,
    themes: [
      { key: 'trust', mode: 'new' },
      {
        key: 'pricing',
        mode: 'angle2',
        signature: {
          t: '00:18:22',
          text: "I couldn't tell my manager what this would cost us next quarter, so I stopped recommending it.",
        },
      },
      { key: 'reporting', mode: 'repeat' },
      { key: 'onboarding', mode: 'repeat' },
    ],
  },
  {
    id: 's5',
    participant: { id: 'P5', role: 'Researcher', segment: 'Mid-market' },
    durationSec: 1680,
    themes: [
      { key: 'pricing', mode: 'repeat' },
      { key: 'search', mode: 'repeat' },
      {
        key: 'learning',
        mode: 'new',
        // The extractor over-reaches on one quote; the verifier should catch it.
        unfaithfulClaim:
          'The onboarding was impossible and we almost churned in week one.',
      },
    ],
  },
  {
    id: 's6',
    participant: { id: 'P6', role: 'Admin', segment: 'Enterprise' },
    durationSec: 1800,
    themes: [
      {
        key: 'onboarding',
        mode: 'angle',
        signature: {
          t: '00:29:14',
          text: 'Nobody knew which admin was allowed to approve the data access, so onboarding stalled for a week.',
        },
      },
      { key: 'integration', mode: 'repeat' },
    ],
  },
  {
    id: 's7',
    participant: { id: 'P7', role: 'Product Manager', segment: 'Mid-market' },
    durationSec: 1860,
    themes: [
      {
        key: 'pricing',
        mode: 'repeat',
        signature: {
          t: '00:41:05',
          text: "Same story on renewal — finance asked for the number and I couldn't give them one.",
        },
      },
      { key: 'integration', mode: 'repeat' },
      { key: 'search', mode: 'angle' },
      { key: 'reporting', mode: 'repeat' },
    ],
  },
  {
    id: 's8',
    participant: { id: 'P8', role: 'Researcher', segment: 'Enterprise' },
    durationSec: 1620,
    themes: [
      { key: 'search', mode: 'repeat' },
      { key: 'collaboration', mode: 'repeat' },
      { key: 'trust', mode: 'repeat' },
    ],
  },
  {
    id: 's9',
    participant: { id: 'P9', role: 'Admin', segment: 'Enterprise' },
    durationSec: 1740,
    themes: [
      {
        key: 'onboarding',
        mode: 'repeat',
        signature: {
          t: '00:12:30',
          text: "Again it was the permissions handoff — we couldn't tell who had the rights to grant access.",
        },
      },
      { key: 'pricing', mode: 'repeat' },
      { key: 'reporting', mode: 'repeat' },
    ],
  },
  // s10–s14 exist so the study has 14 sessions (saturation cancels 5). The
  // happy-path run never reaches them; the "not saturated" scenario does, so
  // they carry valid low-novelty repeat content.
  {
    id: 's10',
    participant: { id: 'P10', role: 'Researcher', segment: 'Mid-market' },
    durationSec: 1560,
    themes: [
      { key: 'pricing', mode: 'repeat' },
      { key: 'support', mode: 'repeat' },
    ],
  },
  {
    id: 's11',
    participant: { id: 'P11', role: 'Product Manager', segment: 'Enterprise' },
    durationSec: 1500,
    themes: [
      { key: 'integration', mode: 'repeat' },
      { key: 'reporting', mode: 'repeat' },
    ],
  },
  {
    id: 's12',
    participant: { id: 'P12', role: 'Researcher', segment: 'Enterprise' },
    durationSec: 1620,
    themes: [
      { key: 'search', mode: 'repeat' },
      { key: 'trust', mode: 'repeat' },
    ],
  },
  {
    id: 's13',
    participant: { id: 'P13', role: 'Admin', segment: 'Mid-market' },
    durationSec: 1440,
    themes: [
      { key: 'onboarding', mode: 'repeat' },
      { key: 'mobile', mode: 'new' },
    ],
  },
  {
    id: 's14',
    participant: { id: 'P14', role: 'Researcher', segment: 'Enterprise' },
    durationSec: 1560,
    themes: [
      { key: 'pricing', mode: 'repeat' },
      { key: 'collaboration', mode: 'repeat' },
    ],
  },
];

// ─── Generation ─────────────────────────────────────────────────────────────

function tt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `00:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function summaryFor(def: ThemeDef, mode: Mode): string {
  if (mode === 'angle') return def.angle;
  if (mode === 'angle2') return def.angle2 ?? def.angle;
  return def.summary;
}

// Rotates each theme through its answer pool across the whole run, so the same
// theme yields different verbatim quotes in different sessions.
const themeOccurrences = new Map<string, number>();

function buildSession(plan: SessionPlan) {
  const lines: { line: number; t: string; speaker: string; text: string }[] = [];
  const themes: {
    key: string;
    label: string;
    summary: string;
    quotes: { line: number; claim?: string }[];
  }[] = [];

  let ln = 0;
  let clock = 12; // seconds; advances through the session
  const push = (speaker: string, text: string, t?: string) => {
    ln += 1;
    lines.push({ line: ln, t: t ?? tt(clock), speaker, text });
    clock += 70 + ((ln * 17) % 40);
    return ln;
  };

  push('Moderator', 'Thanks for making the time. To start, tell me about your work.');
  push(
    plan.participant.id,
    `I'm a ${plan.participant.role.toLowerCase()} on a ${plan.participant.segment.toLowerCase()} team.`,
  );

  for (let i = 0; i < plan.themes.length; i++) {
    const ref = plan.themes[i]!;
    const def = THEMES[ref.key]!;
    push('Moderator', def.question);
    const occ = themeOccurrences.get(def.key) ?? 0;
    themeOccurrences.set(def.key, occ + 1);
    const answer =
      ref.signature?.text ?? def.answers[occ % def.answers.length]!;
    const quoteLine = push(plan.participant.id, answer, ref.signature?.t);
    const quote: { line: number; claim?: string } = { line: quoteLine };
    if (ref.unfaithfulClaim) quote.claim = ref.unfaithfulClaim;
    themes.push({
      key: def.key,
      label: def.label,
      summary: summaryFor(def, ref.mode),
      quotes: [quote],
    });
  }

  push('Moderator', 'That’s really helpful — anything else before we wrap?');
  push(plan.participant.id, 'No, I think that covers the main pain points.');

  return {
    id: plan.id,
    studyId: 'pricing-study',
    participant: plan.participant,
    durationSec: plan.durationSec,
    transcript: lines,
    themes,
  };
}

function main() {
  themeOccurrences.clear();
  if (existsSync(SESSIONS_DIR)) rmSync(SESSIONS_DIR, { recursive: true, force: true });
  mkdirSync(SESSIONS_DIR, { recursive: true });

  for (const plan of SCHEDULE) {
    const session = buildSession(plan);
    writeFileSync(
      join(SESSIONS_DIR, `${plan.id}.json`),
      JSON.stringify(session, null, 2) + '\n',
    );
  }

  const study = {
    id: 'pricing-study',
    name: 'Pricing & Onboarding Discovery',
    description:
      'Discovery interviews on why mid-market and enterprise buyers stall before purchase: pricing predictability and onboarding friction.',
    sessions: SCHEDULE.map((s) => s.id),
  };
  writeFileSync(
    join(STUDY_DIR, 'study.json'),
    JSON.stringify(study, null, 2) + '\n',
  );

  console.log(
    `Generated ${SCHEDULE.length} sessions + study.json under fixtures/studies/pricing-study/`,
  );
}

main();
