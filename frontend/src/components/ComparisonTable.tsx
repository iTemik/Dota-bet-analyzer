import { useState, type ReactNode } from 'react'
import { CELL_NEGATIVE, CELL_POSITIVE, formatDate, formatFixed, formatPercent, formatSigned, teamName } from '../format'
import { ROSTER_STATES, getStandins } from '../roster'
import { full, pairRule, positive, scaled, shareGap, type ScoreRule, type ScoreTeam } from '../score'
import type { FarmStats, LeagueForm, MatchesSummary, TeamData, TeamMeta, TeamPoolState } from '../types'
import FavourTag from './FavourTag'
import { RowInfoIcon, type RowInfo } from './RowInfo'

type Summary = MatchesSummary | null
type Meta = TeamMeta | null | undefined

interface ComparisonTableProps {
  teams: (TeamData | undefined)[] // team 1 and team 2
  summaries: Summary[] // match summary per team, null while it is loading
  showSummaryRows: boolean // rows that need the summary are hidden until it has arrived
  days: number // window used for the label when the team has no league form
  now?: number // unix time the Last Match colours are judged at; a saved prediction passes its own time
  metas?: Meta[] // team meta per team from the task results; without it the meta rows are hidden (snapshots)
  score?: number // team score (positive = team 1 favoured): shown under the team names, the favoured one highlighted
}

// Team Comparison row: `compare` picks the number to colour by, `better` says which side wins
interface CompareRowConfig {
  label: ReactNode
  info?: RowInfo // texts for the row's "i" tooltip
  summary?: boolean // shown only once the match summary has arrived
  needsMeta?: boolean // shown only with team meta (live statistics, not saved snapshots)
  emptyWhenZero?: boolean // 0 means no data: a row that is 0 (or empty) for both teams is hidden
  compare?: (team: TeamData | undefined, summary: Summary, meta: Meta) => number | null
  better?: 'higher' | 'lower'
  threshold?: number // differences up to this are not coloured
  thresholdPercent?: number // differences up to this % of the smaller value are not coloured
  color?: (team: TeamData | undefined, index: number) => string // per-team cell class, for rows that don't compare
  render: (team: TeamData | undefined, summary: Summary, meta: Meta) => ReactNode
  score?: ScoreRule // how the row counts in the team score (score.ts); rows without it are not scored
}

// Cell classes for team 1 and team 2: the better value is positive, the other negative
const compareColors = (
  a: number | null,
  b: number | null,
  better: 'higher' | 'lower',
  threshold = 0,
  thresholdPercent = 0,
): [string, string] => {
  if (a === null || b === null) return ['', '']
  if (Math.abs(a - b) <= Math.max(threshold, (thresholdPercent / 100) * Math.min(Math.abs(a), Math.abs(b)))) {
    return ['', '']
  }
  const firstWins = better === 'higher' ? a > b : a < b
  return firstWins ? [CELL_POSITIVE, CELL_NEGATIVE] : [CELL_NEGATIVE, CELL_POSITIVE]
}

// A cell with nothing to show: no value or an empty 0-0 record
const isEmptyCell = (value: ReactNode): boolean => value == null || value === '-' || (typeof value === 'string' && value.startsWith('0-0'))
const isZeroCell = (value: ReactNode): boolean => typeof value === 'string' && value !== '' && Number(value) === 0

interface CompareRowProps {
  row: CompareRowConfig
  teams: (TeamData | undefined)[]
  summaries: Summary[]
  metas: Meta[]
}

const CompareRow = ({ row, teams, summaries, metas }: CompareRowProps) => {
  const cells = teams.map((team, i) => row.render(team, summaries[i], metas[i]))
  // Rows that are empty for both teams are hidden
  if (cells.every((cell) => isEmptyCell(cell) || (row.emptyWhenZero && isZeroCell(cell)))) return null
  let colors: string[] | null = null
  if (row.compare && row.better) {
    const values = [row.compare(teams[0], summaries[0], metas[0]), row.compare(teams[1], summaries[1], metas[1])] as const
    colors = compareColors(values[0], values[1], row.better, row.threshold, row.thresholdPercent)
  } else if (row.color) {
    colors = teams.map(row.color)
  }
  return (
    <tr>
      <td className="row-label">
        {row.label}
        {row.info && <RowInfoIcon info={row.info} />}
      </td>
      {cells.map((cell, i) => (
        <td key={i} className={colors?.[i] || undefined}>
          {cell}
        </td>
      ))}
    </tr>
  )
}

