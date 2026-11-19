// Team score maths: rule edges x weights → one score → win probability → comparison with bookmaker odds.
// The rules themselves live in the table rows they score (`score` on Team Comparison / Team Insights rows), so a new
// row brings its rule along; scoreRules.ts collects them. Method: project research doc team-score-method.md.
import type { MatchesSummary, TeamData, TeamMeta } from './types'

// Artem's weight words in points (huge = high, Artem 2026-11-19)
export const WEIGHT = { none: 0, low: 2, mediocre: 5, high: 8, huge: 8 } as const
export type WeightLevel = keyof typeof WEIGHT

export const SCORE_SCALE = 150 // confidence knob: map % = 1 / (1 + 10^(-score / SCORE_SCALE)); bigger = more cautious
export const VALUE_BET_MIN_EV = 0.05 // expected value above +5% is a value bet
export const LOW_COVERAGE = 0.6 // under 60% of the weight with data, the result is low confidence

/** One team's data as the Compare page and saved snapshots hold it; every part may be missing. */
export interface ScoreTeam {
  team?: Partial<TeamData> | null
  summary?: MatchesSummary | null
  meta?: TeamMeta | null
}

export interface ScoreInput {
  teams: [ScoreTeam, ScoreTeam]
  now: number // unix time the Last Match date is judged at
  headToHead?: { team1Wins: number; team2Wins: number } | null
}

/** What a rule gives: edge -1..+1 from team 1's side (+ favours team 1) and the weight in points that applied. */
export interface Applied {
  edge: number
  weight: number
}

/** A rule's view of its settings: points of one of its weight tiers, value of one of its limits. */
export interface RuleContext {
  weight: (tier: string) => number
  limit: (name: string) => number
}

/** Scoring part of a table row. Tiers and limits are named so an editor can list and change them. */
export interface ScoreRule {
  key: string
  name: string // shown in the score panel
  levels: Record<string, WeightLevel> // default weight level per tier, e.g. { base: 'low', big: 'mediocre' }
  limits?: Record<string, number> // default thresholds and big gaps, e.g. { bigGap: 80 }
  apply: (input: ScoreInput, ctx: RuleContext) => Applied | null // null when a value is missing for either team
}

/** User changes on top of the defaults (weights editor); everything optional. */
export interface ScoreSettings {
  points?: Partial<Record<WeightLevel, number>>
  rules?: Record<string, { levels?: Record<string, WeightLevel>; limits?: Record<string, number> }>
}

/** What one rule added: points = edge x weight. */
export interface MetricScore {
  key: string
  name: string
  edge: number
  weight: number
  points: number
}

export interface TeamScore {
  score: number // sum of points, + favours team 1
  coverage: number // 0..1, share of the rules' top weight that had data for both teams
  metrics: MetricScore[] // rules with data for both teams, in list order
}

export const clamp = (x: number): number => Math.max(-1, Math.min(1, x))
/** gap / bigGap, cut to -1..+1 */
export const scaled = (gap: number, bigGap: number): number => clamp(gap / bigGap)
/** +1 / -1 toward the better team, 0 when even */
export const full = (gap: number): number => Math.sign(gap)
const present = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x)
/** 0 means no data */
export const positive = (x: number | null | undefined): number | null => (present(x) && x > 0 ? x : null)

/** Difference as a share of the smaller value (like the comparison colours), scaled by bigShare. */
export const shareGap = (a: number, b: number, bigShare: number): number => {
  const smaller = Math.min(a, b)
  if (smaller <= 0) return a === b ? 0 : full(a - b)
  return clamp((a - b) / smaller / bigShare)
}

/**
 * A rule that reads one number per team and turns the pair into an edge and weight.
 * @param pick the team's number (null or undefined = no data)
 * @param rule team 1's and team 2's numbers → edge and weight
 * @returns a ScoreRule `apply`
 */
export const pairRule =
  (
    pick: (t: ScoreTeam) => number | null | undefined,
    rule: (a: number, b: number, ctx: RuleContext) => Applied,
  ): ScoreRule['apply'] =>
  (input, ctx) => {
    const a = pick(input.teams[0])
    const b = pick(input.teams[1])
    return present(a) && present(b) ? rule(a, b, ctx) : null
  }

const ruleContext = (rule: ScoreRule, settings: ScoreSettings): RuleContext => {
  const override = settings.rules?.[rule.key]
  const points = { ...WEIGHT, ...settings.points }
  return {
    weight: (tier) => points[override?.levels?.[tier] ?? rule.levels[tier] ?? 'none'] ?? 0,
    limit: (name) => override?.limits?.[name] ?? rule.limits?.[name] ?? 0,
  }
}

