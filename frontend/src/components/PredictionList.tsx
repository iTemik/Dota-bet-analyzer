import { useEffect, useMemo, useState } from 'react'
import { formatShortDateTime } from '../format'
import { requestJson } from '../api'
import { RECOMMENDED_NOTE, favouredBy, recommendedPrediction, snapshotScore } from '../recommended'
import { betTotals, isSettled, outcome, teamLabel } from '../predictions'
import { useScoreSettings } from '../scoreRules'
import { formatSigned } from '../format'
import type { Prediction, PredictionDetail } from '../types'
import { bestOfLabel, scoreLabel, usePage } from '../series'
import { Pager, TeamCells } from './seriesTable'
import FavourTag from './FavourTag'
import BetOutcome, { Loss, Profit, SIMULATION_NOTE } from './BetOutcome'

type Filter = 'all' | 'pending' | 'settled'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'settled', label: 'Settled' },
]

type Scores = Map<number, number> // prediction id -> team score from its snapshots (positive = team 1 favoured)

const hasBet = (p: Prediction): boolean => p.bet_team !== null && p.stake !== null

const RECOMMENDED = 'Recommended bet'

const betText = (p: Prediction): string => {
  if (p.bet_team === null) return 'No bet'
  const team = teamLabel(p.bet_team === 1 ? p.team1 : p.team2, p.bet_team - 1)
  return p.stake !== null ? `${team} · ${p.stake}` : team
}

/** Predictions, laid out like the Finished Matches table (time, Bo, teams, score), then odds, bet and outcome. */
function PredictionTable({ predictions, scores }: { predictions: Prediction[]; scores: Scores | null }) {
  const { page, pages, shown, setPage } = usePage(predictions)

  return (
    <>
      <table className="stats-table matches-table prediction-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Best of</th>
            <th colSpan={2}>Team #1</th>
            <th colSpan={2}>Team #2</th>
            <th>Score</th>
            <th>Odds</th>
            <th>Bet</th>
            <th>Outcome</th>
            <th>{RECOMMENDED}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((p) => {
            const result = outcome(p)
            const score = scores?.get(p.prediction_id)
            const team = score === undefined ? undefined : favouredBy(score)
            const recommended = score === undefined ? null : recommendedPrediction(p, team ?? null)
            return (
              <tr
                key={p.prediction_id}
                className="prediction-row-link"
                onClick={() => (window.location.hash = `#predictions/${p.prediction_id}`)}
              >
                <td>
                  <a href={`#predictions/${p.prediction_id}`}>{formatShortDateTime(p.created_at)}</a>
                </td>
                <td>{bestOfLabel(p.best_of)}</td>
                <TeamCells name={teamLabel(p.team1, 0)} logoUrl={p.team1.logo_url} />
                <TeamCells name={teamLabel(p.team2, 1)} logoUrl={p.team2.logo_url} />
                <td>{scoreLabel(p.team1_maps_won, p.team2_maps_won)}</td>
                <td>
                  {p.team1_odds} / {p.team2_odds}
                </td>
                <td>
                  {betText(p)}
                  {p.bet_team !== null && score !== undefined && (
                    <>
                      {team && <FavourTag favoured={p.bet_team === team} />}
                      <span className="team-score">{formatSigned(p.bet_team === 1 ? score : -score)}</span>
                    </>
                  )}
                </td>
                <td className={`outcome outcome-${result}`}>
                  <BetOutcome prediction={p} />
                </td>
                {recommended ? (
                  <td className={`outcome outcome-${outcome(recommended)}`}>
                    <BetOutcome prediction={recommended} />
                  </td>
                ) : (
                  <td>{hasBet(p) ? '...' : 'No bet'}</td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      <Pager page={page} pages={pages} setPage={setPage} />
    </>
  )
}

/** Totals line: bets with net result, won, lost and pending amounts. */
function Totals({ label, predictions, note }: { label: string; predictions: Prediction[]; note?: boolean }) {
  const outcomes = predictions.map(outcome)
  const count = (o: string) => outcomes.filter((x) => x === o).length
  const totals = betTotals(predictions)
  return (
    <p className="prediction-totals">
      {label}: Bets: {predictions.length - count('no_bet')} (
      {totals.net < 0 ? <Loss value={-totals.net} /> : <Profit value={totals.net} />}) · Won: {count('won')} (
      <Profit value={totals.won} />) · Lost: {count('lost')} (<Loss value={totals.lost} />) · Pending:{' '}
      {count('pending')} (<Profit value={totals.pendingProfit} />/<Loss value={totals.pendingLoss} />)
      {note && (
        <>
          {' '}
          <span className="simulation-badge">{SIMULATION_NOTE}</span>
        </>
      )}
    </p>
  )
}

/**
 * Team score of every prediction with a bet, from its snapshots (one GET /api/predictions/{id} each) and the current
 * score weights (a weights change recalculates it); null while loading.
 */
function useScores(predictions: Prediction[] | null): { scores: Scores | null; error: string | null } {
  const [details, setDetails] = useState<PredictionDetail[] | null>(null)
  const [settings] = useScoreSettings()
  const [error, setError] = useState<string | null>(null)
  const idsKey = predictions ? predictions.filter(hasBet).map((p) => p.prediction_id).join() : null

  useEffect(() => {
    if (idsKey === null) return
    let cancelled = false
    const ids = idsKey ? idsKey.split(',').map(Number) : []
    Promise.all(ids.map((id) => requestJson<PredictionDetail>(`/api/predictions/${id}`)))
      .then((details) => {
        if (cancelled) return
        setDetails(details)
      })
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [idsKey])

  const scores = useMemo(
    () => details && new Map(details.map((d) => [d.prediction_id, snapshotScore(d, settings)])),
    [details, settings],
  )
  return { scores, error }
}

/**
 * Predictions tab: every saved prediction, newest first, with a pending/settled filter and totals, next to the
 * recommended bets (the same stake on the team our score favours).
 */
function PredictionList() {
  const [predictions, setPredictions] = useState<Prediction[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const { scores, error: recommendedError } = useScores(predictions)

  useEffect(() => {
    let cancelled = false
    requestJson<Prediction[]>('/api/predictions')
      .then((data) => !cancelled && setPredictions(data))
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <div className="error-message">Failed to load predictions: {error}</div>
  if (!predictions) return <p>Loading predictions...</p>

  const filtered = predictions.filter((p) => filter === 'all' || (filter === 'settled') === isSettled(p))
  const recommended =
    scores && filtered.map((p) => recommendedPrediction(p, favouredBy(scores.get(p.prediction_id) ?? 0)))

  return (
    <section className="prediction-list">
      <div className="prediction-list-toolbar">
        <div className="filter-buttons" role="group" aria-label="Filter">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`secondary-btn ${filter === f.id ? 'active' : ''}`}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div>
          <Totals label="You" predictions={filtered} note />
          {recommended ? (
            <Totals label={RECOMMENDED} predictions={recommended} />
          ) : (
            <p className="prediction-totals">
              {RECOMMENDED}: {recommendedError ? `failed to load: ${recommendedError}` : 'loading...'}
            </p>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p>{predictions.length ? 'No predictions match this filter.' : 'No predictions yet. Log one on the Compare tab.'}</p>
      ) : (
        <>
          <p className="prediction-hint">{RECOMMENDED_NOTE}</p>
          <PredictionTable key={filter} predictions={filtered} scores={scores} />
        </>
      )}
    </section>
  )
}

export default PredictionList