const getDeltaClass = (delta: number | undefined): string => {
  if (!delta) return ''
  if (delta < -15) return CELL_NEGATIVE
  if (delta > 15) return CELL_POSITIVE
  return ''
}

const getRosterRank = (team: TeamData | undefined): number | null =>
  team?.roster_source === 'recent_matches' && team.roster_state ? (ROSTER_STATES[team.roster_state]?.rank ?? null) : null

const scoreRosterRank = (t: ScoreTeam): number | null =>
  t.team?.roster_source === 'recent_matches' && t.team.roster_state ? (ROSTER_STATES[t.team.roster_state]?.rank ?? null) : null

const renderRosterState = (team: TeamData | undefined) => {
  const state = team?.roster_source === 'recent_matches' && team.roster_state ? ROSTER_STATES[team.roster_state] : null
  if (!team || !state) return '-'
  const standins = getStandins(team).length
  const suffix = standins ? ` (${standins} stand-in${standins === 1 ? '' : 's'})` : ''
  return <span title={state.hint}>{`${state.label}${suffix}`}</span>
}

const STALE_DAYS = 14 // a last match older than this is a long break

const lastMatchTime = (team: Partial<TeamData> | null | undefined): number | null => team?.roster_last_match_time ?? team?.league_form?.last_match_time ?? null

// Last Match: a team on a long break (or with no date) is red when the other team played recently
const lastMatchColor = (teams: (TeamData | undefined)[], now: number) => {
  const recent = teams.map((team) => {
    const time = lastMatchTime(team)
    return time !== null && now - time <= STALE_DAYS * 24 * 3600
  })
  return (_: TeamData | undefined, i: number) => (!recent[i] && recent[1 - i] ? CELL_NEGATIVE : '')
}

const formatLeagueRecord = (form: LeagueForm | null | undefined): string => {
  if (!form || !form.matches) return '-'
  return `${form.wins}-${form.losses} (${(form.win_percentage ?? 0).toFixed(1)}%)`
}

const FARM_THRESHOLD_PERCENT = 15 // GPM and XPM differences up to this % are not coloured

// Top 1 and top 2 GPM and XPM rows, all from league_form.farm
const farmRows = (): CompareRowConfig[] =>
  (
    [
      ['gold_per_min_top1', 'Top 1 GPM', 'highest gold per minute'],
      ['gold_per_min_top2', 'Top 2 GPM', 'second highest gold per minute'],
      ['xp_per_min_top1', 'Top 1 XPM', 'highest experience per minute'],
      ['xp_per_min_top2', 'Top 2 XPM', 'second highest experience per minute'],
    ] as [Exclude<keyof FarmStats, 'games'>, string, string][]
  ).map(([key, label, long]) => {
    const value = (team: TeamData | undefined) => team?.league_form?.farm?.[key] ?? null
    return {
      label: `${label} (median)`,
      info: {
        description: `Median of the team’s ${long} over its tournament games in the window.`,
        colors: `Higher is green, lower is red; no colour when they differ by ${FARM_THRESHOLD_PERCENT}% or less.`,
        assumption:
          'A team that farms on average 15% more than the other has the advantage in long games. Usually it is a sign of better skills. With a low win rate the numbers are lower, so the comparison means more for teams with a similar win rate.',
      },
      compare: value,
      better: 'higher',
      thresholdPercent: FARM_THRESHOLD_PERCENT,
      render: (team) => formatFixed(value(team), 0),
      score: {
        key,
        name: label,
        levels: { base: 'low' },
        limits: { bigShare: 0.2 },
        apply: pairRule(
          (t) => positive(t.team?.league_form?.farm?.[key]),
          (a, b, ctx) => ({ edge: shareGap(a, b, ctx.limit('bigShare')), weight: ctx.weight('base') }),
        ),
      },
    }
  })

