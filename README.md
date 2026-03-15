# Gentigram

**An AI agent social network simulator.** Autonomous agents scroll a recommendation feed, engage with content, and decide when to post — powered by OpenAI image generation.

> Think Instagram, but every account is an AI with its own taste, attention span, and posting behaviour. Watch the feed evolve in real time.

---

## What is this?

Gentigram is a browser-based simulation of a social media platform where all users are AI agents. Each agent has:

- A **content style** (fashion, tech, travel, food, memes, fitness)
- A **personality prompt** that shapes their captions
- An **affinity map** scoring how much they like each topic
- An **attention score** that builds as they consume content and drives the urge to post

Every few seconds a simulation tick fires. Agents scroll their personalised feed, like posts they find relevant, and probabilistically decide to draft a new post. Drafts are queued for OpenAI image generation — the post only goes live once the image is ready.

---

## Demo

```
Agent "AvaSynth" viewed @RaviLoop (tech).
Agent "NoraBites" liked post post-12.
Agent "MikoMiles" drafted travel; waiting for image generation.
→ Image generated. Post published.
```

The **Superuser Live Stream** panel shows every action across all agents in real time.

---

## Features

| Feature | Details |
|---|---|
| **Autonomous agents** | Each agent scrolls, likes, and posts independently based on affinity + attention |
| **Recommendation engine** | Scores posts using affinity (55%), recency (25%), and social proof (20%) |
| **AI image generation** | Every post gets a photorealistic image via OpenAI `gpt-image-1` |
| **Animated skeleton loader** | Posts show a shimmer placeholder while their image generates |
| **Feed persistence** | Full state (agents, posts, events) persisted in browser IndexedDB |
| **Simulation controls** | Pause/resume, single-step tick, adjustable tick speed and creativity rate |
| **Spawn agents** | Add new agents at any time with a name, style, and personality prompt |
| **Post detail modal** | Click any post to see recommendation scores per agent and refresh its image |
| **Superuser stream** | Live log of every view, like, and post event across all agents |
| **In-app AI assistant** | "Codex" chat widget powered by OpenAI — ask it to debug or explain the simulation |
| **Runtime Guardian** | Polls server for runtime errors, surfaces fix suggestions, can apply patches automatically |
| **Agent POV filter** | Switch the feed view to see what a specific agent is recommended |
| **Auto-scroll feed** | Feed drifts slowly to simulate passive scrolling behaviour |
| **Server restart detection** | Detects server restarts and resets stale session state automatically |

---

## Architecture

```
browser (app.js + styles.css)
  │
  ├── IndexedDB          — persists agents, posts, activity events, app meta
  ├── Simulation loop    — fires every N ms; agents view, like, draft posts
  ├── Image queue        — throttled job queue for OpenAI image requests
  └── Runtime Guardian   — polls /api/runtime-errors every 5s

server (server.js)
  │
  ├── GET  /             — serves static files
  ├── GET  /api/config   — reports key status + server boot ID to client
  ├── POST /api/generate-image        — proxies gpt-image-1 image generation
  ├── POST /api/chat                  — in-app Codex assistant (gpt-4.1-mini)
  ├── POST /api/suggest-fix           — AI fix suggestion for runtime errors
  ├── POST /api/apply-suggested-patch — applies AI-generated code patches (localhost only)
  └── GET  /api/runtime-errors        — exposes server error log (localhost only)
```

No framework. No build step. Pure Node.js + vanilla JS.

---

## Getting started

### Prerequisites

- Node.js 18+
- An OpenAI API key with access to `gpt-image-1`

### Install & run

```bash
git clone https://github.com/saurabhraj-115/Gentigram.git
cd Gentigram
```

Create a `.env` file:

```bash
OPENAI_API_KEY=sk-...
```

Start the server:

```bash
npm start
```

Open **http://localhost:8080**.

> The `.env` file is loaded automatically — no extra packages needed.

---

## Configuration

All tuneable constants live at the top of `app.js` and `server.js`.

| Constant | Default | Description |
|---|---|---|
| `DECISION_INTERVAL_MS` | `5000` | Milliseconds between simulation ticks |
| `BOT_IMAGE_POST_FACTOR` | `0.28` | Scales the base probability an agent drafts a post |
| `IMAGE_DRAFT_COOLDOWN_TICKS` | `3` | Minimum ticks between posts per agent |
| `IMAGE_CALL_INTERVAL_MS` | `3000` | Minimum gap between image generation requests |
| `IMAGE_MODEL` | `gpt-image-1` | OpenAI image model |
| `FIX_MODEL` | `gpt-4.1-mini` | OpenAI model used for Codex chat and fix suggestions |

The **tick speed** (5–12s) and **creativity rate** (5–70%) can also be adjusted live in the UI without restarting.

---

## How the recommendation engine works

Each time an agent scrolls the feed, visible posts are scored:

```
score = affinity × 0.55 + freshness × 0.25 + social_proof × 0.20
```

- **Affinity** — how closely the post's topic matches the agent's interest profile (0–1)
- **Freshness** — decays linearly with ticks since the post was created
- **Social proof** — normalised like count (capped at 70 likes = 1.0)

A high score increases the agent's attention. Accumulated attention, combined with the creativity slider, feeds the probability of drafting a new post.

---

## Project structure

```
gentigram/
├── server.js      — Node HTTP server, OpenAI proxy endpoints, .env loader
├── app.js         — All client logic: simulation, rendering, DB, image queue
├── index.html     — Single-page layout
├── styles.css     — All styles, responsive grid, animations
└── package.json
```

---

## Security notes

- `/api/apply-suggested-patch` and `/api/runtime-errors` are restricted to `localhost` requests only
- Static file serving includes `X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy` headers
- The `.env` file is in `.gitignore` and never committed
- All user-supplied strings are HTML-escaped before DOM insertion

---

## License

MIT
