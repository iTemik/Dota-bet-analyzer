// Team score: Team Comparison metrics → one weighted score → win probability → comparison with bookmaker odds.
// Method and Artem's weights: project research doc team-score-method.md (rev 3). Pure functions, no UI.
// Weights are Artem's words: none 0, low 2, mediocre 5, high 8, huge 12.
// Left out on purpose (weight none): Other Matches, Meta state, Radiant Win % (sides unknown before the draft),
// player lists, tag and ID.
import { ROSTER_STATES } from "./roster";
import type { FarmStats, MatchesSummary, TeamData, TeamMeta } from "./types";

export const WEIGHT = {
  none: 0,
  low: 2,
  mediocre: 5,
  high: 8,
  huge: 12,
} as const;

export const SCORE_SCALE = 150; // confidence knob: map % = 1 / (1 + 10^(-score / SCORE_SCALE)); bigger = more cautious
export const VALUE_BET_MIN_EV = 0.05; // expected value above +5% is a value bet
export const LOW_COVERAGE = 0.6; // under 60% of the weight with data, the result is low confidence
const DAY = 24 * 3600;

/** One team's data as the Compare page and saved snapshots hold it; every part may be missing. */
export interface ScoreTeam {
  team?: Partial<TeamData> | null;
  summary?: MatchesSummary | null;
  meta?: TeamMeta | null;
}

export interface ScoreInput {
  teams: [ScoreTeam, ScoreTeam];
  now: number; // unix time the Last Match date is judged at
  headToHead?: { team1Wins: number; team2Wins: number } | null;
}

/** What one metric added: edge -1..+1 (+ favours team 1), the weight that applied, points = edge x weight. */
export interface MetricScore {
  key: string;
  label: string;
  edge: number;
  weight: number;
  points: number;
}

export interface TeamScore {
  score: number; // sum of points, + favours team 1
  coverage: number; // 0..1, share of the metrics' maximum weight that had data for both teams
  metrics: MetricScore[]; // metrics with data for both teams, in list order
}

type Applied = { edge: number; weight: number };

interface ScoreMetric {
  key: string;
  label: string;
  maxWeight: number; // for coverage
  // null when a value is missing for either team; edge is from team 1's side
  apply: (input: ScoreInput) => Applied | null;
}

const clamp = (x: number): number => Math.max(-1, Math.min(1, x));
const scaled = (gap: number, bigGap: number): number => clamp(gap / bigGap);
const full = (gap: number): number => Math.sign(gap);
const present = (x: number | null | undefined): x is number =>
  typeof x === "number" && Number.isFinite(x);

// Difference as a share of the smaller value (like the comparison colours), scaled by bigShare
const shareGap = (a: number, b: number, bigShare: number): number => {
  const smaller = Math.min(a, b);
  if (smaller <= 0) return a === b ? 0 : full(a - b);
  return scaled((a - b) / smaller / bigShare, 1);
};

// A metric that reads one number per team and turns the two into an edge and weight
const pair =
  (
    pick: (t: ScoreTeam, input: ScoreInput) => number | null | undefined,
    rule: (a: number, b: number) => Applied,
  ) =>
  (input: ScoreInput): Applied | null => {
    const a = pick(input.teams[0], input);
    const b = pick(input.teams[1], input);
    return present(a) && present(b) ? rule(a, b) : null;
  };

const fixed =
  (weight: number, edge: (a: number, b: number) => number) =>
  (a: number, b: number) => ({ edge: edge(a, b), weight });

const leagueWinPct = (t: ScoreTeam) =>
  t.team?.league_form?.matches ? t.team.league_form.win_percentage : null;
const rosterRank = (t: ScoreTeam) =>
  t.team?.roster_source === "recent_matches" && t.team.roster_state
    ? ROSTER_STATES[t.team.roster_state]?.rank
    : null;
const lastMatchTime = (t: ScoreTeam) =>
  t.team?.roster_last_match_time ??
  t.team?.league_form?.last_match_time ??
  null;
