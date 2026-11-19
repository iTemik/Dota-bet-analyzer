// Score calibration: how our team score did on settled predictions, next to the bookmaker's fair chances.
// Recomputed from the saved snapshots with the current weights (no DB change); meta and head-to-head rules are
// skipped because snapshots don't hold them.
import { snapshotTeam } from './predictions'
import {
  computeScore,
  expectedValue,
  fairProbabilities,
  favour,
  isValueBet,
  mapWinProbability,
  seriesWinProbability,
  type Favour,
  type ScoreInput,
  type ScoreSettings,
} from './score'
import { SCORE_RULES } from './scoreRules'
import type { PredictionDetail } from './types'

/** One settled prediction: chances that team 1 wins the series (ours and the bookmaker's) and the result. */
export interface CalibrationItem {
  ours: number
  bookmaker: number
  team1Won: boolean
  odds: [number, number]
  coverage: number
}

/**
 * The calibration item of a prediction, or null when it can't be judged: not settled, a draw, a series length
 * without a single winner (Bo2, n/a) or odds of 1 or less.
 * @param detail GET /api/predictions/{id}
 * @param settings weights editor settings
 * @returns the item or null
 */
export const calibrationItem = (detail: PredictionDetail, settings: ScoreSettings = {}): CalibrationItem | null => {
  const [won1, won2] = [detail.team1_maps_won, detail.team2_maps_won]
  if (won1 === null || won2 === null || won1 === won2) return null
  const fair = fairProbabilities(detail.team1_odds, detail.team2_odds)
  if (!fair || !detail.best_of) return null
  const snapshots = [detail.team1_snapshot, detail.team2_snapshot]
  const { score, coverage } = computeScore(
    {
      teams: snapshots.map((s) => ({ team: snapshotTeam(s), summary: s.data.summary })) as ScoreInput['teams'],
      now: detail.created_at,
    },
    SCORE_RULES,
    settings,
  )
  const ours = seriesWinProbability(mapWinProbability(score, settings.scale), detail.best_of)
  if (ours === null) return null
  return { ours, bookmaker: fair.team1, team1Won: won1 > won2, odds: [detail.team1_odds, detail.team2_odds], coverage }
}

export interface Calibration {
  count: number
  brier: { ours: number; bookmaker: number } // mean of (chance - result)^2: lower is better, 0.25 = coin flip
  hits: { ours: number; bookmaker: number } // share of predictions whose favourite won (exact 50% skipped)
  bands: { favour: Favour; count: number; favouriteWon: number }[] // by our favour label; favouriteWon is a share
  valueBets: { count: number; won: number; profit: number } // every highlighted value bet at 1 unit
}

const mean = (values: number[]): number => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0)
const brier = (items: CalibrationItem[], chance: (i: CalibrationItem) => number) =>
  mean(items.map((i) => (chance(i) - (i.team1Won ? 1 : 0)) ** 2))
const hitRate = (items: CalibrationItem[], chance: (i: CalibrationItem) => number) => {
  const judged = items.filter((i) => chance(i) !== 0.5)
  return mean(judged.map((i) => (chance(i) > 0.5 === i.team1Won ? 1 : 0)))
}
const FAVOURS: Favour[] = ['even', 'slight', 'clear', 'strong']

/**
 * Accuracy of our chances next to the bookmaker's over settled predictions.
 * @param items calibration items (calibrationItem)
 * @returns Brier scores, favourite hit rates, per favour band results and value-bet profit
 */
export const calibrate = (items: CalibrationItem[]): Calibration => {
  const bands = FAVOURS.map((label) => {
    const inBand = items.filter((i) => favour(i.ours) === label)
    const favouriteWon = inBand.filter((i) => (i.ours >= 0.5) === i.team1Won).length
    return { favour: label, count: inBand.length, favouriteWon: inBand.length ? favouriteWon / inBand.length : 0 }
  })
  const valueBets = { count: 0, won: 0, profit: 0 }
  for (const item of items) {
    ;[item.ours, 1 - item.ours].forEach((chance, side) => {
      if (!isValueBet(expectedValue(chance, item.odds[side]), item.coverage)) return
      const won = item.team1Won === (side === 0)
      valueBets.count += 1
      valueBets.won += won ? 1 : 0
      valueBets.profit += won ? item.odds[side] - 1 : -1
    })
  }
  return {
    count: items.length,
    brier: { ours: brier(items, (i) => i.ours), bookmaker: brier(items, (i) => i.bookmaker) },
    hits: { ours: hitRate(items, (i) => i.ours), bookmaker: hitRate(items, (i) => i.bookmaker) },
    bands,
    valueBets,
  }
}
