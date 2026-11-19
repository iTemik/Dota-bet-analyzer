import { describe, expect, it } from "vitest";
import {
  computeScore,
  expectedValue,
  fairProbabilities,
  favour,
  isValueBet,
  mapWinProbability,
  seriesWinProbability,
  type ScoreInput,
  type ScoreTeam,
} from "./score";
import type { MatchesSummary, TeamData } from "./types";

const NOW = 1_800_000_000;
const DAY = 24 * 3600;

const summary = (fields: Partial<MatchesSummary>): MatchesSummary => ({
  rating_matches: 0,
  tournament_matches: 0,
  other_matches: 0,
  matches_median: null,
  matches_avg: null,
  win_percentage: null,
  rating_win_percentage: null,
  tournament_win_percentage: null,
  avg_rank: null,
  bad_rank_players: null,
  ...fields,
});

const farm = (gpm: number) => ({
  games: 10,
  gold_per_min_top1: gpm,
  gold_per_min_top2: gpm,
  xp_per_min_top1: gpm,
  xp_per_min_top2: gpm,
});

// The worked example of the method doc: Team A vs Team B
const teamA: ScoreTeam = {
  team: {
    rating: 1450,
    delta: 18,
    rating_change: 40,
    roster_source: "recent_matches",
    roster_state: "stable",
    roster_last_match_time: NOW - 3 * DAY,
    league_form: {
      days: 20,
      matches: 18,
      wins: 13,
      losses: 5,
      win_percentage: 72,
      last_match_time: NOW - 3 * DAY,
      duration_median: 38 * 60,
      farm: farm(630),
    },
  },
  summary: summary({
    rating_matches: 120,
    tournament_matches: 90,
    rating_win_percentage: 52,
    tournament_win_percentage: 60,
    avg_rank: 300,
    bad_rank_players: 0,
    matches_avg: 40,
    matches_median: 40,
  }),
  meta: {
    pool_state: "normal",
    sample: {
      games: 15,
      heroes: 38,
      meta2_games_pct: null,
      meta3_games_pct: null,
      meta_picks_pct: null,
      start: null,
      window: "recent",
    },
  },
};
const teamB: ScoreTeam = {
  team: {
    rating: 1350,
    delta: -12,
    rating_change: -10,
    roster_source: "recent_matches",
    roster_state: "standins",
    roster_last_match_time: NOW - 5 * DAY,
    league_form: {
      days: 20,
      matches: 18,
      wins: 9,
      losses: 9,
      win_percentage: 50,
      last_match_time: NOW - 5 * DAY,
      duration_median: 34 * 60,
      farm: farm(600),
    },
  },
  summary: summary({
    rating_matches: 150,
    tournament_matches: 60,
    rating_win_percentage: 55,
    tournament_win_percentage: 50,
    avg_rank: 500,
    bad_rank_players: 1,
    matches_avg: 40,
    matches_median: 40,
  }),
  meta: {
    pool_state: "narrow",
    sample: {
      games: 15,
      heroes: 33,
      meta2_games_pct: null,
      meta3_games_pct: null,
      meta_picks_pct: null,
      start: null,
      window: "recent",
    },
  },
};
const example: ScoreInput = { teams: [teamA, teamB], now: NOW };

const points = (input: ScoreInput) =>
  Object.fromEntries(computeScore(input).metrics.map((m) => [m.key, m.points]));
const withTeams = (a: Partial<TeamData>, b: Partial<TeamData>): ScoreInput => ({
  teams: [{ team: a }, { team: b }],
  now: NOW,
});

