// The recommended bet: for every bet the user logs, the same stake on the team our team score favours, at that
// team's odds. The score is recomputed from the prediction's snapshots with the current weights (no DB change), like
// Compare scored it: with the team meta (hero pool) when the snapshots hold it, without head-to-head.
import { snapshotTeam } from './predictions'
import { computeScore, type ScoreInput, type ScoreSettings } from './score'
import { SCORE_RULES } from './scoreRules'
import type { Prediction, PredictionDetail } from './types'

// Shown above the Predictions table
export const RECOMMENDED_NOTE =
  '"Recommended bet" is done automatically for the team with better score from the statistics.'

/** Team score of a prediction from its snapshots (positive = team 1 favoured). */
export const snapshotScore = (detail: PredictionDetail, settings: ScoreSettings = {}): number => {
  const snapshots = [detail.team1_snapshot, detail.team2_snapshot]
  return computeScore(
    {
      teams: snapshots.map((s) => ({ team: snapshotTeam(s), summary: s.data.summary, meta: s.data.meta })) as ScoreInput['teams'],
      now: detail.created_at,
    },
    SCORE_RULES,
    settings,
  ).score
}

/** Team (1 or 2) a score favours, or null when it is exactly even. */
export const favouredBy = (score: number): 1 | 2 | null => (score === 0 ? null : score > 0 ? 1 : 2)

/** Team (1 or 2) our score favours for a prediction, or null when the score is exactly even. */
export const favouredTeam = (detail: PredictionDetail, settings: ScoreSettings = {}): 1 | 2 | null =>
  favouredBy(snapshotScore(detail, settings))

/**
 * The recommended bet for a prediction, shaped like the user's prediction so the outcome and totals helpers work on it:
 * the user's stake on the favoured team, or no bet when the user made none or the score is even. A draw (Bo2 1-1)
 * loses, as for the user's bets.
 * @param prediction the user's prediction
 * @param team team our score favours (favouredTeam)
 * @returns the recommended prediction
 */
export const recommendedPrediction = (prediction: Prediction, team: 1 | 2 | null): Prediction => {
  const betTeam = prediction.bet_team === null || prediction.stake === null ? null : team
  const [won1, won2] = [prediction.team1_maps_won, prediction.team2_maps_won]
  const settled = betTeam !== null && won1 !== null && won2 !== null
  const winner = won1 === won2 ? null : (won1 ?? 0) > (won2 ?? 0) ? 1 : 2
  return {
    ...prediction,
    bet_team: betTeam,
    stake: betTeam === null ? null : prediction.stake,
    bet_won: settled ? winner === betTeam : null,
  }
}
