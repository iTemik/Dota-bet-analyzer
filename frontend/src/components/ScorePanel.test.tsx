import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { SCORE_SETTINGS_KEY, saveScoreSettings } from '../scoreRules'
import type { LeagueForm, TeamData } from '../types'
import ScorePanel from './ScorePanel'

const form = (win_percentage: number): LeagueForm => ({
  days: 20,
  matches: 10,
  wins: 0,
  losses: 0,
  win_percentage,
  last_match_time: null,
})

const team = (name: string, rating_change: number, win: number): Partial<TeamData> => ({
  team: name,
  rating_change,
  league_form: form(win),
})

const scoreTable = () => within(document.querySelector('.score-table') as HTMLElement)
const rowCells = (label: string) =>
  within(scoreTable().getByText(label).closest('tr') as HTMLElement)
    .getAllByRole('cell')
    .map((cell) => cell.textContent)

describe('ScorePanel', () => {
  beforeEach(() => localStorage.clear())

  it('shows the favourite, win chances and each rule’s points in the favoured team’s column', () => {
    // rating change 50 / 64 x 8 = 6.25 for Alpha; win % 30 / 30 x 8 (huge: Alpha over 70%) = 8 for Alpha
    render(<ScorePanel teams={[team('Alpha', 40, 80), team('Beta', -10, 50)]} summaries={[null, null]} />)
    expect(screen.getByText('Alpha: slight favourite · score +14.3')).toBeInTheDocument()
    expect(rowCells('Match win chance')).toEqual(['Match win chance', '58%', '42%']) // Bo3 series chance
    expect(scoreTable().queryByText('Map win chance')).not.toBeInTheDocument()
    expect(rowCells('Rating change')).toEqual(['Rating change', '+6.3', ''])
    expect(rowCells('Tournament win %')).toEqual(['Tournament win %', '+8.0', ''])
    expect(screen.getByRole('progressbar', { name: 'Rating change points' })).toBeInTheDocument()
  })

  it('puts points of the second team in its column and labels the favour by the series chance', () => {
    // rating change 6.25 and win % 10 / 30 x 5 = 1.7 for Beta, team 2; Bo5 56% is slight (Bo3 would be 55%, even)
    render(<ScorePanel teams={[team('Alpha', -10, 50), team('Beta', 40, 60)]} summaries={[null, null]} bestOf={5} />)
    expect(screen.getByText('Beta: slight favourite · score -7.9')).toBeInTheDocument()
    expect(rowCells('Match win chance')).toEqual(['Match win chance', '44%', '56%'])
    expect(rowCells('Rating change')).toEqual(['Rating change', '', '+6.3'])
  })

  it('is closed until its header is clicked', async () => {
    render(<ScorePanel teams={[team('Alpha', 40, 80), team('Beta', -10, 50)]} summaries={[null, null]} />)
    const header = screen.getByRole('heading', { name: 'Team Score' })
    expect(document.querySelector('.score-panel .collapsible-content')).not.toHaveClass('expanded')
    await userEvent.click(header)
    expect(document.querySelector('.score-panel .collapsible-content')).toHaveClass('expanded')
  })

  it('shows only the map chance for Bo2 and lists rules that are even or below their thresholds', () => {
    render(
      <ScorePanel
        teams={[{ ...team('Alpha', 0, 50), rating: 1400 }, { ...team('Beta', 0, 50), rating: 1300 }]}
        summaries={[null, null]}
        bestOf={2}
      />,
    )
    expect(scoreTable().queryByText('Bo2 win chance')).not.toBeInTheDocument()
    expect(screen.getByText('Even · score 0.0')).toBeInTheDocument()
    expect(screen.getByText(/Even or below their thresholds: Rating, Rating change, Tournament win %\./)).toBeInTheDocument()
  })

  it('warns about low confidence when most rules have no data', () => {
    render(<ScorePanel teams={[team('Alpha', 40, 80), team('Beta', -10, 50)]} summaries={[null, null]} />)
    expect(screen.getByText(/Data for \d+% of the weight: low confidence\./)).toBeInTheDocument()
  })

  it('recalculates at once when the weights change (Score weights tab) and links to that tab', () => {
    render(<ScorePanel teams={[team('Alpha', 40, 80), team('Beta', -10, 50)]} summaries={[null, null]} />)
    expect(screen.getByRole('link', { name: 'Score weights' })).toHaveAttribute('href', '#weights')
    // rating change 50 / 64 x 2 = 1.6 instead of 6.3
    act(() => saveScoreSettings({ rules: { rating_change: { levels: { base: 'low' } } } }))
    expect(rowCells('Rating change')).toEqual(['Rating change', '+1.6', ''])
    expect(screen.getByText('Alpha: slight favourite · score +9.6')).toBeInTheDocument()
    expect(screen.getByText(/^Weights \(changed\):/)).toBeInTheDocument()
  })

  it('starts from the weights saved in the browser', () => {
    localStorage.setItem(SCORE_SETTINGS_KEY, JSON.stringify({ rules: { tournament_win_pct: { levels: { extreme: 'none' } } } }))
    render(<ScorePanel teams={[team('Alpha', 40, 80), team('Beta', -10, 50)]} summaries={[null, null]} />)
    expect(scoreTable().queryByText('Tournament win %')).not.toBeInTheDocument() // 0 points: listed as even
    expect(screen.getByText(/Even or below their thresholds: Tournament win %\./)).toBeInTheDocument()
  })

  describe('bookmaker rows', () => {
    const NOW = 1_800_000_000
    // Enough data for 67% of the weight: equal values everywhere except rating change and tournament win %
    const fullTeam = (name: string, rating_change: number, win: number): Partial<TeamData> => ({
      ...team(name, rating_change, win),
      rating: 1400,
      delta: 0,
      roster_source: 'recent_matches',
      roster_state: 'stable',
      roster_last_match_time: NOW - 86400,
      league_form: {
        ...form(win),
        duration_median: 2000,
        farm: { games: 10, gold_per_min_top1: 600, gold_per_min_top2: 500, xp_per_min_top1: 700, xp_per_min_top2: 600 },
      },
    })
    const summary = {
      rating_matches: 0,
      tournament_matches: 50,
      other_matches: 0,
      matches_median: null,
      matches_avg: null,
      win_percentage: null,
      rating_win_percentage: null,
      tournament_win_percentage: null,
      avg_rank: null,
      bad_rank_players: 0,
    }

    it('shows the fair chance without the margin and flags a value bet', () => {
      // score +14.3, Bo3 58% for Alpha; odds 2.5 / 1.6: fair 39% / 61%, margin 2.5%
      render(
        <ScorePanel
          teams={[fullTeam('Alpha', 40, 80), fullTeam('Beta', -10, 50)]}
          summaries={[summary, summary]}
          now={NOW}
          odds={[2.5, 1.6]}
        />,
      )
      expect(document.querySelector('.score-panel')).toHaveTextContent(/Data for \d+% of the weight\. /)
      expect(rowCells('Bookmaker fair chance')).toEqual(['Bookmaker fair chance', '39%', '61%'])
      expect(rowCells('Value (per 1 unit staked)')).toEqual(['Value (per 1 unit staked)', '+45% · value bet', '-33%'])
      const [, alpha, beta] = within(scoreTable().getByText('Value (per 1 unit staked)').closest('tr') as HTMLElement).getAllByRole('cell')
      expect(alpha).toHaveClass('cell-pos')
      expect(beta).toHaveClass('cell-neg')
      expect(screen.getByText(/Bookmaker margin 2\.5%, removed from its chances\./)).toBeInTheDocument()
    })

    it('does not flag a value bet with low confidence', () => {
      render(<ScorePanel teams={[team('Alpha', 40, 80), team('Beta', -10, 50)]} summaries={[null, null]} odds={[2.5, 1.6]} />)
      expect(rowCells('Value (per 1 unit staked)')).toEqual(['Value (per 1 unit staked)', '+45%', '-33%'])
    })

    it('shows no value for a Bo2 or n/a series', () => {
      render(
        <ScorePanel teams={[team('Alpha', 40, 80), team('Beta', -10, 50)]} summaries={[null, null]} bestOf={null} odds={[2.5, 1.6]} />,
      )
      expect(rowCells('Match win chance')).toEqual(['Match win chance', '55%', '45%']) // the map chance
      expect(scoreTable().queryByText('Value (per 1 unit staked)')).not.toBeInTheDocument()
      expect(screen.getByText(/No value for this series length/)).toBeInTheDocument()
    })

    it('shows no bookmaker rows without odds', () => {
      render(<ScorePanel teams={[team('Alpha', 40, 80), team('Beta', -10, 50)]} summaries={[null, null]} />)
      expect(scoreTable().queryByText('Bookmaker fair chance')).not.toBeInTheDocument()
    })
  })
})
