const TOPICS = {
  fashion: ["streetwear", "outfit check", "designer drop", "vintage fit", "thrift flip"],
  tech: ["ai workflow", "build in public", "robotics clip", "code tip", "product demo"],
  travel: ["hidden beach", "city walk", "train diary", "budget itinerary", "mountain trail"],
  food: ["late night ramen", "coffee ritual", "street tacos", "home recipe", "dessert lab"],
  memes: ["relatable fail", "office meme", "cat energy", "internet lore", "chaos post"],
  fitness: ["mobility flow", "gym split", "runner mindset", "meal prep", "progress log"]
};

const DB_NAME = "gentigram_db";
const DB_VERSION = 1;

const APP_STATE = {
  running: true,
  tickMs: 1000,
  creativityPercent: 24,
  tick: 0,
  nextPostSeq: 1,
  agents: [],
  feed: [],
  insights: [],
  activity: [],
  timer: null,
  db: null,
  persistTimer: null,
  userBrowsingFeed: false,
  imageApiReady: false,
  imageQueue: [],
  imageJobsActive: 0,
  imageJobsMax: 2
};

const ELS = {
  speed: document.getElementById("speed"),
  speedLabel: document.getElementById("speed-label"),
  postRate: document.getElementById("post-rate"),
  postRateLabel: document.getElementById("post-rate-label"),
  toggleBtn: document.getElementById("toggle-sim"),
  stepBtn: document.getElementById("tick-once"),
  resetBtn: document.getElementById("reset-feed"),
  agentForm: document.getElementById("agent-form"),
  agentName: document.getElementById("agent-name"),
  agentStyle: document.getElementById("agent-style"),
  agentPersonality: document.getElementById("agent-personality"),
  agentsList: document.getElementById("agents-list"),
  feedList: document.getElementById("feed-list"),
  feedMeta: document.getElementById("feed-meta"),
  insightsList: document.getElementById("insights-list"),
  superLogList: document.getElementById("super-log-list"),
  simState: document.getElementById("sim-state"),
  simDot: document.getElementById("sim-state-dot"),
  imageApiState: document.getElementById("image-api-state"),
  postModal: document.getElementById("post-modal"),
  closeModal: document.getElementById("close-modal"),
  modalMedia: document.getElementById("modal-media"),
  modalAuthor: document.getElementById("modal-author"),
  modalCaption: document.getElementById("modal-caption"),
  modalMeta: document.getElementById("modal-meta"),
  modalRecs: document.getElementById("modal-recs")
};

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safePersonality(personalityPrompt = "") {
  return personalityPrompt.trim().slice(0, 160);
}

function topicGradient(topic) {
  const presets = {
    fashion: ["#e45d4c", "#f2ab7b"],
    tech: ["#1e6bb7", "#34c8a0"],
    travel: ["#0f9976", "#7ecf83"],
    food: ["#c14953", "#f9b05f"],
    memes: ["#6f4bb8", "#ef8bff"],
    fitness: ["#157f1f", "#8ad879"]
  };
  return presets[topic] || ["#555", "#aaa"];
}

function mediaTitleFromTopic(topic) {
  const labelMap = {
    fashion: "Style Drop",
    tech: "Build Log",
    travel: "Route Story",
    food: "Kitchen Drop",
    memes: "Chaos Thread",
    fitness: "Motion Log"
  };
  return labelMap[topic] || "Story";
}

function composeCaption(topic, personalityPrompt = "") {
  const idea = TOPICS[topic][Math.floor(Math.random() * TOPICS[topic].length)];
  const base = ["new drop", "quick take", "watch this", "thoughts?", "live now"][Math.floor(Math.random() * 5)];
  const tone = safePersonality(personalityPrompt).toLowerCase();

  if (!tone) {
    return `${idea} | ${base}`;
  }
  if (tone.includes("sarcast")) {
    return `${idea}, obviously life-changing. ${base}`;
  }
  if (tone.includes("minimal")) {
    return `${idea}. ${base}.`;
  }
  if (tone.includes("cinematic")) {
    return `${idea} at golden hour. ${base} scene.`;
  }
  if (tone.includes("witty") || tone.includes("funny")) {
    return `${idea}, but make it chaotic. ${base}`;
  }
  if (tone.includes("documentary") || tone.includes("curious")) {
    return `${idea}. field note: ${base}.`;
  }
  if (tone.includes("bold")) {
    return `${idea}. ${base}, no filter.`;
  }

  return `${idea} | ${base}`;
}