// Team Comparison: one row per stat, Team #1 vs Team #2; add new stats to this list.
// `info` texts: "Players" means the 5 main roster players (most tournament games in the window).
const compareRows = (teams: (TeamData | undefined)[], days: number, now: number): CompareRowConfig[] => [
  {
    label: 'Rating',
    info: {
      description:
        'OpenDota Elo rating over all tournament games since the team was created (start 1000, up to 32 points per game, never reset). Even teams trade 16 points a game; about 7 straight wins over equal teams add 100.',
      colors: 'Higher is green, lower is red; no colour when they differ by 100 or less.',
      assumption:
        'A 100-point gap means the stronger team is expected to win about 64% of games (about 70% of a Bo3). Beating a team 100 points stronger gives +20.5, losing to it only -11.5.',
    },
    compare: (team) => team?.rating || null,
    better: 'higher',
    threshold: 100,
    render: (team) => (team?.rating ? team.rating : '-'),
    score: {
      key: 'rating',
      name: 'Rating',
      levels: { big: 'low' }, // counts only above the gap
      limits: { gap: 300 },
      labels: { gap: 'Limit (rating points)' },
      apply: pairRule(
        (t) => positive(t.team?.rating),
        (a, b, ctx) => (Math.abs(a - b) > ctx.limit('gap') ? { edge: full(a - b), weight: ctx.weight('big') } : { edge: 0, weight: 0 }),
      ),
    },
  },
  {
    label: 'Last match rating',
    info: {
      description:
        'Elo points from the team’s latest game (one game, not the series): a win gives 0 to +32, a loss 0 to -32. Even teams: ±16; beating a team 100 points stronger: +20.5, losing to it: -11.5.',
      colors: 'Above +15 is green (won against an equal or stronger team), below -15 is red (lost to an equal or weaker team), otherwise no colour.',
      assumption:
        'A team whose rating changed a lot recently is in its prime or on a losing streak. A much better indicator than the team rating.',
    },
    color: (team) => getDeltaClass(team?.delta),
    render: (team) => (team?.delta ? `${team.delta > 0 ? '+' : ''}${team.delta.toFixed(1)}` : '-'),
    score: {
      key: 'last_match_rating',
      name: 'Last match rating',
      levels: { big: 'mediocre' }, // counts only above the gap
      limits: { gap: 14 },
      labels: { gap: 'Limit (rating points)' },
      apply: pairRule(
        (t) => t.team?.delta,
        (a, b, ctx) => (Math.abs(a - b) > ctx.limit('gap') ? { edge: full(a - b), weight: ctx.weight('big') } : { edge: 0, weight: 0 }),
      ),
    },
  },
  {
    label: `Rating change, last ${teams[0]?.league_form?.days ?? days} days`,
    info: {
      description:
        'Estimated Elo change over the tournament games of the window, worked back from today’s rating with today’s opponent ratings (OpenDota keeps no rating history). Games against opponents of unknown rating are skipped.',
      colors: 'Higher is green, lower is red; no colour when they differ by 16 or less (one game between equal teams).',
      assumption: 'Rating trend: a team that gains points is in form. TBD',
    },
    compare: (team) => team?.rating_change ?? null,
    better: 'higher',
    threshold: 16,
    render: (team) => formatSigned(team?.rating_change),
    score: {
      key: 'rating_change',
      name: 'Rating change',
      levels: { base: 'huge' },
      limits: { bigGap: 64 },
      apply: pairRule(
        (t) => t.team?.rating_change,
        (a, b, ctx) => ({ edge: scaled(a - b, ctx.limit('bigGap')), weight: ctx.weight('base') }),
      ),
    },
  },
  {
    label: 'Roster Changes',
    info: {
      description:
        'Stable: only the 5 core players (75%+ of tournament games, else 50%+) played. Stand-ins: a clear core plus others in some games. New team: no clear core.',
      colors: 'Stable beats Stand-ins beats New team.',
      assumption: 'A settled lineup plays better together; stats of a new team say less.',
    },
    compare: getRosterRank,
    better: 'lower',
    render: renderRosterState,
    score: {
      key: 'roster',
      name: 'Roster changes',
      levels: { base: 'mediocre' },
      limits: { bigGap: 2 }, // Stable 0, Stand-ins 1, New team 2
      labels: { bigGap: 'Full edge at gap (Stable 0, Stand-ins 1, New team 2)' },
      apply: pairRule(scoreRosterRank, (a, b, ctx) => ({ edge: scaled(b - a, ctx.limit('bigGap')), weight: ctx.weight('base') })),
    },
  },
  {
    label: `Tournament matches, last ${teams[0]?.league_form?.days ?? days} days`,
    info: {
      description: 'Team wins-losses (win %) in tournament (league) games over the window.',
      colors: 'Higher win % is green, lower is red.',
      assumption:
        'Current form in official games. A team that played many more games has the better chance against a team that played few, even with a bad win rate.',
    },
    compare: (team) => team?.league_form?.win_percentage ?? null,
    better: 'higher',
    render: (team) => formatLeagueRecord(team?.league_form),
    score: {
      key: 'tournament_win_pct',
      name: 'Tournament win %',
      levels: { base: 'mediocre', extreme: 'huge' }, // extreme: either team under `low` or over `high`
      limits: { bigGap: 30, low: 30, high: 70 },
      labels: { base: 'Normal', extreme: 'A team under Low % or over High %', bigGap: 'Full edge at gap (%)', low: 'Low %', high: 'High %' },
      apply: pairRule(
        (t) => (t.team?.league_form?.matches ? t.team.league_form.win_percentage : null),
        (a, b, ctx) => ({
          edge: scaled(a - b, ctx.limit('bigGap')),
          weight: ctx.weight([a, b].some((x) => x < ctx.limit('low') || x > ctx.limit('high')) ? 'extreme' : 'base'),
        }),
      ),
    },
  },
  ...farmRows(),
  {
    label: 'Last Match',
    info: {
      description: 'Date of the latest tournament game played by at least 3 of the 5 players.',
      colors: `Red when the other team played in the last ${STALE_DAYS} days and this one did not (or has no date).`,
      assumption: 'A team that played long ago has a high chance to lose against a team that played recently.',
    },
    color: lastMatchColor(teams, now),
    render: (team) => formatDate(lastMatchTime(team)),
    score: {
      key: 'last_match',
      name: 'Last match',
      levels: { stale: 'mediocre' }, // counts only when one team's last match is older than `days` and the other's is not
      limits: { days: 15 },
      labels: { stale: 'One team on a break', days: 'Break after (days)' },
      apply: ({ teams, now }, ctx) => {
        const times = teams.map((t) => lastMatchTime(t.team))
        if (times.every((time) => time === null)) return null
        const [a, b] = times.map((time) => time !== null && now - time <= ctx.limit('days') * 24 * 3600)
        return a === b ? { edge: 0, weight: 0 } : { edge: a ? 1 : -1, weight: ctx.weight('stale') }
      },
    },
  },
  {
    label: 'Rating Matches',
    info: {
      description: 'Ranked pub games played by all players in the window, summed.',
      colors: 'More is green, fewer is red.',
      assumption: 'Playing ranked between tournaments with a high win rate is a good sign: the team practices a lot and knows the current meta.',
    },
    summary: true,
    emptyWhenZero: true,
    compare: (_, s) => s?.rating_matches ?? null,
    better: 'higher',
    render: (_, s) => String(s?.rating_matches ?? '-'),
    score: {
      key: 'rating_matches',
      name: 'Rating matches',
      levels: { base: 'low' },
      limits: { bigShare: 0.5 },
      apply: pairRule(
        (t) => t.summary?.rating_matches,
        (a, b, ctx) => ({ edge: shareGap(a, b, ctx.limit('bigShare')), weight: ctx.weight('base') }),
      ),
    },
  },
  {
    label: 'Tournament + scrim matches',
    info: {
      description:
        'Captains Mode lobby games (tournament and scrims; OpenDota can’t tell them apart) played by all players in the window, summed. A game counts once per player.',
      colors: 'More is green, fewer is red.',
      assumption: 'Playing lobbies between tournaments with a high win rate is a good sign: the team practices a lot.',
    },
    summary: true,
    emptyWhenZero: true,
    compare: (_, s) => s?.tournament_matches ?? null,
    better: 'higher',
    render: (_, s) => String(s?.tournament_matches ?? '-'),
    score: {
      key: 'tournament_matches',
      name: 'Tournament + scrim matches',
      levels: { base: 'low', big: 'mediocre' }, // big: above the gap (about 15 games per player)
      limits: { gap: 80 },
      labels: { base: 'Gap up to the limit', gap: 'Limit (games)' },
      apply: pairRule(
        (t) => t.summary?.tournament_matches,
        (a, b, ctx) =>
          Math.abs(a - b) > ctx.limit('gap')
            ? { edge: full(a - b), weight: ctx.weight('big') }
            : { edge: scaled(a - b, ctx.limit('gap')), weight: ctx.weight('base') },
      ),
    },
  },
  {
    label: 'Pub Win %',
    info: {
      description: 'Wins / ranked pub games, over all players’ games.',
      colors: 'Higher is green, lower is red.',
      assumption: 'Low means the team can’t punish mistakes. A bad sign even with a good tournament win rate: a low chance to come back.',
    },
    summary: true,
    compare: (_, s) => s?.rating_win_percentage ?? null,
    better: 'higher',
    render: (_, s) => formatPercent(s?.rating_win_percentage),
    score: {
      key: 'pub_win_pct',
      name: 'Pub win %',
      levels: { high: 'mediocre' }, // counts only when a team is above `above`
      limits: { above: 60, bigGap: 10 },
      labels: { high: 'A team over the limit', above: 'Limit (%)', bigGap: 'Full edge at gap when both are over (%)' },
      apply: pairRule(
        (t) => t.summary?.rating_win_percentage,
        (a, b, ctx) => {
          const above = ctx.limit('above')
          if (a > above && b > above) return { edge: scaled(a - b, ctx.limit('bigGap')), weight: ctx.weight('high') }
          if (a > above || b > above) return { edge: a > above ? 1 : -1, weight: ctx.weight('high') }
          return { edge: 0, weight: 0 }
        },
      ),
    },
  },
  {
    label: 'Lobby Win %',
    info: {
      description: 'Wins / Captains Mode lobby games (tournament and scrims), over all players’ games.',
      colors: 'Higher is green, lower is red.',
      assumption: 'Team form, including scrims. TBD',
    },
    summary: true,
    compare: (_, s) => s?.tournament_win_percentage ?? null,
    better: 'higher',
    render: (_, s) => formatPercent(s?.tournament_win_percentage),
    score: {
      key: 'lobby_win_pct',
      name: 'Lobby win %',
      levels: { base: 'low' },
      limits: { bigGap: 20 },
      apply: pairRule(
        (t) => t.summary?.tournament_win_percentage,
        (a, b, ctx) => ({ edge: scaled(a - b, ctx.limit('bigGap')), weight: ctx.weight('base') }),
      ),
    },
  },
  {
    label: 'Average Player Rank',
    info: {
      description: 'Average leaderboard rank of the players who have one; players off the leaderboard are skipped.',
      colors: 'Lower (better) rank is green, higher is red.',
      assumption: 'Individual skill of the players.',
    },
    summary: true,
    emptyWhenZero: true,
    compare: (_, s) => s?.avg_rank ?? null,
    better: 'lower',
    render: (_, s) => formatFixed(s?.avg_rank, 0),
    score: {
      key: 'avg_rank',
      name: 'Average player rank',
      levels: { base: 'low', big: 'mediocre' }, // lower rank is better; big: above the gap
      limits: { gap: 100 },
      labels: { base: 'Gap up to the limit', gap: 'Limit (rank)' },
      apply: pairRule(
        (t) => positive(t.summary?.avg_rank),
        (a, b, ctx) =>
          Math.abs(a - b) > ctx.limit('gap')
            ? { edge: full(b - a), weight: ctx.weight('big') }
            : { edge: scaled(b - a, ctx.limit('gap')), weight: ctx.weight('base') },
      ),
    },
  },
  {
    label: 'Low Rank Players',
    info: {
      description: 'Players ranked worse than 150 on the leaderboard ("тысячники": once "not top 1000", ~top 150 after the July 2026 MMR rework).',
      colors: 'Fewer is green, more is red.',
      assumption: 'Even one such player can ruin tough matches, unintentionally.',
    },
    summary: true,
    compare: (_, s) => s?.bad_rank_players ?? null,
    better: 'lower',
    render: (_, s) => String(s?.bad_rank_players ?? '-'),
    score: {
      key: 'low_rank_players',
      name: 'Low rank players',
      levels: { one: 'mediocre', more: 'high' }, // fewer is better; one: gap of 1, more: gap of 2+
      labels: { one: 'Gap of 1', more: 'Gap of 2 or more' },
      apply: pairRule(
        (t) => t.summary?.bad_rank_players,
        (a, b, ctx) => {
          const gap = Math.abs(a - b)
          return { edge: full(b - a), weight: gap >= 2 ? ctx.weight('more') : gap === 1 ? ctx.weight('one') : 0 }
        },
      ),
    },
  },
  {
    label: 'Other Matches',
    info: {
      description: 'Players’ games that are neither ranked pubs nor Captains Mode lobbies (Turbo, unranked, other modes), summed.',
      assumption: 'TBD',
    },
    summary: true,
    emptyWhenZero: true,
    render: (_, s) => String(s?.other_matches ?? '-'),
  },
  {
    label: 'Average Matches Per Player',
    info: {
      description: 'All games in the window divided by the number of players.',
      colors: 'More is green, fewer is red.',
      assumption: 'How much the players play overall. TBD',
    },
    summary: true,
    emptyWhenZero: true,
    compare: (_, s) => s?.matches_avg ?? null,
    better: 'higher',
    render: (_, s) => formatFixed(s?.matches_avg, 2),
    score: {
      key: 'matches_avg',
      name: 'Average matches per player',
      levels: { base: 'low' },
      limits: { bigShare: 0.5 },
      apply: pairRule(
        (t) => t.summary?.matches_avg,
        (a, b, ctx) => ({ edge: shareGap(a, b, ctx.limit('bigShare')), weight: ctx.weight('base') }),
      ),
    },
  },
  {
    label: 'Median Matches Per Player',
    info: {
      description: 'Median number of games per player in the window; less affected by one very active or inactive player.',
      colors: 'More is green, fewer is red.',
      assumption:
        'The whole team should practice, and players often slack. A median above the tournament games means the whole team practices, not only in tournament matches.',
    },
    summary: true,
    emptyWhenZero: true,
    compare: (_, s) => s?.matches_median ?? null,
    better: 'higher',
    render: (_, s) => formatFixed(s?.matches_median, 2),
    score: {
      key: 'matches_median',
      name: 'Median matches per player',
      levels: { base: 'low', big: 'mediocre' }, // big: at the gap or more
      limits: { gap: 14 },
      labels: { base: 'Gap under the limit', big: 'Gap at the limit or more', gap: 'Limit (games)' },
      apply: pairRule(
        (t) => t.summary?.matches_median,
        (a, b, ctx) =>
          Math.abs(a - b) >= ctx.limit('gap')
            ? { edge: full(a - b), weight: ctx.weight('big') }
            : { edge: scaled(a - b, ctx.limit('gap')), weight: ctx.weight('base') },
      ),
    },
  },
]

