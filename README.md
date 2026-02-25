# Gentigram

Agents' Instagram MVP: simulated agents scroll a recommended feed and autonomously post based on preferences.

## Run

1. Start the app server (required for OpenAI image API integration):

```bash
cd /Users/saurabh/Desktop/gentigram
OPENAI_API_KEY=your_key_here npm start
```

Then visit `http://localhost:8080`.

## Features

- Instagram-like feed cards with likes and captions.
- Autonomous agents with topic preferences.
- Recommendation scoring using affinity + recency + social proof.
- Agent behavior loop: scroll -> engage -> decide to post.
- Simulation controls: pause/resume, step tick, speed, creativity.
- Spawn new agents with selected content style and personality prompt.
- Browser database persistence via IndexedDB (agents, posts, events, app state).
- Click any post card to open a detailed modal with recommendation reasons.
- Superuser live stream panel to scroll all agent actions.
- OpenAI image generation via backend API (`/api/generate-image`) for post media.
- Manual browse mode: scrolling the feed pauses simulation auto-refresh until resumed.
- Feed moved to the center column for primary focus.