const positive = (x: number | null | undefined) =>
  present(x) && x > 0 ? x : null; // 0 means no data

const farmMetric = (
  key: Exclude<keyof FarmStats, "games">,
  label: string,
): ScoreMetric => ({
  key,
  label,
  maxWeight: WEIGHT.low,
  apply: pair(
    (t) => positive(t.team?.league_form?.farm?.[key]),
    fixed(WEIGHT.low, (a, b) => shareGap(a, b, 0.2)),
  ),
});

// Artem's metrics and rules (doc rev 3); numbers match the Team Comparison row list
export const SCORE_METRICS: ScoreMetric[] = [
  {
    key: "rating", // 1: counts only above a 300 gap
    label: "Rating",
    maxWeight: WEIGHT.low,
    apply: pair(
      (t) => positive(t.team?.rating),
      (a, b) =>
        Math.abs(a - b) > 300
          ? { edge: full(a - b), weight: WEIGHT.low }
          : { edge: 0, weight: WEIGHT.none },
    ),
  },
  {
    key: "last_match_rating", // 2: counts only above a 14 gap
    label: "Last match rating",
    maxWeight: WEIGHT.mediocre,
    apply: pair(
      (t) => t.team?.delta,
      (a, b) =>
        Math.abs(a - b) > 14
          ? { edge: full(a - b), weight: WEIGHT.mediocre }
          : { edge: 0, weight: WEIGHT.none },
    ),
  },
  {
    key: "rating_change", // 3
    label: "Rating change",
    maxWeight: WEIGHT.huge,
    apply: pair(
      (t) => t.team?.rating_change,
      fixed(WEIGHT.huge, (a, b) => scaled(a - b, 64)),
    ),
  },
  {
    key: "roster", // 4: Stable 0, Stand-ins 1, New team 2 (lower is better)
    label: "Roster changes",
    maxWeight: WEIGHT.mediocre,
    apply: pair(
      rosterRank,
      fixed(WEIGHT.mediocre, (a, b) => scaled(b - a, 2)),
    ),
  },
  {
    key: "tournament_win_pct", // 5: huge when either team is under 30% or over 70%
    label: "Tournament win %",
    maxWeight: WEIGHT.huge,
    apply: pair(leagueWinPct, (a, b) => ({
      edge: scaled(a - b, 30),
      weight: [a, b].some((x) => x < 30 || x > 70)
        ? WEIGHT.huge
        : WEIGHT.mediocre,
    })),
  },
  farmMetric("gold_per_min_top1", "Top 1 GPM"), // 6
  farmMetric("gold_per_min_top2", "Top 2 GPM"), // 7
  farmMetric("xp_per_min_top1", "Top 1 XPM"), // 8
  farmMetric("xp_per_min_top2", "Top 2 XPM"), // 9
  {
    key: "last_match", // 10: counts only when one team's last match is over 15 days old and the other's is not
    label: "Last match",
    maxWeight: WEIGHT.mediocre,
    apply: ({ teams, now }) => {
      const times = teams.map(lastMatchTime);
      if (times.every((time) => time === null)) return null;
      const [a, b] = times.map(
        (time) => time !== null && now - time <= 15 * DAY,
      );
      return a === b
        ? { edge: 0, weight: WEIGHT.none }
        : { edge: a ? 1 : -1, weight: WEIGHT.mediocre };
    },
  },
  {
    key: "rating_matches", // 11
    label: "Rating matches",
    maxWeight: WEIGHT.low,
    apply: pair(
      (t) => t.summary?.rating_matches,
      fixed(WEIGHT.low, (a, b) => shareGap(a, b, 0.5)),
    ),
  },
  {
    key: "tournament_matches", // 12: mediocre above an 80 game gap
    label: "Tournament + scrim matches",
    maxWeight: WEIGHT.mediocre,
    apply: pair(
      (t) => t.summary?.tournament_matches,
      (a, b) =>
        Math.abs(a - b) > 80
          ? { edge: full(a - b), weight: WEIGHT.mediocre }
          : { edge: scaled(a - b, 80), weight: WEIGHT.low },
    ),
  },
  {
    key: "pub_win_pct", // 13: counts only when a team is above 60%
    label: "Pub win %",
    maxWeight: WEIGHT.mediocre,
    apply: pair(
      (t) => t.summary?.rating_win_percentage,
      (a, b) => {
        if (a > 60 && b > 60)
          return { edge: scaled(a - b, 10), weight: WEIGHT.mediocre };
        if (a > 60 || b > 60)
          return { edge: a > 60 ? 1 : -1, weight: WEIGHT.mediocre };
        return { edge: 0, weight: WEIGHT.none };
      },
    ),
  },
  {
    key: "lobby_win_pct", // 14
    label: "Lobby win %",
    maxWeight: WEIGHT.low,
    apply: pair(
      (t) => t.summary?.tournament_win_percentage,
      fixed(WEIGHT.low, (a, b) => scaled(a - b, 20)),
    ),
  },
  {
    key: "avg_rank", // 15: lower is better; mediocre above a 100 gap
    label: "Average player rank",
    maxWeight: WEIGHT.mediocre,
    apply: pair(
      (t) => positive(t.summary?.avg_rank),
      (a, b) =>
        Math.abs(a - b) > 100
          ? { edge: full(b - a), weight: WEIGHT.mediocre }
          : { edge: scaled(b - a, 100), weight: WEIGHT.low },
    ),
  },
  {
    key: "low_rank_players", // 16: fewer is better; gap 1 mediocre, 2+ high
    label: "Low rank players",
    maxWeight: WEIGHT.high,
    apply: pair(
      (t) => t.summary?.bad_rank_players,
      (a, b) => {
        const gap = Math.abs(a - b);
        const weight =
          gap >= 2 ? WEIGHT.high : gap === 1 ? WEIGHT.mediocre : WEIGHT.none;
        return { edge: full(b - a), weight };
      },
    ),
  },
  {
    key: "matches_avg", // 18
    label: "Average matches per player",
    maxWeight: WEIGHT.low,
    apply: pair(
      (t) => t.summary?.matches_avg,
      fixed(WEIGHT.low, (a, b) => shareGap(a, b, 0.5)),
    ),
  },
  {
    key: "matches_median", // 19: mediocre at a 14+ gap
    label: "Median matches per player",
    maxWeight: WEIGHT.mediocre,
    apply: pair(
      (t) => t.summary?.matches_median,
      (a, b) =>
        Math.abs(a - b) >= 14
          ? { edge: full(a - b), weight: WEIGHT.mediocre }
          : { edge: scaled(a - b, 14), weight: WEIGHT.low },
    ),
  },
  {
    key: "hero_pool", // 20: only when both teams have a full sample
    label: "Hero pool",
    maxWeight: WEIGHT.low,
    apply: pair(
      (t) => (t.meta?.pool_state ? t.meta.sample?.heroes : null),
      fixed(WEIGHT.low, (a, b) => scaled(a - b, 10)),
    ),
  },
  {
    key: "duration", // 23: longer is better
    label: "Median match duration",
    maxWeight: WEIGHT.low,
    apply: pair(
      (t) => t.team?.league_form?.duration_median,
      fixed(WEIGHT.low, (a, b) => scaled(a - b, 300)),
    ),
  },
  {
    key: "head_to_head", // 25: only with 2+ games between the teams
    label: "Head-to-head",
    maxWeight: WEIGHT.low,
    apply: ({ headToHead }) => {
      if (!headToHead) return null;
      const games = headToHead.team1Wins + headToHead.team2Wins;
      return games >= 2
        ? {
            edge: (headToHead.team1Wins - headToHead.team2Wins) / games,
            weight: WEIGHT.low,
          }
        : null;
    },
  },
];

