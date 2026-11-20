import { beforeEach, describe, expect, it } from 'vitest'
import {
  computeScore,
  expectedValue,
  fairProbabilities,
  favour,
  isValueBet,
  mapWinProbability,
  seriesWinProbability,
  type ScoreInput,
  type ScoreRule,
  type ScoreTeam,
} from './score'
import { SCORE_RULES, SCORE_SETTINGS_KEY, cleanScoreSettings, headToHeadWins, loadScoreSettings, saveScoreSettings } from './scoreRules'
import type { MatchesSummary, TeamData } from './types'

const NOW = 1_800_000_000
const DAY = 24 * 3600

const summary = (fields: Partial<MatchesSummary>): MatchesSummary => ({
  rating_matches: 0,
  tournament_matches: 0,
  other_matches: 0,
  matches_median: null,
  matches_avg: null,
  win_percentage: null,
  rating_win_percentage: null,
  tournament_win_percentage: null,
  avg_rank: null,
  bad_rank_players: null,
  ...fields,
})

const farm = (gpm: number) => ({
  games: 10,
  gold_per_min_top1: gpm,
  gold_per_min_top2: gpm,
  xp_per_min_top1: gpm,
  xp_per_min_top2: gpm,
})

const sample = (heroes: number) => ({
  games: 15,
  heroes,
  meta2_games_pct: null,
  meta3_games_pct: null,
  meta_picks_pct: null,
  start: null,
  window: 'recent' as const,
})

// The worked example of the method doc: Team A vs Team B
const teamA: ScoreTeam = {
  team: {
    rating: 1450,
    delta: 18,
    rating_change: 40,
    roster_source: 'recent_matches',
    roster_state: 'stable',
    roster_last_match_time: NOW - 3 * DAY,
    league_form: {
      days: 20,
      matches: 18,
      wins: 13,
      losses: 5,
      win_percentage: 72,
      last_match_time: NOW - 3 * DAY,
      duration_median: 38 * 60,
      farm: farm(630),
    },
  },
  summary: summary({
    rating_matches: 120,
    tournament_matches: 90,
    rating_win_percentage: 52,
    tournament_win_percentage: 60,
    avg_rank: 300,
    bad_rank_players: 0,
    matches_avg: 40,
    matches_median: 40,
  }),
  meta: { pool_state: 'normal', sample: sample(38) },
}
const teamB: ScoreTeam = {
  team: {
    rating: 1350,
    delta: -12,
    rating_change: -10,
    roster_source: 'recent_matches',
    roster_state: 'standins',
    roster_last_match_time: NOW - 5 * DAY,
    league_form: {
      days: 20,
      matches: 18,
      wins: 9,
      losses: 9,
      win_percentage: 50,
      last_match_time: NOW - 5 * DAY,
      duration_median: 34 * 60,
      farm: farm(600),
    },
  },
  summary: summary({
    rating_matches: 150,
    tournament_matches: 60,
    rating_win_percentage: 55,
    tournament_win_percentage: 50,
    avg_rank: 500,
    bad_rank_players: 1,
    matches_avg: 40,
    matches_median: 40,
  }),
  meta: { pool_state: 'narrow', sample: sample(33) },
}
const example: ScoreInput = { teams: [teamA, teamB], now: NOW }

const score = (input: ScoreInput) => computeScore(input, SCORE_RULES)
const points = (input: ScoreInput) => Object.fromEntries(score(input).metrics.map((m) => [m.key, m.points]))
const withTeams = (a: Partial<TeamData>, b: Partial<TeamData>): ScoreInput => ({ teams: [{ team: a }, { team: b }], now: NOW })

