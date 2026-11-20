import { useState } from 'react'
import { CELL_NEGATIVE, CELL_POSITIVE, formatSigned, teamName } from '../format'
import {
  FAVOUR_LABELS,
  LOW_COVERAGE,
  WEIGHT,
  computeScore,
  expectedValue,
  fairProbabilities,
  favour,
  isValueBet,
  mapWinProbability,
  seriesWinProbability,
  type ScoreInput,
} from '../score'
import { SCORE_RULES, useScoreSettings } from '../scoreRules'
import type { MatchesSummary, TeamData, TeamMeta } from '../types'
import Bar from './Bar'
import Collapsible from './Collapsible'

interface ScorePanelProps {
  teams: (Partial<TeamData> | undefined)[] // team 1 and team 2
  summaries: (MatchesSummary | null | undefined)[]
  metas?: (TeamMeta | null | undefined)[] // without it (saved snapshots) the meta rules are skipped
  bestOf?: number | null // series length for the series chance (default Bo3; null = n/a, map chance only)
  now?: number // unix time the Last Match rule is judged at; a saved prediction passes its own time
  headToHead?: ScoreInput['headToHead']
  odds?: [number, number] | null // bookmaker's series-winner odds of team 1 and team 2: adds the fair chance and value rows
}

const percent = (p: number): string => `${Math.round(p * 100)}%`

/**
 * Team score of team 1 vs team 2 (closed until clicked): weighted rules of the table rows, the match win chance and
 * each rule's points.
 */
function ScorePanel({ teams, summaries, metas, bestOf = 3, now, headToHead, odds }: ScorePanelProps) {
  const [shownAt] = useState(() => Date.now() / 1000) // live statistics are judged at the time they were shown
  const [settings] = useScoreSettings()
  const barMax = Math.max(...Object.values({ ...WEIGHT, ...settings.points })) // one rule's top weight fills the bar
  const input: ScoreInput = {
    teams: [0, 1].map((i) => ({ team: teams[i], summary: summaries[i], meta: metas?.[i] })) as ScoreInput['teams'],
    now: now ?? shownAt,
    headToHead,
  }
  const { score, coverage, metrics } = computeScore(input, SCORE_RULES, settings)
  const map = mapWinProbability(score, settings.scale)
  const series = bestOf ? seriesWinProbability(map, bestOf) : null
  const names = [0, 1].map((i) => teamName(teams[i] as TeamData | undefined, i))
  const chance = series ?? map // match winner chance; the map chance when the series can be a draw or is unknown
  const label = FAVOUR_LABELS[favour(chance)]
  const favourite = score > 0 ? names[0] : names[1]
  const counted = metrics.filter((m) => m.points !== 0)
  const even = metrics.filter((m) => m.points === 0)
  const fair = odds ? fairProbabilities(odds[0], odds[1]) : null
  // Value needs a series chance: the odds are for the series winner (a Bo2 can end in a draw)
  const values = fair && odds && series !== null ? [expectedValue(series, odds[0]), expectedValue(1 - series, odds[1])] : null

  return (
    <div className="score-panel">
      <Collapsible title="Team Score">
        <p className="score-headline">
          {label === FAVOUR_LABELS.even ? label : `${favourite}: ${label.toLowerCase()}`} · score {formatSigned(score)}
        </p>
        <table className="stats-table score-table">
          <thead>
            <tr>
              <th></th>
              <th>{names[0]}</th>
              <th>{names[1]}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="row-label">Match win chance</td>
              <td>{percent(chance)}</td>
              <td>{percent(1 - chance)}</td>
            </tr>
            {fair && (
              <tr>
                <td className="row-label">Bookmaker fair chance</td>
                <td>{percent(fair.team1)}</td>
                <td>{percent(fair.team2)}</td>
              </tr>
            )}
            {values && (
              <tr>
                <td className="row-label">Value (per 1 unit staked)</td>
                {values.map((ev, i) => {
                  const valueBet = isValueBet(ev, coverage)
                  return (
                    <td key={i} className={valueBet ? CELL_POSITIVE : ev < 0 ? CELL_NEGATIVE : undefined}>
                      {`${ev > 0 ? '+' : ''}${Math.round(ev * 100)}%${valueBet ? ' · value bet' : ''}`}
                    </td>
                  )
                })}
              </tr>
            )}
            {counted.map((m) => (
              <tr key={m.key}>
                <td className="row-label">{m.name}</td>
                {[1, -1].map((side) => (
                  <td key={side}>
                    {Math.sign(m.points) === side && (
                      <span className="score-points">
                        <Bar value={Math.abs(m.points)} max={barMax} tone="good" label={`${m.name} points`} />
                        {formatSigned(Math.abs(m.points))}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="prediction-hint">
          Data for {percent(coverage)} of the weight
          {coverage < LOW_COVERAGE ? ': low confidence' : ''}.
          {even.length > 0 && ` Even or below their thresholds: ${even.map((m) => m.name).join(', ')}.`}
        </p>
        {fair && (
          <p className="prediction-hint">
            Bookmaker margin {(fair.margin * 100).toFixed(1)}%, removed from its chances. Value = our series chance × odds
            - 1; a value bet is above +5% with data for 60%+ of the weight.
            {!values && ' No value for this series length: the odds are for the series winner.'}
          </p>
        )}
        <p className="prediction-hint">
          Weights{settings.points || settings.scale || settings.rules ? ' (changed)' : ''}: <a href="#weights">Score weights</a>{' '}
          tab.
        </p>
      </Collapsible>
    </div>
  )
}

export default ScorePanel