/**
 * Score of team 1 vs team 2: each metric's edge (-1..+1) times its weight, summed. Metrics without data are skipped.
 * @param input both teams' data, the time to judge the last match at, optional head-to-head wins
 * @returns score (+ favours team 1), coverage 0..1 and each metric's part
 */
export const computeScore = (input: ScoreInput): TeamScore => {
  const metrics: MetricScore[] = [];
  let covered = 0;
  let total = 0;
  for (const metric of SCORE_METRICS) {
    total += metric.maxWeight;
    const applied = metric.apply(input);
    if (!applied) continue;
    covered += metric.maxWeight;
    metrics.push({
      key: metric.key,
      label: metric.label,
      ...applied,
      points: applied.edge * applied.weight,
    });
  }
  const score = metrics.reduce((sum, m) => sum + m.points, 0);
  return { score, coverage: total ? covered / total : 0, metrics };
};

/**
 * Chance team 1 wins one map.
 * @param score team score, + favours team 1
 * @param scale confidence knob, bigger = closer to 50%
 * @returns probability 0..1
 */
export const mapWinProbability = (score: number, scale = SCORE_SCALE): number =>
  1 / (1 + 10 ** (-score / scale));

/**
 * Chance team 1 wins the series: first to (bestOf + 1) / 2 maps, maps independent.
 * @param mapProbability chance to win one map
 * @param bestOf 1, 3, 5... (null = 1)
 * @returns probability 0..1, or null for an even best-of (Bo2 can end in a draw)
 */
