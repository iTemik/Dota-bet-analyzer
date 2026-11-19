import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { SCORE_SETTINGS_KEY } from '../scoreRules'
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
    expect(rowCells('Map win chance')).toEqual(['Map win chance', '55%', '45%'])
    expect(rowCells('Bo3 win chance')).toEqual(['Bo3 win chance', '58%', '42%'])
    expect(rowCells('Rating change')).toEqual(['Rating change', '+6.3', ''])
    expect(rowCells('Tournament win %')).toEqual(['Tournament win %', '+8.0', ''])
    expect(screen.getByRole('progressbar', { name: 'Rating change points' })).toBeInTheDocument()
  })

  it('puts points of the second team in its column and labels the favour by the series chance', () => {
    // rating change 6.25 and win % 10 / 30 x 5 = 1.7 for Beta, team 2; Bo5 56% is slight (Bo3 would be 55%, even)
    render(<ScorePanel teams={[team('Alpha', -10, 50), team('Beta', 40, 60)]} summaries={[null, null]} bestOf={5} />)
    expect(screen.getByText('Beta: slight favourite · score -7.9')).toBeInTheDocument()
    expect(rowCells('Bo5 win chance')).toEqual(['Bo5 win chance', '44%', '56%'])
    expect(rowCells('Rating change')).toEqual(['Rating change', '', '+6.3'])
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

  it('recalculates with the weights editor and keeps the change in the browser', () => {
    render(<ScorePanel teams={[team('Alpha', 40, 80), team('Beta', -10, 50)]} summaries={[null, null]} />)
    fireEvent.click(screen.getByText('Score weights'))
    // rating change 50 / 64 x 2 = 1.6 instead of 6.3
    fireEvent.change(screen.getByRole('combobox', { name: 'Rating change: Weight' }), { target: { value: 'low' } })
    expect(rowCells('Rating change')).toEqual(['Rating change', '+1.6', ''])
    expect(screen.getByText('Alpha: slight favourite · score +9.6')).toBeInTheDocument()
    expect(screen.getByText('Score weights (changed)')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(SCORE_SETTINGS_KEY) ?? '{}')).toEqual({ rules: { rating_change: { levels: { base: 'low' } } } })
  })

  it('starts from the weights saved in the browser', () => {
    localStorage.setItem(SCORE_SETTINGS_KEY, JSON.stringify({ rules: { tournament_win_pct: { levels: { extreme: 'none' } } } }))
    render(<ScorePanel teams={[team('Alpha', 40, 80), team('Beta', -10, 50)]} summaries={[null, null]} />)
    expect(scoreTable().queryByText('Tournament win %')).not.toBeInTheDocument() // 0 points: listed as even
    expect(screen.getByText(/Even or below their thresholds: Tournament win %\./)).toBeInTheDocument()
  })
})
