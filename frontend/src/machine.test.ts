import { describe, expect, it } from 'vitest'
import { favouredTeam, machinePrediction } from './machine'
import { prediction, predictionDetail, snapshot } from './test/predictionFixtures'

const form = (win_percentage: number) => ({ days: 20, matches: 10, wins: 0, losses: 0, win_percentage, last_match_time: null })

// Team 2: rating change +40 vs -10 and tournament win % 80 vs 50
const detail = predictionDetail({
  team1_snapshot: snapshot(7, { team: 'Team A', team_id: 1, rating_change: -10, league_form: form(50) }),
  team2_snapshot: snapshot(8, { team: 'Team B', team_id: 2, rating_change: 40, league_form: form(80) }),
})

describe('favouredTeam', () => {
  it('picks the team our score favours from the snapshots', () => {
    expect(favouredTeam(detail)).toBe(2)
  })

  it('uses the weights editor settings and gives null for an even score', () => {
    const none = { levels: { base: 'none' as const, extreme: 'none' as const } }
    expect(favouredTeam(detail, { rules: { rating_change: none, tournament_win_pct: none } })).toBeNull()
  })
})

describe('machinePrediction', () => {
  it("bets the user's stake on the favoured team at its odds", () => {
    const machine = machinePrediction(prediction({ bet_team: 1, stake: 50, team1_maps_won: 2, team2_maps_won: 1 }), 2)
    expect(machine).toMatchObject({ bet_team: 2, stake: 50, bet_won: false, team2_odds: 2.05 })
    expect(machinePrediction(prediction({ bet_team: 2, team1_maps_won: 0, team2_maps_won: 2 }), 2).bet_won).toBe(true)
  })

  it('is pending before the result and loses a Bo2 draw', () => {
    expect(machinePrediction(prediction(), 1).bet_won).toBeNull()
    const draw = prediction({ best_of: 2, team1_maps_won: 1, team2_maps_won: 1 })
    expect(machinePrediction(draw, 1).bet_won).toBe(false)
  })

  it('makes no bet when the user made none or the score is even', () => {
    expect(machinePrediction(prediction({ bet_team: null, stake: null }), 1)).toMatchObject({ bet_team: null, stake: null })
    expect(machinePrediction(prediction(), null)).toMatchObject({ bet_team: null, stake: null, bet_won: null })
  })
})
