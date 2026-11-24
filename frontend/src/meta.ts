// Meta tab settings: thresholds of GET /api/heroes/meta
import type { MetaParams } from './types'

// Same defaults as the backend (backend.meta.MetaParams)
export const DEFAULT_META_PARAMS: MetaParams = {
  pro_min_pick_ban: 40,
  ultra_min_win: 55,
  ultra_min_picks: 5,
  pub_top: 30,
  pub_min_win: 52,
  patch_settle_days: 14,
}
// The thresholds are kept in the browser, so they survive a reload
export const META_PARAMS_KEY = 'metaParams'

// Saved thresholds over the defaults; keys no longer used (e.g. from an older version) are dropped
export const loadMetaParams = (): MetaParams => {
  try {
    const saved = JSON.parse(localStorage.getItem(META_PARAMS_KEY) ?? '{}')
    const keys = Object.keys(DEFAULT_META_PARAMS) as (keyof MetaParams)[]
    return Object.fromEntries(keys.map((k) => [k, saved[k] ?? DEFAULT_META_PARAMS[k]])) as unknown as MetaParams
  } catch {
    return DEFAULT_META_PARAMS
  }
}

const DAY_SECONDS = 86400

// "Patch 7.40 is 5 days old: the meta is not settled yet" (shown while the backend says patch_fresh)
export const patchWarning = (
  patch: string | null | undefined,
  patchStart: number | null | undefined,
  now: number = Date.now() / 1000,
): string => {
  const days = patchStart ? Math.max(0, Math.floor((now - patchStart) / DAY_SECONDS)) : null
  const age = days === null ? 'is new' : days === 0 ? 'came out today' : `is ${days} day${days === 1 ? '' : 's'} old`
  return `${patch ? `Patch ${patch}` : 'The latest patch'} ${age}: the meta is not settled yet`
}