describe('computeScore', () => {
  it('scores the worked example metric by metric', () => {
    const p = points(example)
    expect(p.rating).toBe(0) // gap 100, counts only above 300
    expect(p.last_match_rating).toBe(5) // gap 30 > 14
    expect(p.rating_change).toBeCloseTo(6.25) // 50 / 64 x 8
    expect(p.roster).toBe(5) // stand-ins without a player list count as 1 stand-in: mediocre
    expect(p.tournament_win_pct).toBeCloseTo(5.867, 3) // huge (8): A is above 70%
    expect(p.gold_per_min_top1).toBe(0) // 5%: counts only over 12%
    expect(p.last_match).toBe(0)
    expect(p.rating_matches).toBeCloseTo(-1) // -25% / 50% x 2
    expect(p.tournament_matches).toBeCloseTo(0.75)
    expect(p.pub_win_pct).toBe(0) // neither above 60%
    expect(p.lobby_win_pct).toBe(1)
    expect(p.avg_rank).toBe(5)
    expect(p.low_rank_players).toBe(5)
    expect(p.matches_avg).toBe(0)
    expect(p.matches_median).toBe(0)
    expect(p.hero_pool).toBe(1)
    expect(p.duration).toBeCloseTo(1.6)
    expect(p.head_to_head).toBeUndefined() // no games: skipped
  })

  it('sums the example to +35 with nearly full coverage', () => {
    const result = score(example)
    expect(result.score).toBeCloseTo(35.467, 3)
    expect(result.coverage).toBeCloseTo(96 / 98) // all but head-to-head (low, 2)
  })

  it('is symmetric: swapping the teams flips the sign', () => {
    expect(score({ ...example, teams: [teamB, teamA] }).score).toBeCloseTo(-35.467, 3)
  })

  it('skips metrics without data and reports zero coverage for empty teams', () => {
    const result = score({ teams: [{}, {}], now: NOW })
    expect(result).toEqual({ score: 0, coverage: 0, metrics: [] })
  })

  it('counts rating only above a 300 gap', () => {
    expect(points(withTeams({ rating: 1700 }, { rating: 1350 })).rating).toBe(2)
    expect(points(withTeams({ rating: 1350 }, { rating: 1700 })).rating).toBe(-2)
  })

  it('counts last match rating only above a 14 gap', () => {
    expect(points(withTeams({ delta: 10 }, { delta: -4 })).last_match_rating).toBe(0)
    expect(points(withTeams({ delta: -10 }, { delta: 5 })).last_match_rating).toBe(-5)
  })

  it('makes tournament win % huge when a team is under 30%', () => {
    const form = (win_percentage: number) => ({ days: 20, matches: 10, wins: 0, losses: 0, win_percentage, last_match_time: null })
    expect(points(withTeams({ league_form: form(55) }, { league_form: form(25) })).tournament_win_pct).toBe(8)
    expect(points(withTeams({ league_form: form(55) }, { league_form: form(40) })).tournament_win_pct).toBe(2.5)
  })

  it('gives the last match edge to the team that played within 15 days', () => {
    const recent = { roster_last_match_time: NOW - 2 * DAY }
    expect(points(withTeams(recent, { roster_last_match_time: NOW - 20 * DAY })).last_match).toBe(5)
    expect(points(withTeams({ roster_last_match_time: null }, recent)).last_match).toBe(-5)
    expect(points(withTeams({ roster_last_match_time: NOW - 30 * DAY }, { roster_last_match_time: NOW - 20 * DAY })).last_match).toBe(0)
  })

  it('counts pub win % only when a team is above 60%', () => {
    const pub = (rating_win_percentage: number): ScoreTeam => ({ summary: summary({ rating_win_percentage }) })
    expect(points({ teams: [pub(62), pub(58)], now: NOW }).pub_win_pct).toBe(5)
    expect(points({ teams: [pub(65), pub(70)], now: NOW }).pub_win_pct).toBe(-2.5)
    expect(points({ teams: [pub(66), pub(55)], now: NOW }).pub_win_pct).toBe(8) // over 65% and gap over 10: high
  })

  it('weighs lobby win % high when a team is over 65% and the gap is over 10%', () => {
    const lobby = (tournament_win_percentage: number): ScoreTeam => ({ summary: summary({ tournament_win_percentage }) })
    expect(points({ teams: [lobby(70), lobby(59)], now: NOW }).lobby_win_pct).toBe(8)
    expect(points({ teams: [lobby(70), lobby(60)], now: NOW }).lobby_win_pct).toBe(1) // gap 10: normal, 10 / 20 x 2
    expect(points({ teams: [lobby(40), lobby(64)], now: NOW }).lobby_win_pct).toBe(-2) // nobody over 65%
  })

  it('weighs roster changes by stand-ins: 1 mediocre, 2+ high, new team high', () => {
    const player = (id: number, is_core: boolean, games = 5) => ({ id, name: `#${id}`, games, is_core })
    const core = [1, 2, 3, 4, 5].map((id) => player(id, true))
    const roster = (roster_state: TeamData['roster_state'], standins: number): Partial<TeamData> => ({
      roster_source: 'recent_matches',
      roster_state,
      players: [...core, ...Array.from({ length: standins }, (_, i) => player(10 + i, false))],
    })
    expect(points(withTeams(roster('stable', 0), roster('standins', 1))).roster).toBe(5)
    expect(points(withTeams(roster('standins', 2), roster('stable', 0))).roster).toBe(-8)
    expect(points(withTeams(roster('standins', 1), roster('standins', 3))).roster).toBe(3) // 8 - 5
    expect(points(withTeams(roster('standins', 2), roster('new_team', 0))).roster).toBe(0)
    expect(points(withTeams(roster('stable', 0), roster('new_team', 0))).roster).toBe(8)
  })

  it('counts median matches per player only at a gap of 14 or more', () => {
    const median = (matches_median: number): ScoreTeam => ({ summary: summary({ matches_median }) })
    expect(points({ teams: [median(19), median(25)], now: NOW }).matches_median).toBe(0)
    expect(points({ teams: [median(39), median(25)], now: NOW }).matches_median).toBe(5)
  })

  it('counts GPM and XPM only when they differ by more than 12%', () => {
    const form = (gpm: number) => ({ league_form: { days: 20, matches: 10, wins: 5, losses: 5, win_percentage: 50, last_match_time: null, farm: farm(gpm) } })
    expect(points(withTeams(form(565), form(500))).gold_per_min_top1).toBe(2) // 13%
    expect(points(withTeams(form(560), form(500))).gold_per_min_top1).toBe(0) // 12%
  })

  it('weighs low rank players by the gap: 1 mediocre, 2+ high', () => {
    const low = (bad_rank_players: number): ScoreTeam => ({ summary: summary({ bad_rank_players }) })
    expect(points({ teams: [low(0), low(2)], now: NOW }).low_rank_players).toBe(8)
    expect(points({ teams: [low(1), low(0)], now: NOW }).low_rank_players).toBe(-5)
  })

  it('uses head-to-head from 2 games', () => {
    expect(points({ ...example, headToHead: { team1Wins: 1, team2Wins: 0 } }).head_to_head).toBeUndefined()
    expect(points({ ...example, headToHead: { team1Wins: 2, team2Wins: 1 } }).head_to_head).toBeCloseTo(2 / 3)
  })
})

