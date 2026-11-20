# Architecture

Flask + flask-smorest API (port 5000), Celery workers, React + Vite frontend (port 5173, proxies `/api`), SQLite and
Redis. The module map is in [.claude/codebase-map.md](../.claude/codebase-map.md).

## Services (`npm run dev`)
- Backend (Flask), frontend (Vite)
- Celery worker (default queue): Compare player statistics tasks
- Celery background worker (`-Q background`): cache jobs, so Compare never waits behind them
- Celery Beat: queues due cache jobs every minute

## Redis
Required: Celery broker and results (db 0), plus task progress, results and the volatile OpenDota / Liquipedia /
Pari caches, job state and the rate limiter (db 1). Keys and TTLs are listed in the codebase map. Tests use fakeredis.

## Databases (`instance/`, opened only through `backend/db.py`)
- `d2ba.sqlite`: OpenDota/Liquipedia cache (pro players, teams, team matches, lineups, heroes, sync state). Can be
  deleted and rebuilt; WAL mode, so delete it with its `-wal` and `-shm` files
- `predictions.sqlite`: your snapshots and predictions. Back it up; it can't be fetched again
- Migrations in `backend/migrations/` (and `predictions/`) are applied by `npm run migrate` and `npm run dev`

## Cache jobs
- Pro players (daily), heroes (weekly), teams list (daily), hero meta (hourly), Liquipedia matches (every 10 minutes)
  run on the `background` queue
- A due job (never run, or last success older than its limit) is queued by Beat and at startup; a failed one is
  retried after 10 minutes; one run at a time (Redis lock); last success kept in `sync_state`
- Teams: incremental update = 2 explorer requests (teams with a league game since the newest stored one, then their
  names); full update (empty table or `POST /api/jobs/teams/run?full=true`) = every `/teams` page, ~22 requests
- Run one now with Run in the Data line Details, or `curl -X POST http://localhost:5000/api/jobs/<name>/run`

## Rate limits
- Every OpenDota request goes through `backend/opendota.py`: retried on HTTP 429/403, timeouts and dropped connections,
  and paced by one Redis limiter shared by Flask and the workers: at most 50 requests per 60 s
  (`OPENDOTA_RATE_LIMIT`, `OPENDOTA_RATE_WINDOW`)
- User requests go first; background jobs wait. Daily budget `OPENDOTA_DAILY_LIMIT` (default 1800, 0 = none) stops
  only the jobs
- Liquipedia: 1 parse request per 30 s (`LIQUIPEDIA_RATE_WINDOW`); Pari: 5-minute cache
- Without Redis requests are not paced; the retry stays as the safety net