export const seriesWinProbability = (
  mapProbability: number,
  bestOf: number | null,
): number | null => {
  const n = bestOf ?? 1;
  if (n < 1 || n % 2 === 0) return null;
  const need = (n + 1) / 2;
  let total = 0;
  let ways = 1; // C(need - 1 + lost, lost)
  for (let lost = 0; lost < need; lost++) {
    if (lost > 0) ways = (ways * (need - 1 + lost)) / lost;
    total += ways * mapProbability ** need * (1 - mapProbability) ** lost;
  }
  return total;
};

export type Favour = "even" | "slight" | "clear" | "strong";

export const FAVOUR_LABELS: Record<Favour, string> = {
  even: "Even",
  slight: "Slight favourite",
  clear: "Clear favourite",
  strong: "Strong favourite",
};

/**
 * How big the favour is, from the favourite's series win chance.
 * @param probability team 1's chance (either side works: the favourite's share is used)
 * @returns even under 55%, slight under 62%, clear under 72%, else strong
 */
export const favour = (probability: number): Favour => {
  const p = Math.max(probability, 1 - probability);
  if (p < 0.55) return "even";
  if (p < 0.62) return "slight";
  if (p < 0.72) return "clear";
  return "strong";
};

/**
 * The bookmaker's fair chances with its margin taken out.
 * @param team1Odds decimal odds of team 1
 * @param team2Odds decimal odds of team 2
 * @returns fair team1/team2 probabilities (sum 1) and the margin (0.06 = 6%), or null for odds of 1 or less
 */
export const fairProbabilities = (
  team1Odds: number,
  team2Odds: number,
): { team1: number; team2: number; margin: number } | null => {
  if (!(team1Odds > 1 && team2Odds > 1)) return null;
  const raw1 = 1 / team1Odds;
  const raw2 = 1 / team2Odds;
  const sum = raw1 + raw2;
  return { team1: raw1 / sum, team2: raw2 / sum, margin: sum - 1 };
};

/**
 * Expected value of a 1-unit bet: our chance x odds - 1 (0.19 = +19% per unit).
 * @param probability our chance the team wins
 * @param odds decimal odds of that team
 * @returns expected profit per unit staked
 */
export const expectedValue = (probability: number, odds: number): number =>
  probability * odds - 1;

/**
 * A bet is highlighted when its expected value is above +5% and enough metrics had data.
 * @param ev expected value from expectedValue
 * @param coverage coverage from computeScore
 * @returns true for a value bet
 */
export const isValueBet = (ev: number, coverage: number): boolean =>
  ev > VALUE_BET_MIN_EV && coverage >= LOW_COVERAGE;
