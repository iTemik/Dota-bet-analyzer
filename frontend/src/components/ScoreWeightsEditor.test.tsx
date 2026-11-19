import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ScoreSettings } from '../score'
import ScoreWeightsEditor from './ScoreWeightsEditor'

const renderEditor = (settings: ScoreSettings = {}) => {
  const onChange = vi.fn()
  render(<ScoreWeightsEditor settings={settings} onChange={onChange} />)
  return onChange
}

const row = (label: string) => screen.getAllByText(label).map((el) => el.closest('tr') as HTMLElement)[0]

describe('ScoreWeightsEditor', () => {
  it('lists every row of the scored tables in table order, unscored rows as Not scored', () => {
    renderEditor()
    const tables = screen.getAllByRole('table')
    expect(tables.map((t) => within(t).getAllByRole('columnheader')[0].textContent)).toEqual([
      'Team Comparison',
      'Team Insights',
      'Head-to-head (prediction page)',
    ])
    const comparison = within(tables[0]).getAllByRole('row').slice(1).map((r) => r.firstChild?.textContent)
    expect(comparison[0]).toBe('Rating')
    expect(comparison).toContain('Other Matches')
    expect(comparison.at(-1)).toBe('Hero pool')
    expect(within(row('Other Matches')).getByText('Not scored')).toBeInTheDocument()
    expect(within(row('Radiant Win %')).getByText('Not scored')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Median match duration: Weight' })).toHaveValue('low')
  })

  it('shows the default weight levels and limits with their names', () => {
    renderEditor()
    expect(screen.getByRole('combobox', { name: 'Tournament win %: Normal' })).toHaveValue('mediocre')
    expect(screen.getByRole('combobox', { name: 'Tournament win %: A team under Low % or over High %' })).toHaveValue('huge')
    expect(screen.getByRole('spinbutton', { name: 'Tournament win %: High %' })).toHaveValue(70)
    expect(screen.getByRole('spinbutton', { name: 'Rating: Limit (rating points)' })).toHaveValue(300)
  })

  it('changes a weight level of one rule', () => {
    const onChange = renderEditor()
    fireEvent.change(screen.getByRole('combobox', { name: 'Rating change: Weight' }), { target: { value: 'low' } })
    expect(onChange).toHaveBeenCalledWith({ rules: { rating_change: { levels: { base: 'low' } } } })
  })

  it('applies a limit when the field loses focus, ignoring an empty value', () => {
    const onChange = renderEditor({ points: { low: 3 } })
    const field = screen.getByRole('spinbutton', { name: 'Rating: Limit (rating points)' })
    fireEvent.change(field, { target: { value: '' } })
    fireEvent.blur(field)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: '250' } })
    fireEvent.blur(field)
    expect(onChange).toHaveBeenCalledWith({ points: { low: 3 }, rules: { rating: { limits: { gap: 250 } } } })
  })

  it('changes the points of a weight word and the confidence knob', () => {
    const onChange = renderEditor()
    const high = screen.getByRole('spinbutton', { name: 'Points for high' })
    fireEvent.change(high, { target: { value: '10' } })
    fireEvent.keyDown(high, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith({ points: { high: 10 } })
    const knob = screen.getByRole('spinbutton', { name: 'Confidence knob (bigger = closer to 50%)' })
    expect(knob).toHaveValue(150)
    fireEvent.change(knob, { target: { value: '200' } })
    fireEvent.blur(knob)
    expect(onChange).toHaveBeenLastCalledWith({ scale: 200 })
  })

  it('resets one changed rule or everything', () => {
    const settings: ScoreSettings = { scale: 200, rules: { rating: { limits: { gap: 250 } }, roster: { levels: { base: 'low' } } } }
    const onChange = renderEditor(settings)
    expect(screen.getAllByRole('button', { name: 'Reset' })).toHaveLength(2)
    fireEvent.click(within(row('Rating')).getByRole('button', { name: 'Reset' }))
    expect(onChange).toHaveBeenCalledWith({ scale: 200, rules: { roster: { levels: { base: 'low' } } } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }))
    expect(onChange).toHaveBeenLastCalledWith({})
  })
})
