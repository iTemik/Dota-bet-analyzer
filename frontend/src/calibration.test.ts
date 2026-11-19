import { describe, expect, it } from 'vitest'
import { calibrate, calibrationItem, type CalibrationItem } from './calibration'
import { predictionDetail, snapshot } from './test/predictionFixtures'
import type { PredictionDetail } from './types'

const form = (win_percentage: number) => ({ days: 20, matches: 10, wins: 0, losses: 0, win_percentage, last_match_time: null })

// Team 1: rating change +40 vs -10 (6.25 points) and win % 80 vs 50 (8 points): score +14.25, Bo3 58.1%
const detail = (fields: Partial<PredictionDetail> = {}): PredictionDetail =>
  predictionDetail({
    team1_snapshot: snapshot(7, { team: 'Team A', team_id: 1, rating_change: 40, league_form: form(80) }),
    team2_snapshot: snapshot(8, { team: 'Team B', team_id: 2, rating_change: -10, league_form: form(50) }),
    team1_odds: 2.5,
    team2_odds: 1.6,
    team1_maps_won: 2,
    team2_maps_won: 1,
    ...fields,
  })

describe('calibrationItem', () => {
  it('scores a settled prediction from its snapshots next to the bookmaker fair chance', () => {
    const item = calibrationItem(detail())
    expect(item?.ours).toBeCloseTo(0.5814, 4)
    expect(item?.bookmaker).toBeCloseTo(0.3902, 4)
    expect(item?.team1Won).toBe(true)
    expect(item?.odds).toEqual([2.5, 1.6])
  })

  it('uses the weights editor settings', () => {
    const item = calibrationItem(detail(), { rules: { tournament_win_pct: { levels: { extreme: 'none' } } } })
    expect(item?.ours).toBeCloseTo(0.5357, 3) // only the rating change: score +6.25
  })

  it('skips predictions that cannot be judged', () => {
    expect(calibrationItem(detail({ team1_maps_won: null, team2_maps_won: null }))).toBeNull()
    expect(calibrationItem(detail({ best_of: 2, team1_maps_won: 1, team2_maps_won: 1 }))).toBeNull()
    expect(calibrationItem(detail({ best_of: null }))).toBeNull()
    expect(calibrationItem(detail({ best_of: 2, team1_maps_won: 2, team2_maps_won: 0 }))).toBeNull()
  })
})

const item = (ours: number, bookmaker: number, team1Won: boolean, odds: [number, number] = [2, 2], coverage = 1): CalibrationItem => ({
  ours,
  bookmaker,
  team1Won,
  odds,
  coverage,
})

describe('calibrate', () => {
  it('compares Brier scores and favourite hits', () => {
    const c = calibrate([item(0.8, 0.6, true), item(0.6, 0.7, false), item(0.5, 0.4, true)])
    expect(c.count).toBe(3)
    // ours: (0.2² + 0.6² + 0.5²) / 3, bookmaker: (0.4² + 0.7² + 0.6²) / 3
    expect(c.brier.ours).toBeCloseTo(0.65 / 3)
    expect(c.brier.bookmaker).toBeCloseTo(1.01 / 3)
    expect(c.hits.ours).toBeCloseTo(0.5) // 50% skipped: 1 of 2
    expect(c.hits.bookmaker).toBeCloseTo(1 / 3) // 0.6 won, 0.7 lost, 0.4 favoured team 2 but team 1 won
  })

  it('groups by our favour label', () => {
    const c = calibrate([item(0.8, 0.5, true), item(0.25, 0.5, true), item(0.58, 0.5, true), item(0.52, 0.5, false)])
    expect(c.bands).toEqual([
      { favour: 'even', count: 1, favouriteWon: 0 },
      { favour: 'slight', count: 1, favouriteWon: 1 },
      { favour: 'clear', count: 0, favouriteWon: 0 },
      { favour: 'strong', count: 2, favouriteWon: 0.5 },
    ])
  })

  it('adds up 1-unit value bets, only with enough data', () => {
    const c = calibrate([
      item(0.6, 0.4, true, [2.5, 1.6]), // team 1 value +50%: won, +1.5
      item(0.3, 0.5, true, [1.9, 2.2]), // team 2 value +54%: lost, -1
      item(0.6, 0.4, false, [2.5, 1.6], 0.5), // low coverage: not a value bet
    ])
    expect(c.valueBets).toEqual({ count: 2, won: 1, profit: 0.5 })
  })
})
