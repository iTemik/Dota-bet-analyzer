import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prediction, predictionDetail, snapshot } from '../test/predictionFixtures'
import { RECOMMENDED_NOTE } from '../recommended'
import PredictionList from './PredictionList'

const jsonResponse = (data: unknown, ok = true, status = ok ? 200 : 500) =>
  Promise.resolve({ ok, status, json: () => Promise.resolve(data) })

const predictions = [
  prediction({ prediction_id: 3 }),
  prediction({ prediction_id: 2, bet_team: null, stake: null, team1_maps_won: 1, team2_maps_won: 2 }),
  prediction({ prediction_id: 1, best_of: 5, team1_maps_won: 3, team2_maps_won: 1, bet_won: true }),
]

const form = (win_percentage: number) => ({ days: 20, matches: 10, wins: 0, losses: 0, win_percentage, last_match_time: null })

// Snapshots where our score favours team 2 (rating change and tournament win %)
const detail = (id: number) =>
  predictionDetail({
    ...predictions.find((p) => p.prediction_id === id),
    prediction_id: id,
    team1_snapshot: snapshot(7, { team: 'Team A', team_id: 1, rating_change: -10, league_form: form(50) }),
    team2_snapshot: snapshot(8, { team: 'Team B', team_id: 2, rating_change: 40, league_form: form(80) }),
  })

const mockList = (response = jsonResponse(predictions)) => {
  const fetchMock = vi.fn((url: string) => {
    const id = /\/api\/predictions\/(\d+)$/.exec(url)?.[1]
    return id ? jsonResponse(detail(Number(id))) : response
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

const rows = () => screen.getAllByRole('row').slice(1)

describe('PredictionList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.location.hash = '#predictions'
  })

  it('lists the predictions like the Finished Matches table, then odds, bet and outcome', async () => {
    const fetchMock = mockList()
    render(<PredictionList />)
    await screen.findByText(/^Recommended bet: Bets/)
    expect(fetchMock).toHaveBeenCalledWith('/api/predictions', undefined)
    expect(rows()).toHaveLength(3)

    const pending = within(rows()[0])
    expect(pending.getByRole('link')).toHaveAttribute('href', '#predictions/3')
    expect(pending.getByRole('link').textContent).toMatch(/^[A-Z][a-z]{2} \d+/)
    const cells = pending.getAllByRole('cell').map((c) => c.textContent)
    expect(cells.slice(1)).toEqual(['Bo3', '', 'Team A', '', 'Team B', '-', '1.85 / 2.05', 'Team A · 100Worse-14.3', 'Pending +85 / -100',
      'Pending +105 / -100'])

    expect(within(rows()[1]).getAllByText('No bet')).toHaveLength(3) // bet, outcome, recommended bet
    expect(within(rows()[1]).getByText('1:2')).toBeInTheDocument()
    expect(pending.getByText('+85')).toHaveClass('money-profit')
    expect(pending.getAllByText('-100')[0]).toHaveClass('money-loss')
    const won = within(rows()[2]).getAllByRole('cell').at(-2)
    expect(won).toHaveClass('outcome-won')
    expect(won).toHaveTextContent('Won +85')
  })

  it('shows totals and filters pending and settled predictions', async () => {
    mockList()
    render(<PredictionList />)
    await screen.findByRole('table')
    const totals = () => document.querySelector<HTMLElement>('.prediction-totals')!
    expect(totals()).toHaveTextContent(
      'Bets: 2 (+85) · Won: 1 (+85) · Lost: 0 (0) · Pending: 1 (+85/-100) Simulation: not real money',
    )
    expect(within(totals()).getAllByText('+85')[0]).toHaveClass('money-profit')
    expect(within(totals()).getByText('-100')).toHaveClass('money-loss')
    expect(within(totals()).getByText('-100')).toHaveAttribute('title', 'Simulation: not real money')

    await userEvent.click(screen.getByRole('button', { name: 'Settled' }))
    expect(rows()).toHaveLength(2)
    expect(totals()).toHaveTextContent(
      'Bets: 1 (+85) · Won: 1 (+85) · Lost: 0 (0) · Pending: 0 (0/0) Simulation: not real money',
    )

    await userEvent.click(screen.getByRole('button', { name: 'Pending' }))
    expect(rows()).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Pending' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(rows()).toHaveLength(3)
  })

  it('opens a prediction when its row is clicked', async () => {
    mockList()
    render(<PredictionList />)
    await screen.findByRole('table')
    await userEvent.click(within(rows()[2]).getByText('Bo5'))
    expect(window.location.hash).toBe('#predictions/1')
  })

  it('shows 10 predictions per page', async () => {
    mockList(jsonResponse(Array.from({ length: 12 }, (_, i) => prediction({ prediction_id: 100 - i }))))
    render(<PredictionList />)
    await screen.findByRole('table')
    expect(rows()).toHaveLength(10)
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(rows()).toHaveLength(2)
    expect(within(rows()[0]).getByRole('link')).toHaveAttribute('href', '#predictions/90')

    // A filter starts again from the first page
    await userEvent.click(screen.getByRole('button', { name: 'Pending' }))
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
  })

  it("shows the recommended bets: the user's stake on the team our score favours", async () => {
    const fetchMock = mockList()
    render(<PredictionList />)
    await screen.findByText(/^Recommended bet: Bets/)
    // details only for the predictions with a bet
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/predictions', '/api/predictions/3', '/api/predictions/1'])
    expect(screen.getByText(RECOMMENDED_NOTE)).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Recommended bet' })).toBeInTheDocument()
    const recommended = (row: number) => within(rows()[row]).getAllByRole('cell').at(-1)
    expect(recommended(1)).toHaveTextContent('No bet')
    expect(recommended(2)).toHaveTextContent('Lost -100')
    expect(recommended(2)).toHaveClass('outcome-lost')
    // the user bet on team 1, our score favours team 2
    expect(within(rows()[2]).getByText('Worse')).toHaveClass('favour-tag', 'favour-tag-no')
    const totals = document.querySelectorAll<HTMLElement>('.prediction-totals')
    expect(totals[0]).toHaveTextContent(/^You: Bets: 2 \(\+85\)/)
    expect(totals[1]).toHaveTextContent(
      'Recommended bet: Bets: 2 (-100) · Won: 0 (0) · Lost: 1 (-100) · Pending: 1 (+105/-100)',
    )
  })

  it('tags a bet on the favoured team green', async () => {
    mockList(jsonResponse([prediction({ prediction_id: 4, bet_team: 2 })]))
    render(<PredictionList />)
    expect(await screen.findByText('Better')).toHaveClass('favour-tag', 'favour-tag-yes')
  })

  it('says when the recommended bets fail to load', async () => {
    globalThis.fetch = vi.fn((url: string) =>
      url === '/api/predictions' ? jsonResponse(predictions) : jsonResponse({ message: 'Boom' }, false),
    ) as unknown as typeof fetch
    render(<PredictionList />)
    expect(await screen.findByText('Recommended bet: failed to load: Boom')).toBeInTheDocument()
    expect(within(rows()[0]).getAllByRole('cell').at(-1)).toHaveTextContent('...')
  })

  it('says when there are no predictions yet', async () => {
    mockList(jsonResponse([]))
    render(<PredictionList />)
    expect(await screen.findByText(/No predictions yet/)).toBeInTheDocument()
  })

  it('shows an error when the list fails to load', async () => {
    mockList(jsonResponse({ message: 'Database is locked' }, false))
    render(<PredictionList />)
    expect(await screen.findByText(/Failed to load predictions: Database is locked/)).toBeInTheDocument()
  })
})
