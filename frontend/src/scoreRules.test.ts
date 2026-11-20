import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { SCORE_SETTINGS_KEY, useScoreSettings } from './scoreRules'

describe('useScoreSettings', () => {
  beforeEach(() => localStorage.clear())

  it('reads the saved settings and shares a change with every user at once', () => {
    localStorage.setItem(SCORE_SETTINGS_KEY, JSON.stringify({ scale: 200 }))
    const first = renderHook(() => useScoreSettings())
    const second = renderHook(() => useScoreSettings())
    expect(first.result.current[0]).toEqual({ scale: 200 })

    act(() => first.result.current[1]({ scale: 120 }))
    expect(second.result.current[0]).toEqual({ scale: 120 })
    expect(JSON.parse(localStorage.getItem(SCORE_SETTINGS_KEY) ?? '{}')).toEqual({ scale: 120 })

    act(() => first.result.current[1]({}))
    expect(second.result.current[0]).toEqual({})
    expect(localStorage.getItem(SCORE_SETTINGS_KEY)).toBeNull()
  })
})
