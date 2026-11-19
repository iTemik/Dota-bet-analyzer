import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prediction, predictionDetail, snapshot } from '../test/predictionFixtures'
import type { PredictionDetail } from '../types'
import CalibrationPanel from './CalibrationPanel'

const form = (win_percentage: number) => ({ days: 20, matches: 10, wins: 0, losses: 0, win_percentage, last_match_time: null })

// Score +14.25 for team 1: Bo3 58%, slight favourite; bookmaker fair 39% at odds 2.5 / 1.6
const detail = (id: number, team1Won: boolean): PredictionDetail =>
  predictionDetail({
    prediction_id: id,
    team1_snapshot: snapshot(7, { team: 'Team A', team_id: 1, rating_change: 40, league_form: form(80) }),
    team2_snapshot: snapshot(8, { team: 'Team B', team_id: 2, rating_change: -10, league_form: form(50) }),
    team1_odds: 2.5,
    team2_odds: 1.6,
    team1_maps_won: team1Won ? 2 : 0,
    team2_maps_won: team1Won ? 0 : 2,
  })

const mockDetails = (details: PredictionDetail[]) => {
  const fetchMock = vi.fn((url: string) => {
    const found = details.find((d) => url === `/api/predictions/${d.prediction_id}`)
    return found
      ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(found) })
      : Promise.reject(new Error(`Unexpected URL ${url}`))
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

const rowCells = (label: string) =>
  within(screen.getByText(label).closest('tr') as HTMLElement)
    .getAllByRole('cell')
    .map((cell) => cell.textContent)

describe('CalibrationPanel', () => {
  afterEach(() => localStorage.clear())

  it('loads only settled predictions and compares our chances with the bookmaker', async () => {
    const fetchMock = mockDetails([detail(1, true), detail(2, false)])
    const settled = (id: number) => prediction({ prediction_id: id, team1_maps_won: 2, team2_maps_won: 0 })
    render(<CalibrationPanel predictions={[settled(1), settled(2), prediction({ prediction_id: 3 })]} />)

    expect(await screen.findByText(/2 settled predictions, scored again/)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByText(/Fewer than 30 results: the numbers are still mostly luck\./)).toBeInTheDocument()
    // ours 0.581: (0.419² + 0.581²) / 2 = 0.257; bookmaker 0.390: (0.610² + 0.390²) / 2 = 0.262
    expect(rowCells('Brier score (lower is better, 0.25 = coin flip)')).toEqual([
      'Brier score (lower is better, 0.25 = coin flip)',
      '0.257',
      '0.262',
    ])
    expect(rowCells('Favourite won, all predictions')).toEqual(['Favourite won, all predictions', '50%', '50%'])
    expect(rowCells('Slight favourite')).toEqual(['Slight favourite', '2', '50%', '55-62%'])
    expect(rowCells('Strong favourite')).toEqual(['Strong favourite', '0', '-', '72%+'])
    // Team 1 value 0.581 x 2.5 - 1 = +45%, but coverage is low: no value bets
    expect(screen.getByText(/Value bets \(1 unit each\): 0, won 0, result 0\.00 units\./)).toBeInTheDocument()
  })

  it('says when no prediction can be judged yet', async () => {
    mockDetails([predictionDetail({ prediction_id: 1, best_of: 2, team1_maps_won: 1, team2_maps_won: 1 })])
    render(<CalibrationPanel predictions={[prediction({ prediction_id: 1, team1_maps_won: 1, team2_maps_won: 1 })]} />)
    expect(await screen.findByText(/No settled Bo1\/Bo3\/Bo5 predictions with a winner yet\./)).toBeInTheDocument()
  })

  it('shows a load error', async () => {
    mockDetails([])
    render(<CalibrationPanel predictions={[prediction({ prediction_id: 9, team1_maps_won: 2, team2_maps_won: 0 })]} />)
    expect(await screen.findByText(/Calibration: /)).toBeInTheDocument()
  })
})
