import { useState } from 'react'
import { formatSigned, teamName } from '../format'
import {
  FAVOUR_LABELS,
  LOW_COVERAGE,
  WEIGHT,
  computeScore,
  favour,
  mapWinProbability,
  seriesWinProbability,
  type ScoreInput,
} from '../score'
import { SCORE_RULES, loadScoreSettings, saveScoreSettings } from '../scoreRules'
import type { MatchesSummary, TeamData, TeamMeta } from '../types'
import Bar from './Bar'
import Collapsible from './Collapsible'
import ScoreWeightsEditor from './ScoreWeightsEditor'

interface ScorePanelProps {
  teams: (Partial<TeamData> | undefined)[] // team 1 and team 2
  summaries: (MatchesSummary | null | undefined)[]
  metas?: (TeamMeta | null | undefined)[] // without it (saved snapshots) the meta rules are skipped
  bestOf?: number | null // series length for the series chance (default Bo3)
  now?: number // unix time the Last Match rule is judged at; a saved prediction passes its own time
  headToHead?: ScoreInput['headToHead']
}

const percent = (p: number): string => `${Math.round(p * 100)}%`

/** Team score of team 1 vs team 2: weighted rules of the table rows, win chances and each rule's points. */
function ScorePanel({ teams, summaries, metas, bestOf = 3, now, headToHead }: ScorePanelProps) {
  const [shownAt] = useState(() => Date.now() / 1000) // live statistics are judged at the time they were shown
  const [settings, setSettings] = useState(loadScoreSettings)
  const changeSettings = (next: typeof settings) => {
    setSettings(next)
    saveScoreSettings(next)
  }
  const barMax = Math.max(...Object.values({ ...WEIGHT, ...settings.points })) // one rule's top weight fills the bar
  const input: ScoreInput = {
    teams: [0, 1].map((i) => ({ team: teams[i], summary: summaries[i], meta: metas?.[i] })) as ScoreInput['teams'],
    now: now ?? shownAt,
    headToHead,
  }
  const { score, coverage, metrics } = computeScore(input, SCORE_RULES, settings)
  const map = mapWinProbability(score, settings.scale)
  const series = seriesWinProbability(map, bestOf)
  const names = [0, 1].map((i) => teamName(teams[i] as TeamData | undefined, i))
  const label = FAVOUR_LABELS[favour(series ?? map)]
  const favourite = score > 0 ? names[0] : names[1]
  const counted = metrics.filter((m) => m.points !== 0)
  const even = metrics.filter((m) => m.points === 0)

  return (
    <div className="score-panel">
      <h2>Team Score</h2>
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
            <td className="row-label">Map win chance</td>
            <td>{percent(map)}</td>
            <td>{percent(1 - map)}</td>
          </tr>
          {series !== null && (
            <tr>
              <td className="row-label">Bo{bestOf ?? 1} win chance</td>
              <td>{percent(series)}</td>
              <td>{percent(1 - series)}</td>
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
      <Collapsible lazy title={`Score weights${settings.points || settings.scale || settings.rules ? ' (changed)' : ''}`}>
        <ScoreWeightsEditor settings={settings} onChange={changeSettings} />
      </Collapsible>
    </div>
  )
}

export default ScorePanel
