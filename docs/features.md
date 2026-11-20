# Features

All endpoints are under `/api/`; request and response schemas are in Swagger UI (http://localhost:5000/api/swagger-ui).

## Core Features

### Compare (`/statistics`)
- Compare two teams side by side; `?team=` (name) or `?team_id=`, `days` (default 20) sets the window for the roster
  and player match history
- One OpenDota request per team (`/teams/{id}` by ID, or an explorer query by name; logo from the local teams table),
  then a Celery task for the player statistics (see below)
- Form with team search, Enter to submit; Upcoming and Finished Matches tables below (clicking an upcoming match
  fills both teams and checks statistics)
- Rows empty for both teams are hidden; each row has an "i" tooltip that explains the number, its colour rules and
  why it matters (texts in each row of `ComparisonTable.tsx` and `InsightsTable.tsx`)
- Green = better, red = worse (inverse for rank and low-rank player counts)
- Last Match is red for a team without a tournament game in 14 days while the other team has one

### Roster
- `players`: the 5 players with the most league games in the window, each with `games` out of `roster_games`
- `other_players`: others who played in the window, then OpenDota team members without league games (`games` 0)
- `is_core`: exactly 5 players with 75% (else 50%) of the games, otherwise no clear core (`classify_roster`)
- `standins_count`, `roster_state` (`stable`, `standins`, `new_team`), `latest_match_standins`: players outside the core
- `league_form`: league W/L in the window (pubs excluded), Radiant W/L, median match duration, and medians of each
  game's top 1 and top 2 GPM and XPM (`farm`)
- `rating_change`: estimated Elo change over the window, worked back from today's rating with opponent ratings from
  the local teams table (no extra request)
- Falls back to OpenDota team membership (marked unconfirmed) when there was no league match in the window
- Team Insights shows core players, stand-ins, other players and the last tournament match; unnamed accounts show as
  "ID 123…"; each player shows "games: N" and, after the player task, "rank: R"

### Player statistics task (`/statistics/players`)
- Celery task: match history and leaderboard rank of up to 10 players; average rank, players outside the top 150,
  win % in rating matches, tournament / rating / other match counts, matches per player
- The client follows `/stream-progress/<task_id>` (JSON lines on every change, reopened after 30 s without one), then
  reads `/results/<task_id>`; a failed task's error shows at once, a new search cancels the old one

### Team meta (Team Insights "Meta" and "Meta Heroes")
- Does the team play the Meta tab's pro/ultra heroes, from its 15 newest tournament games (recent window first, then
  60 days): actively (2+ meta heroes in over 65% of drafts and 3+ in over 50%), doesn't play (2+ in 50% or less, or
  3+ in 35% or less while 2+ is 65% or less), tries (in between); with fewer than 10 games: players know meta (core
  players' league or pub practice) or no info. The two shares are shown green/red by the thresholds
- Team Comparison "Hero Pool": wide (over 40), normal or narrow (under 30) different heroes in the same 15 games; the
  bigger pool is green when they differ by more than 3
- "X of Y meta heroes", then the picked meta heroes (3+ team games) with games and ultra/60d tags; windows start at the
  latest patch (shown in the Meta tab name); thresholds are `/statistics` query parameters

### Team score (Compare and prediction detail)
- One weighted score for team 1 vs team 2: each scored Team Comparison / Team Insights row (and head-to-head on a
  prediction) gives an edge from -1 to +1 times its weight (none 0, low 2, mediocre 5, high/huge 8), some only past a
  threshold; rules without data are skipped and the share of weight with data is shown (under 60%: low confidence)
- Match win chance: map chance = 1 / (1 + 10^(-score / 150)), turned into the Bo1/Bo3/Bo5 series chance (Bo2 and n/a
  show the map chance), favour label (even, slight, clear, strong favourite at 55/62/72%), each rule's points as a bar
- The score and a "Better"/"Worse" tag sit under the team names in Team Comparison and on Log prediction's "Bet on"
- Each rule lives in its table row (`score`), so a new scored row joins the score by itself; no DB change
- "Score weights" tab (`#weights`): every scored-table row, weight word per tier, limits, points per word and the
  confidence knob; kept in the browser, reset per rule or all
- With odds: fair chance per team without the bookmaker margin, and value = our series chance × odds - 1, "value bet"
  above +5% when data covers 60%+ of the weight (Bo1/Bo3/Bo5 only)

### Snapshots (`/snapshots`)
- `POST /snapshots` saves what Compare shows for one team (team data, player summary, ranks, team meta)
- One snapshot per team + UTC day + `days` + latest league match; saving the same key again refreshes it (200)
- `GET /snapshots?team_id=&from=&to=`, `GET /snapshots/<id>`; stored in `predictions.sqlite`, no OpenDota requests

### Prediction log (`/predictions`)
- `POST /predictions`: a series-win prediction from two snapshots: odds per team, `best_of` (1, 2, 3, 5 or null),
  bet team, optional `stake`, comment. Logging works before the player statistics load (snapshots saved without them)
- `PUT /predictions/<id>` edits odds, `best_of`, bet, stake and comment; a snapshot used by a prediction is no longer
  refreshed. `PATCH /predictions/<id>` saves the review (maps won per team, must fit `best_of`) and a note
- `GET /predictions?status=pending|settled` lists them with `bet_won`; `GET /predictions/<id>` includes both snapshots;
  `DELETE /predictions/<id>` keeps the snapshots
- `GET /predictions/<id>/head-to-head`: league matches between the two teams from `days` before the prediction up to
  now, from team 1's cached team matches (0-1 OpenDota requests)
- Predictions tab: list in the Finished Matches layout (10 per page), filter all/pending/settled, totals line
  "Bets: n (+/-net) · Won: n (+profit) · Lost: n (-stakes) · Pending: n (+A/-B)"; profit = stake × (odds - 1),
  loss = stake, net = won profit minus lost stakes; amounts are a simulation, not real money
- "Recommended bet" column: the same stake on the team our score favours (scored again from the snapshots with the
  current weights); the Bet column tags your bet "Better"/"Worse"
- Detail (`#predictions/<id>`): the saved tables, Head-to-head (matches before the prediction tagged, a "Prediction
  saved" row between), score, Add/Edit review, Edit, Delete

### Bookmaker odds (`/odds/pari`)
- `GET /odds/pari?team1=&team2=&tag1=&tag2=`: Pari's match-winner odds of the soonest series of the two teams, in the
  requested order; teams match by name, normalized name or tag; a 404 lists the series Pari has
- "Get odds from Pari" on Log prediction fills both coefficients (still editable)

### Heroes and hero meta (`/heroes`, `/heroes/meta`, Meta tab)
- `GET /heroes`: id, names and icon from d2ba.sqlite (filled weekly by the `heroes` job)
- Pro meta: Pick + Ban rate in pro matches above a threshold (default 40%); ultra meta: pro meta with a win rate and
  pick count above thresholds; pub meta: of the N most picked Immortal/Divine/Ancient heroes, those above a win rate
- One `/heroStats` request (about the last 7 days), refreshed hourly; `refresh=true` at most once a minute; defaults in
  `backend/meta.py` `MetaParams`
- Meta tab: one sortable table (Pro P+B, Pro Win, Pub Picks, Pub Win with bars, golden ★ Ultra rows); thresholds kept
  in the browser

### Matches (`/matches`)
- Upcoming (soonest first) and recently finished pro series: time, tournament (name, Liquipedia link, icon), Bo, teams,
  score; from Liquipedia's free API, credited under the tables (CC-BY-SA)
- Teams are matched by name (ignoring case, punctuation, "(stack)", "Esports") to the teams table for ID and logo

### Data status (`/jobs`)
- "Data" line under the tabs: "Data up to date" (hover for each job's last update), the running job or a limiter wait,
  a failed job in red with Retry, and "OpenDota today: 340 / 1800" with a bar; Details lists the jobs with Run
- `GET /jobs`, `GET /jobs/stream` (JSON lines on change), `POST /jobs/<name>/run` (409 when queued or running;
  `?full=true` for `teams`). See [architecture](architecture.md#cache-jobs)

### Tabs
Compare, Predictions, Meta and Score weights, kept in the URL hash (`#compare`, `#predictions`, `#meta`, `#weights`).
