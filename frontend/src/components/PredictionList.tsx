import { useEffect, useState } from 'react'
import { formatShortDateTime } from '../format'
import { requestJson } from '../api'
import { RECOMMENDED_NOTE, favouredTeam, recommendedPrediction } from '../recommended'
import { betTotals, isSettled, outcome, teamLabel } from '../predictions'
import { loadScoreSettings } from '../scoreRules'
import type { Prediction, PredictionDetail } from '../types'
import { bestOfLabel, scoreLabel, usePage } from '../series'
import { Pager, TeamCells } from './seriesTable'
import BetOutcome, { Loss, Profit, SIMULATION_NOTE } from './BetOutcome'

type Filter = 'all' | 'pending' | 'settled'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'settled', label: 'Settled' },
]

type Favoured = Map<number, 1 | 2 | null> // prediction id -> team our score favours

const hasBet = (p: Prediction): boolean => p.bet_team !== null && p.stake !== null

const RECOMMENDED = 'Recommended bet'

/** Short tag after the user's bet: green when the bet team is the one our score favours, red when it is not. */
function FavourTag({ prediction, team }: { prediction: Prediction; team: 1 | 2 | null | undefined }) {
  if (prediction.bet_team === null || !team) return null
  const favoured = prediction.bet_team === team
  return (
    <span
      className={`favour-tag ${favoured ? 'favour-tag-yes' : 'favour-tag-no'}`}
      title={favoured ? 'Bet on the team our score favours' : 'Bet against the team our score favours'}
    >
      {favoured ? 'Fav' : 'Not fav'}
    </span>
  )
}

const betText = (p: Prediction): string => {
  if (p.bet_team === null) return 'No bet'
  const team = teamLabel(p.bet_team === 1 ? p.team1 : p.team2, p.bet_team - 1)
  return p.stake !== null ? `${team} · ${p.stake}` : team
}

/** Predictions, laid out like the Finished Matches table (time, Bo, teams, score), then odds, bet and outcome. */
function PredictionTable({ predictions, favoured }: { predictions: Prediction[]; favoured: Favoured | null }) {
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
            const team = favoured?.get(p.prediction_id)
            const recommended = favoured?.has(p.prediction_id) ? recommendedPrediction(p, team ?? null) : null
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
                  <FavourTag prediction={p} team={team} />
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
 * Favoured team of every prediction with a bet, from its snapshots (one GET /api/predictions/{id} each) and the
 * current score weights; null while loading.
 */
function useFavoured(predictions: Prediction[] | null) {
  const [favoured, setFavoured] = useState<Favoured | null>(null)
  const [error, setError] = useState<string | null>(null)
  const idsKey = predictions ? predictions.filter(hasBet).map((p) => p.prediction_id).join() : null

  useEffect(() => {
    if (idsKey === null) return
    let cancelled = false
    const settings = loadScoreSettings()
    const ids = idsKey ? idsKey.split(',').map(Number) : []
    Promise.all(ids.map((id) => requestJson<PredictionDetail>(`/api/predictions/${id}`)))
      .then((details) => {
        if (cancelled) return
        setFavoured(new Map(details.map((d) => [d.prediction_id, favouredTeam(d, settings)])))
      })
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [idsKey])

  return { favoured, error }
}

/**
 * Predictions tab: every saved prediction, newest first, with a pending/settled filter and totals, next to the
 * recommended bets (the same stake on the team our score favours).
 */
function PredictionList() {
  const [predictions, setPredictions] = useState<Prediction[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const { favoured, error: recommendedError } = useFavoured(predictions)

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
  const recommended = favoured && filtered.map((p) => recommendedPrediction(p, favoured.get(p.prediction_id) ?? null))

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
          <PredictionTable key={filter} predictions={filtered} favoured={favoured} />
        </>
      )}
    </section>
  )
}

export default PredictionList