/**
 * Score of team 1 vs team 2: each rule's edge (-1..+1) times its weight, summed. Rules without data are skipped.
 * @param input both teams' data, the time to judge the last match at, optional head-to-head wins
 * @param rules the rules to apply (scoreRules.ts SCORE_RULES)
 * @param settings weight and limit changes on top of the defaults
 * @returns score (+ favours team 1), coverage 0..1 and each rule's part
 */
export const computeScore = (input: ScoreInput, rules: ScoreRule[], settings: ScoreSettings = {}): TeamScore => {
  const metrics: MetricScore[] = []
  let covered = 0
  let total = 0
  for (const rule of rules) {
    const ctx = ruleContext(rule, settings)
    const top = Math.max(0, ...Object.keys(rule.levels).map(ctx.weight))
    total += top
    const applied = rule.apply(input, ctx)
    if (!applied) continue
    covered += top
    metrics.push({ key: rule.key, name: rule.name, ...applied, points: applied.edge * applied.weight })
  }
  const score = metrics.reduce((sum, m) => sum + m.points, 0)
  return { score, coverage: total ? covered / total : 0, metrics }
}

/**
 * Chance team 1 wins one map.
 * @param score team score, + favours team 1
 * @param scale confidence knob, bigger = closer to 50%
 * @returns probability 0..1
 */
export const mapWinProbability = (score: number, scale = SCORE_SCALE): number => 1 / (1 + 10 ** (-score / scale))

/**
 * Chance team 1 wins the series: first to (bestOf + 1) / 2 maps, maps independent.
 * @param mapProbability chance to win one map
 * @param bestOf 1, 3, 5... (null = 1)
 * @returns probability 0..1, or null for an even best-of (Bo2 can end in a draw)
 */
export const seriesWinProbability = (mapProbability: number, bestOf: number | null): number | null => {
  const n = bestOf ?? 1
  if (n < 1 || n % 2 === 0) return null
  const need = (n + 1) / 2
  let total = 0
  let ways = 1 // C(need - 1 + lost, lost)
  for (let lost = 0; lost < need; lost++) {
    if (lost > 0) ways = (ways * (need - 1 + lost)) / lost
    total += ways * mapProbability ** need * (1 - mapProbability) ** lost
  }
  return total
}

export type Favour = 'even' | 'slight' | 'clear' | 'strong'

export const FAVOUR_LABELS: Record<Favour, string> = {
  even: 'Even',
  slight: 'Slight favourite',
  clear: 'Clear favourite',
  strong: 'Strong favourite',
}

/**
 * How big the favour is, from the favourite's series win chance.
 * @param probability team 1's chance (either side works: the favourite's share is used)
 * @returns even under 55%, slight under 62%, clear under 72%, else strong
 */
export const favour = (probability: number): Favour => {
  const p = Math.max(probability, 1 - probability)
  if (p < 0.55) return 'even'
  if (p < 0.62) return 'slight'
  if (p < 0.72) return 'clear'
  return 'strong'
}

/**
 * The bookmaker's fair chances with its margin taken out.
 * @param team1Odds decimal odds of team 1
 * @param team2Odds decimal odds of team 2
 * @returns fair team1/team2 probabilities (sum 1) and the margin (0.06 = 6%), or null for odds of 1 or less
 */
export const fairProbabilities = (team1Odds: number, team2Odds: number): { team1: number; team2: number; margin: number } | null => {
  if (!(team1Odds > 1 && team2Odds > 1)) return null
  const raw1 = 1 / team1Odds
  const raw2 = 1 / team2Odds
  const sum = raw1 + raw2
  return { team1: raw1 / sum, team2: raw2 / sum, margin: sum - 1 }
}

/**
 * Expected value of a 1-unit bet: our chance x odds - 1 (0.14 = +14% per unit).
 * @param probability our chance the team wins
 * @param odds decimal odds of that team
 * @returns expected profit per unit staked
 */
export const expectedValue = (probability: number, odds: number): number => probability * odds - 1

/**
 * A bet is highlighted when its expected value is above +5% and enough rules had data.
 * @param ev expected value from expectedValue
 * @param coverage coverage from computeScore
 * @returns true for a value bet
 */
export const isValueBet = (ev: number, coverage: number): boolean => ev > VALUE_BET_MIN_EV && coverage >= LOW_COVERAGE