function cleanLegacyCaption(caption = "") {
  const raw = String(caption);
  const segments = raw
    .split("|")
    .map((seg) => seg.trim())
    .filter(Boolean);
  let cleaned = segments.length > 2 ? `${segments[0]} | ${segments[1]}` : raw;
  cleaned = cleaned
    .replace(/this is a\s+\d+\s*year\s*old[^#\n]*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned;
}

function createAgent(name, style, personalityPrompt = "") {
  return {
    id: crypto.randomUUID(),
    name,
    style,
    personalityPrompt: safePersonality(personalityPrompt),
    attention: 0,
    postsCreated: 0,
    likesGiven: 0,
    seenPostIds: new Set(),
    affinity: Object.keys(TOPICS).reduce((acc, topic) => {
      acc[topic] = topic === style ? 1 : 0.35 + Math.random() * 0.25;
      return acc;
    }, {})
  };
}

function createPost(topic, author = "seed", personalityPrompt = "") {
  const [c1, c2] = topicGradient(topic);
  return {
    id: `post-${APP_STATE.nextPostSeq++}`,
    author,
    topic,
    caption: composeCaption(topic, personalityPrompt),
    likes: 3 + Math.floor(Math.random() * 32),
    createdAtTick: APP_STATE.tick,
    mediaType: Math.random() > 0.3 ? "image" : "video",
    mediaGradient: `linear-gradient(145deg, ${c1}, ${c2})`,
    mediaTitle: mediaTitleFromTopic(topic),
    mediaUrl: "",
    mediaStatus: "idle"
  };
}

function normalizePost(post) {
  const [c1, c2] = topicGradient(post.topic);
  return {
    ...post,
    caption: cleanLegacyCaption(post.caption),
    mediaType: post.mediaType || (Math.random() > 0.3 ? "image" : "video"),
    mediaGradient: post.mediaGradient || `linear-gradient(145deg, ${c1}, ${c2})`,
    mediaTitle: post.mediaTitle || mediaTitleFromTopic(post.topic),
    mediaUrl: post.mediaUrl || "",
    mediaStatus: post.mediaStatus || (post.mediaUrl ? "ready" : "idle")
  };
}

function addActivity(message, type = "system") {
  APP_STATE.activity.unshift({
    tick: APP_STATE.tick,
    type,
    message,
    happenedAt: Date.now()
  });
  APP_STATE.activity = APP_STATE.activity.slice(0, 300);
}

function setupInitialState() {
  APP_STATE.feed = [];
  APP_STATE.agents = [
    createAgent("AvaSynth", "fashion", "cinematic and bold"),
    createAgent("RaviLoop", "tech", "minimal and precise"),
    createAgent("MikoMiles", "travel", "curious and documentary"),
    createAgent("NoraBites", "food", "witty and warm")
  ];

  Object.keys(TOPICS).forEach((topic) => {
    for (let i = 0; i < 2; i += 1) {
      APP_STATE.feed.push(createPost(topic));
    }
  });

  APP_STATE.insights = [
    "Warm start: mixed topic feed created.",
    "Agents use affinity + recency + social proof for ranking.",
    "Personality prompts affect tone only, not direct text leakage."
  ];

  APP_STATE.activity = [];
  addActivity("System booted with seeded agents and posts.");
  APP_STATE.feed = APP_STATE.feed.map(normalizePost).sort((a, b) => (a.id < b.id ? 1 : -1));
}

function recommendationScore(agent, post) {
  const affinity = agent.affinity[post.topic] || 0.2;
  const freshness = Math.max(0.1, 1 - (APP_STATE.tick - post.createdAtTick) * 0.04);
  const socialProof = Math.min(1, post.likes / 70);
  return affinity * 0.55 + freshness * 0.25 + socialProof * 0.2;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("agents")) {
        db.createObjectStore("agents", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("posts")) {
        db.createObjectStore("posts", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("events")) {
        db.createObjectStore("events", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function persistSoon() {
  if (APP_STATE.persistTimer) {
    clearTimeout(APP_STATE.persistTimer);
  }

  APP_STATE.persistTimer = setTimeout(() => {
    persistState().catch(() => {
      addActivity("DB write failed in this browser session.", "error");
      renderSuperLog();
    });
  }, 250);
}

async function persistState() {
  if (!APP_STATE.db) {
    return;
  }

  const agents = APP_STATE.agents.map((agent) => ({
    ...agent,
    seenPostIds: Array.from(agent.seenPostIds)
  }));
  const posts = APP_STATE.feed.slice(0, 250);
  const events = APP_STATE.activity.slice(0, 300);

  const tx = APP_STATE.db.transaction(["agents", "posts", "events", "meta"], "readwrite");
  const agentsStore = tx.objectStore("agents");
  const postsStore = tx.objectStore("posts");
  const eventsStore = tx.objectStore("events");
  const metaStore = tx.objectStore("meta");

  agentsStore.clear();
  postsStore.clear();
  eventsStore.clear();

  agents.forEach((agent) => agentsStore.put(agent));
  posts.forEach((post) => postsStore.put(post));
  events.forEach((event) => eventsStore.add(event));

  metaStore.put({
    id: "app",
    running: APP_STATE.running,
    tick: APP_STATE.tick,
    nextPostSeq: APP_STATE.nextPostSeq,
    tickMs: APP_STATE.tickMs,
    creativityPercent: APP_STATE.creativityPercent,
    insights: APP_STATE.insights,
    userBrowsingFeed: APP_STATE.userBrowsingFeed
  });

  await transactionDone(tx);
}

async function loadState() {
  if (!APP_STATE.db) {
    setupInitialState();
    return;
  }

  const tx = APP_STATE.db.transaction(["agents", "posts", "events", "meta"], "readonly");
  const [agents, posts, events, meta] = await Promise.all([
    reqToPromise(tx.objectStore("agents").getAll()),
    reqToPromise(tx.objectStore("posts").getAll()),
    reqToPromise(tx.objectStore("events").getAll()),
    reqToPromise(tx.objectStore("meta").get("app"))
  ]);

  if (!posts.length || !agents.length || !meta) {
    setupInitialState();
    return;
  }

  APP_STATE.agents = agents.map((agent) => ({
    ...agent,
    personalityPrompt: safePersonality(agent.personalityPrompt),
    seenPostIds: new Set(agent.seenPostIds || [])
  }));
  APP_STATE.feed = posts.map(normalizePost);
  APP_STATE.activity = [...events].reverse().slice(0, 300);
  APP_STATE.running = Boolean(meta.running);
  APP_STATE.tick = Number(meta.tick || 0);
  APP_STATE.nextPostSeq = Number(meta.nextPostSeq || posts.length + 1);
  APP_STATE.tickMs = Number(meta.tickMs || 1000);
  APP_STATE.creativityPercent = Number(meta.creativityPercent || 24);
  APP_STATE.insights = Array.isArray(meta.insights) ? meta.insights : [];
  APP_STATE.userBrowsingFeed = Boolean(meta.userBrowsingFeed);

  addActivity("State restored from browser database.");
}

function createImagePrompt(post, personalityPrompt = "") {
  const tone = safePersonality(personalityPrompt) || "social media";
  return [
    `Create a vertical Instagram-style ${post.mediaType} frame.`,
    `Topic: ${post.topic}.`,
    `Caption intent: ${post.caption.replace(/#\w+/g, "").trim()}.`,
    `Tone: ${tone}.`,
    "No text overlays, no logos, no watermarks, photorealistic editorial composition."
  ].join(" ");
}

function enqueueImageGeneration(post, personalityPrompt = "") {
  if (!APP_STATE.imageApiReady || !post || post.mediaUrl || post.mediaStatus === "pending") {
    return;
  }

  post.mediaStatus = "pending";
  APP_STATE.imageQueue.push({ postId: post.id, prompt: createImagePrompt(post, personalityPrompt) });
  pumpImageQueue();
}

async function pumpImageQueue() {
  if (!APP_STATE.imageApiReady) {
    return;
  }

  while (APP_STATE.imageJobsActive < APP_STATE.imageJobsMax && APP_STATE.imageQueue.length > 0) {
    const job = APP_STATE.imageQueue.shift();
    const post = APP_STATE.feed.find((item) => item.id === job.postId);
    if (!post || post.mediaUrl) {
      continue;
    }

    APP_STATE.imageJobsActive += 1;
    requestOpenAIImage(job.prompt)
      .then((imageUrl) => {
        if (!imageUrl) {
          post.mediaStatus = "failed";
          return;
        }
        post.mediaUrl = imageUrl;
        post.mediaStatus = "ready";
        addActivity(`Image generated for ${post.id} via OpenAI API.`, "image");
        renderFeed();
        renderSuperLog();
        persistSoon();
      })
      .catch(() => {
        post.mediaStatus = "failed";
      })
      .finally(() => {
        APP_STATE.imageJobsActive -= 1;
        pumpImageQueue();
      });
  }
}

async function requestOpenAIImage(prompt) {
  const response = await fetch("/api/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, size: "1024x1536" })
  });

  if (!response.ok) {
    throw new Error("image generation failed");
  }

  const payload = await response.json();
  return payload.imageUrl || "";
}

async function checkApiConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) {
      throw new Error("config unavailable");
    }
    const payload = await response.json();
    APP_STATE.imageApiReady = Boolean(payload.imageApiReady);
  } catch {
    APP_STATE.imageApiReady = false;
  }
}

function queueImagesForVisibleFeed() {
  if (!APP_STATE.imageApiReady) {
    return;
  }

  APP_STATE.feed.slice(0, 40).forEach((post) => {
    if (!post.mediaUrl && post.mediaStatus !== "pending") {
      const authorAgent = APP_STATE.agents.find((agent) => agent.name === post.author);
      enqueueImageGeneration(post, authorAgent?.personalityPrompt || "");
    }
  });
}

function runTick() {
  APP_STATE.tick += 1;
  const newInsights = [];

  APP_STATE.agents.forEach((agent) => {
    const ranked = [...APP_STATE.feed]
      .filter((post) => !agent.seenPostIds.has(post.id))
      .map((post) => ({ post, score: recommendationScore(agent, post) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    if (!ranked.length) {
      return;
    }

    const viewed = ranked[Math.floor(Math.random() * Math.min(3, ranked.length))];
    agent.seenPostIds.add(viewed.post.id);
    agent.attention += viewed.score;
    addActivity(`${agent.name} viewed @${viewed.post.author} (${viewed.post.topic}).`, "view");

    if (viewed.score > 0.55 && Math.random() > 0.35) {
      viewed.post.likes += 1;
      agent.likesGiven += 1;
      addActivity(`${agent.name} liked post ${viewed.post.id}.`, "like");
    }

    const boostedChance =
      APP_STATE.creativityPercent / 100 +
      (viewed.score > 0.7 ? 0.12 : 0) +
      Math.min(0.12, agent.attention * 0.008);

    if (Math.random() < boostedChance) {
      const preferred = Object.entries(agent.affinity)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([topic]) => topic);

      const chosenTopic = preferred[Math.floor(Math.random() * preferred.length)];
      const post = createPost(chosenTopic, agent.name, agent.personalityPrompt);
      post.caption = `${post.caption} #${chosenTopic} #gentigram`;
      post.likes = 0;
      APP_STATE.feed.unshift(post);
      agent.postsCreated += 1;
      agent.attention = Math.max(0, agent.attention - 0.6);
      const signal = viewed.score.toFixed(2);
      newInsights.push(`${agent.name} posted ${chosenTopic} after scrolling signal ${signal}.`);
      addActivity(`${agent.name} posted ${post.mediaType} content on ${chosenTopic}.`, "post");
      enqueueImageGeneration(post, agent.personalityPrompt);
    }
  });

  APP_STATE.feed = APP_STATE.feed.slice(0, 250);

  if (!newInsights.length) {
    newInsights.push("No new post this tick: agents mostly consumed recommendations.");
  }

  APP_STATE.insights = [...newInsights, ...APP_STATE.insights].slice(0, 10);
  render();
  persistSoon();
}

function startLoop() {
  if (APP_STATE.timer) {
    clearInterval(APP_STATE.timer);
  }

  APP_STATE.timer = setInterval(() => {
    if (APP_STATE.running) {
      runTick();
    }
  }, APP_STATE.tickMs);
}

function renderAgents() {
  ELS.agentsList.innerHTML = APP_STATE.agents
    .map(
      (agent) => `
      <article class="agent-card">
        <div class="agent-head">
          <strong>${esc(agent.name)}</strong>
          <span class="badge">${esc(agent.style)}</span>
        </div>
        <p class="meta">Posts: ${agent.postsCreated} | Likes: ${agent.likesGiven}</p>
        <p class="meta">Attention score: ${agent.attention.toFixed(2)}</p>
        <p class="meta">Persona: ${esc(agent.personalityPrompt || "default")}</p>
      </article>`
    )
    .join("");
}

function renderPostMedia(post) {
  if (post.mediaUrl) {
    return `<img class="media-image" src="${esc(post.mediaUrl)}" alt="${esc(post.mediaTitle)}" loading="lazy" />`;
  }

  const kicker = post.mediaType === "video" ? "REEL" : "PHOTO";
  return `<span class="media-kicker">${kicker}</span><span class="media-title">${esc(post.mediaTitle)}</span>`;
}

function renderFeed() {
  ELS.feedMeta.textContent = `${APP_STATE.feed.length} posts${APP_STATE.userBrowsingFeed ? " · manual browse" : ""}`;
  ELS.feedList.innerHTML = APP_STATE.feed
    .slice(0, 70)
    .map(
      (post) => `
      <article class="post" data-post-id="${esc(post.id)}" role="button" tabindex="0">
        <div class="post-media" style="background:${esc(post.mediaGradient)}">${renderPostMedia(post)}</div>
        <strong>@${esc(post.author)}</strong>
        <p>${esc(post.caption)}</p>
        <div class="post-foot">
          <span>${esc(post.topic)} · ${esc(post.mediaType)}</span>
          <span>${post.likes} likes</span>
        </div>
      </article>`
    )
    .join("");
}

function renderInsights() {
  ELS.insightsList.innerHTML = APP_STATE.insights.map((item) => `<li>${esc(item)}</li>`).join("");
}

function renderSuperLog() {
  ELS.superLogList.innerHTML = APP_STATE.activity
    .slice(0, 180)
    .map((event) => `<li>[t${event.tick}] ${esc(event.message)}</li>`)
    .join("");
}

function renderSimState() {
  ELS.simState.textContent = APP_STATE.running ? "Running" : "Paused";
  ELS.simDot.classList.toggle("running", APP_STATE.running);
  ELS.simDot.classList.toggle("paused", !APP_STATE.running);
  ELS.toggleBtn.textContent = APP_STATE.running ? "Pause" : "Resume";
}

function renderControlValues() {
  ELS.speed.value = String(APP_STATE.tickMs);
  ELS.speedLabel.textContent = `${(APP_STATE.tickMs / 1000).toFixed(1)}s`;
  ELS.postRate.value = String(APP_STATE.creativityPercent);
  ELS.postRateLabel.textContent = `${APP_STATE.creativityPercent}%`;
  ELS.imageApiState.textContent = APP_STATE.imageApiReady
    ? "Image API: OpenAI connected"
    : "Image API: unavailable (start server with OPENAI_API_KEY)";
}

function render() {
  renderAgents();
  renderFeed();
  renderInsights();
  renderSuperLog();
  renderSimState();
  renderControlValues();
}

function openPostModal(postId) {
  const post = APP_STATE.feed.find((item) => item.id === postId);
  if (!post) {
    return;
  }

  const recs = APP_STATE.agents
    .map((agent) => ({
      agent: agent.name,
      score: recommendationScore(agent, post)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  ELS.modalMedia.style.background = post.mediaGradient;
  ELS.modalMedia.innerHTML = renderPostMedia(post);
  ELS.modalAuthor.textContent = `@${post.author} (${post.mediaType})`;
  ELS.modalCaption.textContent = post.caption;
  ELS.modalMeta.textContent = `${post.topic} · ${post.likes} likes · created at tick ${post.createdAtTick}`;
  ELS.modalRecs.innerHTML = recs
    .map((item) => `<li>${esc(item.agent)} recommendation score: ${item.score.toFixed(2)}</li>`)
    .join("");

  ELS.postModal.classList.remove("hidden");
  ELS.postModal.setAttribute("aria-hidden", "false");
}

function closePostModal() {
  ELS.postModal.classList.add("hidden");
  ELS.postModal.setAttribute("aria-hidden", "true");
}

function pauseForManualBrowse() {
  if (APP_STATE.userBrowsingFeed) {
    return;
  }

  APP_STATE.userBrowsingFeed = true;
  APP_STATE.running = false;
  addActivity("Simulation paused for manual feed browsing.", "system");
  renderSimState();
  renderFeed();
  renderSuperLog();
  persistSoon();
}

ELS.speed.addEventListener("input", (event) => {
  APP_STATE.tickMs = Number(event.target.value);
  ELS.speedLabel.textContent = `${(APP_STATE.tickMs / 1000).toFixed(1)}s`;
  startLoop();
  persistSoon();
});

ELS.postRate.addEventListener("input", (event) => {
  APP_STATE.creativityPercent = Number(event.target.value);
  ELS.postRateLabel.textContent = `${APP_STATE.creativityPercent}%`;
  persistSoon();
});

ELS.toggleBtn.addEventListener("click", () => {
  APP_STATE.running = !APP_STATE.running;
  if (APP_STATE.running) {
    APP_STATE.userBrowsingFeed = false;
  }
  renderSimState();
  renderFeed();
  addActivity(`Simulation ${APP_STATE.running ? "resumed" : "paused"}.`, "system");
  renderSuperLog();
  persistSoon();
});

ELS.stepBtn.addEventListener("click", () => {
  runTick();
});

ELS.resetBtn.addEventListener("click", () => {
  APP_STATE.tick = 0;
  APP_STATE.nextPostSeq = 1;
  APP_STATE.userBrowsingFeed = false;
  APP_STATE.imageQueue = [];
  setupInitialState();
  render();
  queueImagesForVisibleFeed();
  persistSoon();
});

ELS.agentForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = ELS.agentName.value.trim();
  const style = ELS.agentStyle.value;
  const personalityPrompt = safePersonality(ELS.agentPersonality.value);
  if (!name) {
    return;
  }

  APP_STATE.agents.push(createAgent(name, style, personalityPrompt));
  APP_STATE.insights.unshift(`New agent ${name} joined with ${style} preference.`);
  APP_STATE.insights = APP_STATE.insights.slice(0, 10);
  addActivity(`New agent joined: ${name} (${style}).`, "system");
  ELS.agentName.value = "";
  ELS.agentPersonality.value = "";
  render();
  persistSoon();
});

ELS.feedList.addEventListener("click", (event) => {
  const card = event.target.closest(".post");
  if (!card) {
    return;
  }
  openPostModal(card.dataset.postId);
});

ELS.feedList.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }
  const card = event.target.closest(".post");
  if (!card) {
    return;
  }
  openPostModal(card.dataset.postId);
});

ELS.feedList.addEventListener("wheel", pauseForManualBrowse, { passive: true });
ELS.feedList.addEventListener("touchstart", pauseForManualBrowse, { passive: true });
ELS.feedList.addEventListener("scroll", pauseForManualBrowse, { passive: true });

ELS.closeModal.addEventListener("click", closePostModal);
ELS.postModal.addEventListener("click", (event) => {
  if (event.target === ELS.postModal) {
    closePostModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closePostModal();
  }
});

async function init() {
  try {
    APP_STATE.db = await openDatabase();
    await loadState();
  } catch {
    setupInitialState();
    addActivity("Database unavailable; running in memory mode.", "error");
  }

  await checkApiConfig();
  render();
  queueImagesForVisibleFeed();
  startLoop();
  persistSoon();
}

init();
