// All team score rules, in table order: Team Comparison rows, Team Insights rows, then head-to-head.
// A rule lives in the row it scores, so a new row with `score` shows up here (and in the score panel) by itself.
import { COMPARISON_SCORE_RULES } from './components/ComparisonTable'
import { INSIGHT_SCORE_RULES } from './components/InsightsTable'
import type { ScoreRule } from './score'
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
  apply: ({ headToHead }, ctx) => {
    if (!headToHead) return null
    const games = headToHead.team1Wins + headToHead.team2Wins
    if (!games || games < ctx.limit('minGames')) return null
    return { edge: (headToHead.team1Wins - headToHead.team2Wins) / games, weight: ctx.weight('base') }
  },
}

export const SCORE_RULES: ScoreRule[] = [...COMPARISON_SCORE_RULES, ...INSIGHT_SCORE_RULES, HEAD_TO_HEAD_SCORE_RULE]
