import { useEffect, useState } from 'react'
import { requestJson } from '../api'
import { calibrate, calibrationItem, type CalibrationItem } from '../calibration'
import { isSettled } from '../predictions'
import { FAVOUR_LABELS, type Favour } from '../score'
import { loadScoreSettings } from '../scoreRules'
import type { Prediction, PredictionDetail } from '../types'

interface CalibrationPanelProps {
  predictions: Prediction[] // all predictions; only settled ones are read
}

const FEW_RESULTS = 30 // below this the numbers are mostly noise
const BAND_RANGES: Record<Favour, string> = { even: '50-55%', slight: '55-62%', clear: '62-72%', strong: '72%+' }
const percent = (p: number): string => `${Math.round(p * 100)}%`

/**
 * Score calibration on the Predictions tab: our team score recomputed for every settled prediction (saved snapshots,
 * current weights) next to the bookmaker's fair chances. Loads each settled prediction's snapshots.
 */
function CalibrationPanel({ predictions }: CalibrationPanelProps) {
  const [items, setItems] = useState<CalibrationItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const settledIds = predictions.filter(isSettled).map((p) => p.prediction_id)
  const idsKey = settledIds.join()

  useEffect(() => {
    let cancelled = false
    const settings = loadScoreSettings()
    const ids = idsKey ? idsKey.split(',') : []
    Promise.all(ids.map((id) => requestJson<PredictionDetail>(`/api/predictions/${id}`)))
      .then((details) => {
        if (cancelled) return
        setItems(details.flatMap((d) => calibrationItem(d, settings) ?? []))
      })
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [idsKey])

  if (error) return <div className="error-message">Calibration: {error}</div>
  if (!items) return <p>Loading settled predictions...</p>
  if (!items.length)
    return (
      <p className="prediction-hint">
        No settled Bo1/Bo3/Bo5 predictions with a winner yet. Add results with "Add review" on a prediction.
      </p>
    )

  const c = calibrate(items)
  return (
    <div className="calibration">
      <p className="prediction-hint">
        {c.count} settled prediction{c.count === 1 ? '' : 's'}, scored again from their snapshots with the current
        weights (meta and head-to-head are not in snapshots, so they are skipped).
        {c.count < FEW_RESULTS && ` Fewer than ${FEW_RESULTS} results: the numbers are still mostly luck.`}
      </p>
      <table className="stats-table calibration-table">
        <thead>
          <tr>
            <th></th>
            <th>Our score</th>
            <th>Bookmaker</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="row-label">Brier score (lower is better, 0.25 = coin flip)</td>
            <td className={c.brier.ours <= c.brier.bookmaker ? 'cell-pos' : undefined}>{c.brier.ours.toFixed(3)}</td>
            <td>{c.brier.bookmaker.toFixed(3)}</td>
          </tr>
          <tr>
            <td className="row-label">Favourite won, all predictions</td>
            <td>{percent(c.hits.ours)}</td>
            <td>{percent(c.hits.bookmaker)}</td>
          </tr>
        </tbody>
      </table>
      <table className="stats-table calibration-table">
        <thead>
          <tr>
            <th>Our label</th>
            <th>Predictions</th>
            <th>Favourite won</th>
            <th>Expected</th>
          </tr>
        </thead>
        <tbody>
          {c.bands.map((band) => (
            <tr key={band.favour}>
              <td className="row-label">{FAVOUR_LABELS[band.favour]}</td>
              <td>{band.count}</td>
              <td>{band.count ? percent(band.favouriteWon) : '-'}</td>
              <td>{BAND_RANGES[band.favour]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="prediction-hint">
        Value bets (1 unit each): {c.valueBets.count}, won {c.valueBets.won}, result{' '}
        {`${c.valueBets.profit > 0 ? '+' : ''}${c.valueBets.profit.toFixed(2)}`} units. If favourites win more often
        than expected, lower the confidence knob in Score weights; if less often, raise it.
      </p>
    </div>
  )
}

export default CalibrationPanel