describe("computeScore", () => {
  it("scores the worked example metric by metric", () => {
    const p = points(example);
    expect(p.rating).toBe(0); // gap 100, counts only above 300
    expect(p.last_match_rating).toBe(5); // gap 30 > 14
    expect(p.rating_change).toBeCloseTo(9.375); // 50 / 64 x 12
    expect(p.roster).toBe(2.5);
    expect(p.tournament_win_pct).toBeCloseTo(8.8); // huge: A is above 70%
    expect(p.gold_per_min_top1).toBeCloseTo(0.5); // 5% / 20% x 2
    expect(p.last_match).toBe(0);
    expect(p.rating_matches).toBeCloseTo(-1); // -25% / 50% x 2
    expect(p.tournament_matches).toBeCloseTo(0.75);
    expect(p.pub_win_pct).toBe(0); // neither above 60%
    expect(p.lobby_win_pct).toBe(1);
    expect(p.avg_rank).toBe(5);
    expect(p.low_rank_players).toBe(5);
    expect(p.matches_avg).toBe(0);
    expect(p.matches_median).toBe(0);
    expect(p.hero_pool).toBe(1);
    expect(p.duration).toBeCloseTo(1.6);
    expect(p.head_to_head).toBeUndefined(); // no games: skipped
  });

  it("sums the example to +41 with nearly full coverage", () => {
    const result = computeScore(example);
    expect(result.score).toBeCloseTo(41.025);
    expect(result.coverage).toBeCloseTo(92 / 94); // all but head-to-head (low, 2)
  });

  it("is symmetric: swapping the teams flips the sign", () => {
    expect(
      computeScore({ ...example, teams: [teamB, teamA] }).score,
    ).toBeCloseTo(-41.025);
  });

  it("skips metrics without data and reports zero coverage for empty teams", () => {
    const result = computeScore({ teams: [{}, {}], now: NOW });
    expect(result).toEqual({ score: 0, coverage: 0, metrics: [] });
  });

  it("counts rating only above a 300 gap", () => {
    expect(points(withTeams({ rating: 1700 }, { rating: 1350 })).rating).toBe(
      2,
    );
    expect(points(withTeams({ rating: 1350 }, { rating: 1700 })).rating).toBe(
      -2,
    );
  });

  it("counts last match rating only above a 14 gap", () => {
    expect(
      points(withTeams({ delta: 10 }, { delta: -4 })).last_match_rating,
    ).toBe(0);
    expect(
      points(withTeams({ delta: -10 }, { delta: 5 })).last_match_rating,
    ).toBe(-5);
  });

  it("makes tournament win % huge when a team is under 30%", () => {
    const form = (win_percentage: number) => ({
      days: 20,
      matches: 10,
      wins: 0,
      losses: 0,
      win_percentage,
      last_match_time: null,
    });
    expect(
      points(withTeams({ league_form: form(55) }, { league_form: form(25) }))
        .tournament_win_pct,
    ).toBe(12);
    expect(
      points(withTeams({ league_form: form(55) }, { league_form: form(40) }))
        .tournament_win_pct,
    ).toBe(2.5);
  });

  it("gives the last match edge to the team that played within 15 days", () => {
    const recent = { roster_last_match_time: NOW - 2 * DAY };
    expect(
      points(withTeams(recent, { roster_last_match_time: NOW - 20 * DAY }))
        .last_match,
    ).toBe(5);
    expect(
      points(withTeams({ roster_last_match_time: null }, recent)).last_match,
    ).toBe(-5);
    expect(
      points(
        withTeams(
          { roster_last_match_time: NOW - 30 * DAY },
          { roster_last_match_time: NOW - 20 * DAY },
        ),
      ).last_match,
    ).toBe(0);
  });

  it("counts pub win % only when a team is above 60%", () => {
    const pub = (rating_win_percentage: number): ScoreTeam => ({
      summary: summary({ rating_win_percentage }),
    });
    expect(points({ teams: [pub(62), pub(58)], now: NOW }).pub_win_pct).toBe(5);
    expect(points({ teams: [pub(65), pub(70)], now: NOW }).pub_win_pct).toBe(
      -2.5,
    );
  });

  it("weighs low rank players by the gap: 1 mediocre, 2+ high", () => {
    const low = (bad_rank_players: number): ScoreTeam => ({
      summary: summary({ bad_rank_players }),
    });
    expect(points({ teams: [low(0), low(2)], now: NOW }).low_rank_players).toBe(
      8,
    );
    expect(points({ teams: [low(1), low(0)], now: NOW }).low_rank_players).toBe(
      -5,
    );
  });

  it("uses head-to-head from 2 games", () => {
    expect(
      points({ ...example, headToHead: { team1Wins: 1, team2Wins: 0 } })
        .head_to_head,
    ).toBeUndefined();
    expect(
      points({ ...example, headToHead: { team1Wins: 2, team2Wins: 1 } })
        .head_to_head,
    ).toBeCloseTo(2 / 3);
  });
});

describe("probabilities", () => {
  it("turns a score into a map chance", () => {
    expect(mapWinProbability(0)).toBe(0.5);
    expect(mapWinProbability(41.025)).toBeCloseTo(0.652, 3);
    expect(mapWinProbability(-41.025)).toBeCloseTo(0.348, 3);
  });

  it("turns a map chance into a series chance", () => {
    expect(seriesWinProbability(0.6, 1)).toBeCloseTo(0.6);
    expect(seriesWinProbability(0.6, null)).toBeCloseTo(0.6);
    expect(seriesWinProbability(0.6, 3)).toBeCloseTo(0.648); // p^2 (3 - 2p)
    expect(seriesWinProbability(0.6, 5)).toBeCloseTo(0.68256); // p^3 (10 - 15p + 6p^2)
    expect(seriesWinProbability(0.6, 2)).toBeNull();
  });

  it("labels the favour by the favourite share", () => {
    expect(favour(0.52)).toBe("even");
    expect(favour(0.4)).toBe("slight");
    expect(favour(0.7)).toBe("clear");
    expect(favour(0.723)).toBe("strong");
  });
});

describe("bookmaker comparison", () => {
  it("removes the margin from the odds", () => {
    const fair = fairProbabilities(1.65, 2.2);
    expect(fair?.team1).toBeCloseTo(0.5714, 4);
    expect(fair?.team2).toBeCloseTo(0.4286, 4);
    expect(fair?.margin).toBeCloseTo(0.0606, 4);
    expect(fairProbabilities(1, 2)).toBeNull();
  });

  it("finds the value bet of the worked example", () => {
    const series =
      seriesWinProbability(mapWinProbability(computeScore(example).score), 3) ??
      0;
    expect(series).toBeCloseTo(0.722, 3);
    const ev = expectedValue(series, 1.65);
    expect(ev).toBeCloseTo(0.191, 3);
    expect(isValueBet(ev, computeScore(example).coverage)).toBe(true);
    expect(isValueBet(expectedValue(1 - series, 2.2), 1)).toBe(false);
  });

  it("does not flag value under 60% coverage", () => {
    expect(isValueBet(0.2, 0.5)).toBe(false);
    expect(isValueBet(0.05, 1)).toBe(false); // must be above +5%
  });
});