const POOL_LABELS: Record<TeamPoolState, string> = { narrow: 'Narrow', normal: 'Normal', wide: 'Wide' }

// "Wide: 45" with a full sample, else "32 in 12 games"
const formatHeroPool = (meta: Meta): string => {
  const sample = meta?.sample
  if (!sample?.games || sample.heroes == null) return '-'
  return meta?.pool_state ? `${POOL_LABELS[meta.pool_state]}: ${sample.heroes}` : `${sample.heroes} in ${sample.games} games`
}

const heroPoolRow: CompareRowConfig = {
  label: 'Hero Pool',
  needsMeta: true,
  info: {
    description: (
      <>
        Different heroes the team picked (any hero, stand-ins included) in its 15 newest tournament games:
        <ul className="row-info-list">
          <li>
            <b>Wide</b>: more than 40
          </li>
          <li>
            <b>Normal</b>: 30 to 40
          </li>
          <li>
            <b>Narrow</b>: fewer than 30
          </li>
        </ul>
        With fewer games only the count is shown, e.g. 32 in 12 games.
      </>
    ),
    colors: 'The bigger pool is green when both teams have 15 games and differ by more than 3 heroes.',
    assumption:
      'A team with a big pool is harder to prepare for: it can counter-pick or surprise the opponent. A fixed number of games keeps teams comparable (75 picks of about 125 heroes).',
  },
  compare: (_t, _s, meta) => (meta?.pool_state ? (meta.sample?.heroes ?? null) : null),
  better: 'higher',
  threshold: 3,
  render: (_t, _s, meta) => formatHeroPool(meta),
  score: {
    key: 'hero_pool',
    name: 'Hero pool',
    levels: { base: 'low' }, // only when both teams have a full sample
    limits: { bigGap: 10 },
    labels: { bigGap: 'Full edge at gap (heroes)' },
    apply: pairRule(
      (t) => (t.meta?.pool_state ? t.meta.sample?.heroes : null),
      (a, b, ctx) => ({ edge: scaled(a - b, ctx.limit('bigGap')), weight: ctx.weight('base') }),
    ),
  },
}

