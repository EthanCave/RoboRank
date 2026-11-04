# RoboRank

Scouting, ratings and match predictions for VEX V5 Robotics Competition (V5RC) teams. Built for one team: everyone signs in with one shared password.

- **Overview**: your team's season TrueSkill and world rank, record, OPR, skills best, rating trend, recent form, and next event.
- **Team pages** (`/teams/:number`): ratings, every match this season grouped by event, event rankings, awards, upcoming events, and shared scouting notes.
- **Events** (`/events`): search the whole season, with upcoming and past results.
- **Event pages** (`/events/:id`): the field ranked by TrueSkill, OPR and skills; the match list with win odds and projected scores; live rankings; skills standings.
- **Simulation** (`/events/:id/simulate`): Monte Carlo runs of qualifications, alliance selection and eliminations. It uses the real schedule (and results already played) when one is published.
- **Competition mode** (`/competition`): on match day, your next match, partner and opponent ratings, notes for each match, and live rankings. The page refreshes every minute.
- **Rankings** (`/rankings`): the season leaderboard by TrueSkill, OPR, CCWM or skills.

## How the data works

All data comes from the RobotEvents API, which moved to `https://events.vex.com/api/v2` in 2026 (existing tokens still work). RoboRank keeps its own index of the current season in SQLite, covering events, scored matches and skills runs, and computes every rating itself:

- **TrueSkill.** Every scored match of the season is replayed in time order (2v2, ties count as draws). Ratings are shown as μ − 3σ.
- **OPR / DPR / CCWM.** Least squares over each event's qualification matches. Season values are averages weighted by matches played.
- **Win probability.** Φ((Σμ_red − Σμ_blue) / √(Σσ² + 4β²)).
- **Skills best.** The best driver + programming total from a single event.

The first sync of a season takes a few minutes, because RobotEvents allows about 100 requests a minute. A banner shows progress while it runs. After that, the app re-syncs every 15 minutes in the background, and only re-checks events that are recent or still running.

## Setup

Requires Node.js 22.22 or newer.

```bash
npm install
cp .env.example .env   # then fill in the values
npm run dev            # http://localhost:5173
```

| Variable | Required | Notes |
| --- | --- | --- |
| `ROBOTEVENTS_API_TOKEN` | yes | From your RobotEvents account. Without it the app loads, but has no data. |
| `ROBORANK_LOGIN_PASSWORD` | in production | Shared team password. Defaults to `roborank` in development. |
| `SESSION_SECRET` | in production | A long random string that signs session cookies. |
| `ROBORANK_DEFAULT_TEAM` | no | Team number pre-filled at login. |
| `DATA_DIR` | no | Where `roborank.sqlite` lives. Default: `./data`. |
| `COOKIE_SECURE` | no | Set to `false` only when serving production over plain HTTP. |

## Scripts

```bash
npm run dev         # dev server
npm test            # unit tests (rating math + simulator)
npm run typecheck   # route typegen + tsc
npm run build       # production build
npm start           # serve the build (does not read .env; export the variables first)
```

## Deploying

```bash
docker compose up -d --build   # reads .env, stores data in the roborank-data volume
```

The SQLite file holds your scouting notes, so keep `/data` on a persistent volume. The season index can always be rebuilt from RobotEvents; the notes can't.

Notes from older versions (`app/data/*.json`) are imported automatically the first time the database is created.
