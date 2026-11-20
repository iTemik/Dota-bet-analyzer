# Development

Start with the [Quick Start](../README.md#-quick-start). Code rules are in [.claude/CLAUDE.md](../.claude/CLAUDE.md).

## Running single services

```bash
npm run backend             # Flask, http://localhost:5000
npm run frontend            # Vite, http://localhost:5173
npm run celery              # Compare tasks
npm run celery:background   # cache jobs (queue background)
npm run celery:beat         # queues due cache jobs every minute
```

npm scripts use the venv's Python (`scripts/run-with-venv.js`), so no activation is needed. Workers use the `solo`
pool because Windows has no `prefork`. `start-dev.ps1` / `start-dev.sh` are older alternatives to `npm run dev`.

## Tests

```bash
npm test                                   # backend + frontend
python -m pytest tests/ -q                 # backend only
python -m pytest tests/test_x.py::test_y   # one test
cd frontend && npx vitest run              # frontend only
```

- Reports: `test-results/backend/junit.xml`, `test-results/frontend/junit.xml`
- No Redis needed (fakeredis); every test gets temporary databases (`tests/conftest.py` fixtures `app`, `client`)
- Tests never hit the network: a real HTTP request fails the test, and only `backend/opendota.py`,
  `backend/matches.py` and `backend/bookmakers.py` may import `requests` (`tests/test_network_guard.py`)
- Frontend tests sit next to each component; see [frontend/TEST_GUIDE.md](../frontend/TEST_GUIDE.md)

## Code quality

```bash
pre-commit install                        # once per machine
python -m pre_commit run --all-files      # Black, isort, Ruff, mypy, whitespace, YAML/JSON
```

## VS Code
- Interpreter: "Python: Select Interpreter" → `.venv\Scripts\python.exe` or `.venv/bin/python`
- Useful extensions: Python, GitLens, SQLite (alexcvzz.vscode-sqlite)