// Rows for the team score and its weights editor, in table order: scored rows by rule name, the rest by label
// (rules don't depend on the labels' window or time)
export const COMPARISON_SCORE_ROWS: { label: string; rule?: ScoreRule }[] = [...compareRows([], 0, 0), heroPoolRow].map((row) => ({
  label: row.score?.name ?? (typeof row.label === 'string' ? row.label : ''),
  rule: row.score,
}))

/** Team Comparison table for two teams; renders live statistics and saved snapshots alike. */
const ComparisonTable = ({ teams, summaries, showSummaryRows, days, now, metas, score }: ComparisonTableProps) => {
  const [shownAt] = useState(() => Date.now() / 1000) // live statistics are judged at the time they were shown
  return (
    <table className="stats-table comparison-table">
      <thead>
        <tr>
          <th></th>
          {[0, 1].map((i) => {
            const side = score === undefined ? 0 : Math.sign(i === 0 ? score : -score) // 1 favoured, -1 not, 0 even
            return (
              <th key={i} className={side > 0 ? 'team-favoured' : undefined}>
                <div className="team-header">
                  <span>{teamName(teams[i], i)}</span>
                  {teams[i]?.logo_url && <img src={teams[i].logo_url} alt={`Team ${i + 1} Logo`} className="team-logo" />}
                  {score !== undefined && (
                    <span className="team-score">
                      Score {formatSigned(i === 0 ? score : -score)}
                      {side !== 0 && <FavourTag favoured={side > 0} />}
                    </span>
                  )}
                </div>
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {[...compareRows(teams, days, now ?? shownAt), heroPoolRow]
          .filter((row) => (!row.summary || showSummaryRows) && (!row.needsMeta || metas))
          .map((row, i) => (
            <CompareRow key={i} row={row} teams={teams} summaries={summaries} metas={metas ?? []} />
          ))}
      </tbody>
    </table>
  )
}

export default ComparisonTable