describe('rule settings', () => {
  const rule: ScoreRule = {
    key: 'gap',
    name: 'Gap',
    levels: { base: 'low', big: 'high' },
    limits: { gap: 10 },
    apply: (input, ctx) => {
      const [a, b] = input.teams.map((t) => t.team?.rating ?? 0)
      return { edge: 1, weight: ctx.weight(Math.abs(a - b) > ctx.limit('gap') ? 'big' : 'base') }
    },
  }
  const input = withTeams({ rating: 1020 }, { rating: 1000 })

  it('uses the default levels and limits', () => {
    expect(computeScore(input, [rule])).toEqual({ score: 8, coverage: 1, metrics: [{ key: 'gap', name: 'Gap', edge: 1, weight: 8, points: 8 }] })
  })

  it('applies changed levels, limits and points', () => {
    expect(computeScore(input, [rule], { rules: { gap: { limits: { gap: 50 } } } }).score).toBe(2)
    expect(computeScore(input, [rule], { rules: { gap: { levels: { big: 'none' } } } }).score).toBe(0)
    expect(computeScore(input, [rule], { points: { high: 10 } }).score).toBe(10)
  })

  it('every table rule has a unique key and only known levels', () => {
    const keys = SCORE_RULES.map((r) => r.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual([
      'rating',
      'last_match_rating',
      'rating_change',
      'roster',
      'tournament_win_pct',
      'gold_per_min_top1',
      'gold_per_min_top2',
      'xp_per_min_top1',
      'xp_per_min_top2',
      'last_match',
      'rating_matches',
      'tournament_matches',
      'pub_win_pct',
      'lobby_win_pct',
      'avg_rank',
      'low_rank_players',
      'matches_avg',
      'matches_median',
      'hero_pool',
      'duration',
      'head_to_head',
    ])
  })
})

describe('headToHeadWins', () => {
  it('counts only known results before the prediction', () => {
    const match = (team1_won: boolean | null, before_prediction: boolean) => ({ match_id: 1, start_time: 0, team1_won, before_prediction })
    const data = { since: 0, matches: [match(true, true), match(false, true), match(true, false), match(null, true), match(true, true)] }
    expect(headToHeadWins(data)).toEqual({ team1Wins: 2, team2Wins: 1 })
  })
})

describe('probabilities', () => {
  it('turns a score into a map chance', () => {
    expect(mapWinProbability(0)).toBe(0.5)
    expect(mapWinProbability(34.967)).toBeCloseTo(0.631, 3)
    expect(mapWinProbability(-34.967)).toBeCloseTo(0.369, 3)
  })

  it('turns a map chance into a series chance', () => {
    expect(seriesWinProbability(0.6, 1)).toBeCloseTo(0.6)
    expect(seriesWinProbability(0.6, null)).toBeCloseTo(0.6)
    expect(seriesWinProbability(0.6, 3)).toBeCloseTo(0.648) // p^2 (3 - 2p)
    expect(seriesWinProbability(0.6, 5)).toBeCloseTo(0.68256) // p^3 (10 - 15p + 6p^2)
    expect(seriesWinProbability(0.6, 2)).toBeNull()
  })

  it('labels the favour by the favourite share', () => {
    expect(favour(0.52)).toBe('even')
    expect(favour(0.4)).toBe('slight')
    expect(favour(0.7)).toBe('clear')
    expect(favour(0.723)).toBe('strong')
  })
})

describe('bookmaker comparison', () => {
  it('removes the margin from the odds', () => {
    const fair = fairProbabilities(1.65, 2.2)
    expect(fair?.team1).toBeCloseTo(0.5714, 4)
    expect(fair?.team2).toBeCloseTo(0.4286, 4)
    expect(fair?.margin).toBeCloseTo(0.0606, 4)
    expect(fairProbabilities(1, 2)).toBeNull()
  })

  it('finds the value bet of the worked example', () => {
    const series = seriesWinProbability(mapWinProbability(score(example).score), 3) ?? 0
    expect(series).toBeCloseTo(0.695, 3)
    expect(favour(series)).toBe('clear')
    const ev = expectedValue(series, 1.65)
    expect(ev).toBeCloseTo(0.146, 3)
    expect(isValueBet(ev, score(example).coverage)).toBe(true)
    expect(isValueBet(expectedValue(1 - series, 2.2), 1)).toBe(false)
  })

  it('does not flag value under 60% coverage', () => {
    expect(isValueBet(0.2, 0.5)).toBe(false)
    expect(isValueBet(0.05, 1)).toBe(false) // must be above +5%
  })
})

describe('score settings storage', () => {
  beforeEach(() => localStorage.clear())

  it('keeps only settings the current rules have', () => {
    const raw = {
      points: { low: 3, none: 1, giant: 9, high: 'x' },
      scale: 0,
      rules: {
        rating: { levels: { big: 'high', small: 'low' }, limits: { gap: 250, other: 1 } },
        roster: { levels: { base: 'enormous' } },
        removed_row: { levels: { base: 'low' } },
      },
    }
    expect(cleanScoreSettings(raw)).toEqual({ points: { low: 3 }, rules: { rating: { levels: { big: 'high' }, limits: { gap: 250 } } } })
    expect(cleanScoreSettings(null)).toEqual({})
  })

  it('saves, loads and removes the settings', () => {
    saveScoreSettings({ scale: 200, rules: { roster: { levels: { one: 'low' } } } })
    expect(JSON.parse(localStorage.getItem(SCORE_SETTINGS_KEY) ?? '{}')).toEqual({ scale: 200, rules: { roster: { levels: { one: 'low' } } } })
    expect(loadScoreSettings()).toEqual({ scale: 200, rules: { roster: { levels: { one: 'low' } } } })
    saveScoreSettings({})
    expect(localStorage.getItem(SCORE_SETTINGS_KEY)).toBeNull()
  })

  it('loads nothing from broken storage', () => {
    localStorage.setItem(SCORE_SETTINGS_KEY, '{not json')
    expect(loadScoreSettings()).toEqual({})
  })
})
