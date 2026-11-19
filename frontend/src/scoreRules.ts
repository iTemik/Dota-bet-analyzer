// All team score rules, in table order: Team Comparison rows, Team Insights rows, then head-to-head.
// A rule lives in the row it scores, so a new row with `score` shows up here (in the score panel and the weights
// editor) by itself.
import { COMPARISON_SCORE_ROWS } from './components/ComparisonTable'
import { INSIGHT_SCORE_ROWS } from './components/InsightsTable'
import { WEIGHT, type ScoreRule, type ScoreSettings, type WeightLevel } from './score'
import type { HeadToHead } from './types'

/** Wins of each team in the head-to-head matches played before the prediction (unknown results skipped). */
export const headToHeadWins = (data: HeadToHead): { team1Wins: number; team2Wins: number } => {
  const before = data.matches.filter((m) => m.before_prediction && m.team1_won !== null)
  const team1Wins = before.filter((m) => m.team1_won).length
  return { team1Wins, team2Wins: before.length - team1Wins }
}

// Head-to-head table (prediction detail): (wins 1 - wins 2) / games, only with enough games between the teams
export const HEAD_TO_HEAD_SCORE_RULE: ScoreRule = {
  key: 'head_to_head',
  name: 'Head-to-head',
  levels: { base: 'low' },
  limits: { minGames: 2 },
  labels: { minGames: 'Minimum games' },
  apply: ({ headToHead }, ctx) => {
    if (!headToHead) return null
    const games = headToHead.team1Wins + headToHead.team2Wins
    if (!games || games < ctx.limit('minGames')) return null
    return { edge: (headToHead.team1Wins - headToHead.team2Wins) / games, weight: ctx.weight('base') }
  },
}

/** The tables the score reads, with every row (rule undefined = not scored), for the weights editor. */
export const SCORE_TABLES: { table: string; rows: { label: string; rule?: ScoreRule }[] }[] = [
  { table: 'Team Comparison', rows: COMPARISON_SCORE_ROWS },
  { table: 'Team Insights', rows: INSIGHT_SCORE_ROWS },
  { table: 'Head-to-head (prediction page)', rows: [{ label: HEAD_TO_HEAD_SCORE_RULE.name, rule: HEAD_TO_HEAD_SCORE_RULE }] },
]

export const SCORE_RULES: ScoreRule[] = SCORE_TABLES.flatMap((t) => t.rows.flatMap((row) => (row.rule ? [row.rule] : [])))

// Weights editor changes are kept in the browser, so they survive a reload
export const SCORE_SETTINGS_KEY = 'scoreSettings'

const isLevel = (x: unknown): x is WeightLevel => typeof x === 'string' && x in WEIGHT
const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

/**
 * Keep only settings the current rules still have: unknown rules, tiers, limits or bad values (an older version,
 * a removed row) are dropped, so a changed table never breaks the score.
 * @param raw settings as read from storage
 * @returns clean settings
 */
export const cleanScoreSettings = (raw: unknown): ScoreSettings => {
  const saved = (raw && typeof raw === 'object' ? raw : {}) as ScoreSettings
  const settings: ScoreSettings = {}
  const points = Object.entries(saved.points ?? {}).filter(([level, value]) => isLevel(level) && level !== 'none' && isNumber(value))
  if (points.length) settings.points = Object.fromEntries(points)
  if (isNumber(saved.scale) && saved.scale > 0) settings.scale = saved.scale
  const rules: NonNullable<ScoreSettings['rules']> = {}
  for (const rule of SCORE_RULES) {
    const override = saved.rules?.[rule.key]
    if (!override) continue
    const levels = Object.entries(override.levels ?? {}).filter(([tier, level]) => tier in rule.levels && isLevel(level))
    const limits = Object.entries(override.limits ?? {}).filter(([name, value]) => name in (rule.limits ?? {}) && isNumber(value))
    if (levels.length || limits.length) {
      rules[rule.key] = {
        ...(levels.length && { levels: Object.fromEntries(levels) }),
        ...(limits.length && { limits: Object.fromEntries(limits) }),
      }
    }
  }
  if (Object.keys(rules).length) settings.rules = rules
  return settings
}

/** Saved weights editor settings, cleaned; empty when nothing is saved or storage is unavailable. */
export const loadScoreSettings = (): ScoreSettings => {
  try {
    return cleanScoreSettings(JSON.parse(localStorage.getItem(SCORE_SETTINGS_KEY) ?? '{}'))
  } catch {
    return {}
  }
}

/** Save weights editor settings; empty settings remove the saved ones. */
export const saveScoreSettings = (settings: ScoreSettings): void => {
  try {
    if (Object.keys(settings).length) localStorage.setItem(SCORE_SETTINGS_KEY, JSON.stringify(settings))
    else localStorage.removeItem(SCORE_SETTINGS_KEY)
  } catch {
    // storage blocked: the change still applies until reload
  }
}
