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
const DECISION_INTERVAL_MS = 5000;
const BOT_IMAGE_POST_FACTOR = 0.28;
const IMAGE_DRAFT_COOLDOWN_TICKS = 3;
const FORCE_FRESH_BOOT = false;
const SERVER_BOOT_STORAGE_KEY = "gentigram_server_boot_id";
const IMAGE_CALL_INTERVAL_MS = 3000;

const APP_STATE = {
  running: true,
  tickMs: DECISION_INTERVAL_MS,
  creativityPercent: 24,
  tick: 0,
  nextPostSeq: 1,
  agents: [],
  feed: [],
  insights: [],
  activity: [],
  imageErrors: [],
  timer: null,
  db: null,
  persistTimer: null,
  userBrowsingFeed: false,
  imageApiReady: false,
  openAiKeyPresent: false,
  openAiKeyValidFormat: false,
  imageQueue: [],
  imageJobsActive: 0,
  imageJobsMax: 1,
  lastImageError: "",
  runtimeGuardianEnabled: true,
  runtimeGuardianAutoReload: false,
  runtimeLogs: [],
  runtimePollTimer: null,
  runtimePollFailures: 0,
  modalLastFocusedEl: null,
  serverBootId: "",
  nextImageCallAt: 0,
  autoScrollTimer: null,
  selectedAgentId: "all",
  visualActions: [],
  chatMessages: [
    { role: "bot", text: "I am connected in-app. Ask me to debug or improve this app." }
  ]
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
  agentPov: document.getElementById("agent-pov"),
  refreshFeedViewBtn: document.getElementById("refresh-feed-view"),
  feedList: document.getElementById("feed-list"),
  feedMeta: document.getElementById("feed-meta"),
  insightsList: document.getElementById("insights-list"),
  superLogList: document.getElementById("super-log-list"),
  imageErrorList: document.getElementById("image-error-list"),
  clearImageErrorsBtn: document.getElementById("clear-image-errors"),
  startNewSessionBtn: document.getElementById("start-new-session"),
  guardianToggle: document.getElementById("guardian-toggle"),
  guardianAutoreload: document.getElementById("guardian-autoreload"),
  guardianState: document.getElementById("guardian-state"),
  runtimeErrorList: document.getElementById("runtime-error-list"),
  chatList: document.getElementById("chat-list"),
  chatForm: document.getElementById("chat-form"),
  chatInput: document.getElementById("chat-input"),
  simState: document.getElementById("sim-state"),
  simDot: document.getElementById("sim-state-dot"),
  imageApiState: document.getElementById("image-api-state"),
  keyMissingBanner: document.getElementById("key-missing-banner"),
  keyWarningTitle: document.getElementById("key-warning-title"),
  keyWarningText: document.getElementById("key-warning-text"),
  postModal: document.getElementById("post-modal"),
  closeModal: document.getElementById("close-modal"),
  refreshModalImageBtn: document.getElementById("refresh-modal-image"),
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

  if (!tone) return `${idea} | ${base}`;
  if (tone.includes("sarcast")) return `${idea}, obviously life-changing. ${base}`;
  if (tone.includes("minimal")) return `${idea}. ${base}.`;
  if (tone.includes("cinematic")) return `${idea} at golden hour. ${base} scene.`;
  if (tone.includes("witty") || tone.includes("funny")) return `${idea}, but make it chaotic. ${base}`;
  if (tone.includes("documentary") || tone.includes("curious")) return `${idea}. field note: ${base}.`;
  if (tone.includes("bold")) return `${idea}. ${base}, no filter.`;
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
    lastDraftTick: -1000,
    postsCreated: 0,
    likesGiven: 0,
    seenPostIds: new Set(),
    affinity: Object.keys(TOPICS).reduce((acc, topic) => {
      acc[topic] = topic === style ? 1 : 0.35 + Math.random() * 0.25;
      return acc;
    }, {})
  };
}

function createPost(topic, author = "system", personalityPrompt = "") {
  const [c1, c2] = topicGradient(topic);
  return {
    id: `post-${APP_STATE.nextPostSeq++}`,
    author,
    topic,
    caption: composeCaption(topic, personalityPrompt),
    likes: 0,
    createdAtTick: APP_STATE.tick,
    mediaType: "image",
    mediaGradient: `linear-gradient(145deg, ${c1}, ${c2})`,
    mediaTitle: mediaTitleFromTopic(topic),
    mediaUrl: "",
    mediaStatus: "idle",
    mediaAttempts: 0,
    mediaError: ""
  };
}

function normalizePost(post) {
  const [c1, c2] = topicGradient(post.topic);
  return {
    ...post,
    caption: cleanLegacyCaption(post.caption),
    mediaType: "image",
    mediaGradient: post.mediaGradient || `linear-gradient(145deg, ${c1}, ${c2})`,
    mediaTitle: post.mediaTitle || mediaTitleFromTopic(post.topic),
    mediaUrl: post.mediaUrl || "",
    mediaStatus: post.mediaStatus || (post.mediaUrl ? "ready" : "idle"),
    mediaAttempts: Number(post.mediaAttempts || 0),
    mediaError: String(post.mediaError || "")
  };
}

function migrateLegacySeedAuthor(post, agents) {
  if (post.author !== "seed") return post;
  const byTopic = agents.find((agent) => agent.style === post.topic);
  const fallback = agents[0];
  return {
    ...post,
    author: byTopic?.name || fallback?.name || "system"
  };
}

function isPostInFeed(postId) {
  return APP_STATE.feed.some((post) => post.id === postId);
}

function addActivity(message, type = "system") {
  APP_STATE.activity.unshift({
    tick: APP_STATE.tick,
    type,
    message,
    happenedAt: Date.now()
  });
  APP_STATE.activity = APP_STATE.activity.slice(0, 350);
}

function addImageError(message) {
  const ts = new Date().toLocaleTimeString();
  const item = `[${ts}] [t${APP_STATE.tick}] ${message}`;
  APP_STATE.imageErrors.unshift(item);
  APP_STATE.imageErrors = APP_STATE.imageErrors.slice(0, 200);
  APP_STATE.lastImageError = message;
}

function addRuntimeLog(message, source = "client", suggestion = "") {
  APP_STATE.runtimeLogs.unshift({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    source,
    message,
    suggestion
  });
  APP_STATE.runtimeLogs = APP_STATE.runtimeLogs.slice(0, 120);
}

function setupInitialState() {
  APP_STATE.feed = [];
  APP_STATE.agents = [
    createAgent("AvaSynth", "fashion", "cinematic and bold"),
    createAgent("RaviLoop", "tech", "minimal and precise"),
    createAgent("MikoMiles", "travel", "curious and documentary"),
    createAgent("NoraBites", "food", "witty and warm")
  ];

  APP_STATE.insights = [
    "Warm start created.",
    "Agents use affinity + recency + social proof for ranking.",
    "Posts publish only after image generation succeeds."
  ];

  APP_STATE.activity = [];
  APP_STATE.imageErrors = [];
  APP_STATE.imageQueue = [];
  APP_STATE.imageJobsActive = 0;
  addActivity("System booted.");
}

function seedInitialPosts() {
  if (!APP_STATE.imageApiReady) {
    return;
  }

  const starters = APP_STATE.agents.length
    ? APP_STATE.agents.map((agent) => ({
        author: agent.name,
        topic: agent.style,
        personalityPrompt: agent.personalityPrompt
      }))
    : [{ author: "system", topic: "fashion", personalityPrompt: "cinematic" }];

  starters.forEach((item) => {
    const draft = createPost(item.topic, item.author, item.personalityPrompt);
    draft.likes = 2 + Math.floor(Math.random() * 12);
    enqueueImageGeneration(draft, item.personalityPrompt, {
      publishOnSuccess: true,
      agentId: null,
      signal: 0.72
    });
  });
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
      if (!db.objectStoreNames.contains("agents")) db.createObjectStore("agents", { keyPath: "id" });
      if (!db.objectStoreNames.contains("posts")) db.createObjectStore("posts", { keyPath: "id" });
      if (!db.objectStoreNames.contains("events")) db.createObjectStore("events", { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "id" });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function persistSoon() {
  if (APP_STATE.persistTimer) clearTimeout(APP_STATE.persistTimer);

  APP_STATE.persistTimer = setTimeout(() => {
    persistState().catch(() => {
      addActivity("DB write failed.", "error");
      renderSuperLog();
    });
  }, 250);
}

async function persistState() {
  if (!APP_STATE.db) return;

  const agents = APP_STATE.agents.map((agent) => ({
    ...agent,
    seenPostIds: Array.from(agent.seenPostIds)
  }));

  const tx = APP_STATE.db.transaction(["agents", "posts", "events", "meta"], "readwrite");
  const agentsStore = tx.objectStore("agents");
  const postsStore = tx.objectStore("posts");
  const eventsStore = tx.objectStore("events");
  const metaStore = tx.objectStore("meta");

  agentsStore.clear();
  postsStore.clear();
  eventsStore.clear();

  agents.forEach((agent) => agentsStore.put(agent));
  APP_STATE.feed.slice(0, 250).forEach((post) => postsStore.put(post));
  APP_STATE.activity.slice(0, 350).forEach((event) => eventsStore.add(event));

  metaStore.put({
    id: "app",
    running: APP_STATE.running,
    tick: APP_STATE.tick,
    nextPostSeq: APP_STATE.nextPostSeq,
    tickMs: APP_STATE.tickMs,
    creativityPercent: APP_STATE.creativityPercent,
    insights: APP_STATE.insights,
    userBrowsingFeed: APP_STATE.userBrowsingFeed,
    imageErrors: APP_STATE.imageErrors,
    lastImageError: APP_STATE.lastImageError,
    runtimeGuardianEnabled: APP_STATE.runtimeGuardianEnabled,
    runtimeGuardianAutoReload: APP_STATE.runtimeGuardianAutoReload,
    runtimeLogs: APP_STATE.runtimeLogs
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

  if (!agents.length || !meta) {
    setupInitialState();
    return;
  }

  APP_STATE.agents = agents.map((agent) => ({
    ...agent,
    personalityPrompt: safePersonality(agent.personalityPrompt),
    lastDraftTick: Number(agent.lastDraftTick ?? -1000),
    seenPostIds: new Set(agent.seenPostIds || [])
  }));
  APP_STATE.feed = posts
    .map(normalizePost)
    .map((post) => migrateLegacySeedAuthor(post, APP_STATE.agents));
  APP_STATE.activity = [...events].reverse().slice(0, 350);
  APP_STATE.running = Boolean(meta.running);
  APP_STATE.tick = Number(meta.tick || 0);
  APP_STATE.nextPostSeq = Number(meta.nextPostSeq || posts.length + 1);
  APP_STATE.tickMs = Math.max(DECISION_INTERVAL_MS, Number(meta.tickMs || DECISION_INTERVAL_MS));
  APP_STATE.creativityPercent = Number(meta.creativityPercent || 24);
  APP_STATE.insights = Array.isArray(meta.insights) ? meta.insights : [];
  APP_STATE.userBrowsingFeed = Boolean(meta.userBrowsingFeed);
  APP_STATE.imageErrors = Array.isArray(meta.imageErrors) ? meta.imageErrors : [];
  APP_STATE.lastImageError = String(meta.lastImageError || "");
  APP_STATE.runtimeGuardianEnabled = meta.runtimeGuardianEnabled !== false;
  APP_STATE.runtimeGuardianAutoReload = Boolean(meta.runtimeGuardianAutoReload);
  APP_STATE.runtimeLogs = Array.isArray(meta.runtimeLogs) ? meta.runtimeLogs : [];

  addActivity("State restored from browser database.");
}

function createImagePrompt(post, personalityPrompt = "") {
  const tone = safePersonality(personalityPrompt) || "social media";
  return [
    "Create an Instagram photo.",
    `Topic: ${post.topic}.`,
    `Caption intent: ${post.caption.replace(/#\w+/g, "").trim()}.`,
    `Tone: ${tone}.`,
    "No text overlays, no logos, no watermarks, photorealistic editorial style."
  ].join(" ");
}

function requestOpenAIImage(prompt) {
  return fetch("/api/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, size: "1024x1024" })
  }).then(async (response) => {
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "image generation failed");
    }
    return payload.imageUrl || "";
  });
}

function findAgentByName(name) {
  return APP_STATE.agents.find((agent) => agent.name === name);
}

function findAgentById(id) {
  return APP_STATE.agents.find((agent) => agent.id === id);
}

function enqueueImageGeneration(post, personalityPrompt = "", options = {}) {
  const {
    publishOnSuccess = false,
    agentId = null,
    signal = 0,
    force = false,
    retriesLeft = 3
  } = options;

  if (!APP_STATE.imageApiReady || !post) return;
  if (!force && post.mediaUrl) return;

  const alreadyQueued = APP_STATE.imageQueue.some((job) => job.post.id === post.id);
  if (alreadyQueued) return;

  if (force) {
    post.mediaUrl = "";
    post.mediaStatus = "idle";
    post.mediaError = "";
    post.mediaAttempts = 0;
  }

  if (!force && post.mediaStatus === "pending") return;

  post.mediaStatus = "pending";
  post.mediaError = "";
  APP_STATE.imageQueue.push({
    post,
    prompt: createImagePrompt(post, personalityPrompt),
    publishOnSuccess,
    agentId,
    signal,
    retriesLeft
  });
  pumpImageQueue();
}

function publishPostAfterImage(post, agentId, signal) {
  if (isPostInFeed(post.id)) {
    return;
  }

  APP_STATE.feed.unshift(post);
  APP_STATE.feed = APP_STATE.feed.slice(0, 250);

  const agent = agentId ? findAgentById(agentId) : findAgentByName(post.author);
  if (agent) {
    agent.postsCreated += 1;
  }

  if (agentId && agent) {
    agent.attention = Math.max(0, agent.attention - 0.6);
    APP_STATE.insights.unshift(`${agent.name} posted ${post.topic} after scrolling signal ${signal.toFixed(2)}.`);
    APP_STATE.insights = APP_STATE.insights.slice(0, 10);
  }
}

function pumpImageQueue() {
  if (!APP_STATE.imageApiReady) return;
  if (APP_STATE.imageJobsActive >= APP_STATE.imageJobsMax) return;
  if (APP_STATE.imageQueue.length === 0) return;

  const now = Date.now();
  if (now < APP_STATE.nextImageCallAt) {
    setTimeout(() => pumpImageQueue(), APP_STATE.nextImageCallAt - now);
    return;
  }

  const job = APP_STATE.imageQueue.shift();
  const { post } = job;
  APP_STATE.nextImageCallAt = Date.now() + IMAGE_CALL_INTERVAL_MS;

  APP_STATE.imageJobsActive += 1;
  post.mediaAttempts += 1;

  requestOpenAIImage(job.prompt)
    .then((imageUrl) => {
      if (!imageUrl) {
        throw new Error("Image API returned empty data.");
      }

      post.mediaUrl = imageUrl;
      post.mediaStatus = "ready";
      post.mediaError = "";

      if (job.publishOnSuccess) {
        publishPostAfterImage(post, job.agentId, job.signal || 0);
      }

      addActivity(`Image generated for ${post.id} via OpenAI API.`, "image");
      render();
      persistSoon();
    })
    .catch((error) => {
      post.mediaStatus = "failed";
      post.mediaError = error.message || "Unknown image API error";
      addActivity(`Image failed for ${post.id}: ${post.mediaError}`, "error");
      addImageError(`post ${post.id}: ${post.mediaError}`);

      if (job.retriesLeft > 0) {
        setTimeout(() => {
          const agent = findAgentByName(post.author);
          enqueueImageGeneration(post, agent?.personalityPrompt || "", {
            publishOnSuccess: job.publishOnSuccess,
            agentId: job.agentId,
            signal: job.signal,
            retriesLeft: job.retriesLeft - 1,
            force: false
          });
        }, 1000 * (4 - job.retriesLeft));
      }

      render();
      persistSoon();
    })
    .finally(() => {
      APP_STATE.imageJobsActive -= 1;
      pumpImageQueue();
    });
}

async function checkApiConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error("config unavailable");
    const payload = await response.json();
    APP_STATE.imageApiReady = Boolean(payload.imageApiReady);
    APP_STATE.openAiKeyPresent = Boolean(payload.openAiKeyPresent);
    APP_STATE.openAiKeyValidFormat = Boolean(payload.openAiKeyValidFormat);
    APP_STATE.serverBootId = String(payload.serverBootId || "");
  } catch {
    APP_STATE.imageApiReady = false;
    APP_STATE.openAiKeyPresent = false;
    APP_STATE.openAiKeyValidFormat = false;
    APP_STATE.serverBootId = "";
  }
}

function buildChatContextSnapshot() {
  return {
    running: APP_STATE.running,
    tick: APP_STATE.tick,
    tickMs: APP_STATE.tickMs,
    creativityPercent: APP_STATE.creativityPercent,
    imageApiReady: APP_STATE.imageApiReady,
    selectedAgentId: APP_STATE.selectedAgentId,
    selectedAgent:
      APP_STATE.selectedAgentId === "all"
        ? "all"
        : APP_STATE.agents.find((a) => a.id === APP_STATE.selectedAgentId)?.name || "unknown",
    agents: APP_STATE.agents.slice(0, 12).map((agent) => ({
      name: agent.name,
      style: agent.style,
      attention: Number(agent.attention.toFixed(2)),
      postsCreated: agent.postsCreated,
      likesGiven: agent.likesGiven
    })),
    feedTop: APP_STATE.feed.slice(0, 12).map((post) => ({
      id: post.id,
      author: post.author,
      topic: post.topic,
      likes: post.likes,
      mediaStatus: post.mediaStatus
    })),
    insights: APP_STATE.insights.slice(0, 8),
    imageErrors: APP_STATE.imageErrors.slice(0, 8),
    runtimeLogs: APP_STATE.runtimeLogs.slice(0, 6).map((item) => ({
      source: item.source,
      message: item.message
    })),
    activity: APP_STATE.activity.slice(0, 12).map((item) => item.message)
  };
}

async function sendChatMessage(message) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      history: APP_STATE.chatMessages.slice(-8),
      appContext: buildChatContextSnapshot()
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Chat API failed");
  }
  return String(payload.reply || "").trim();
}

function handleServerRestartReset() {
  if (!APP_STATE.serverBootId) return;
  const previous = localStorage.getItem(SERVER_BOOT_STORAGE_KEY);
  if (!previous) {
    localStorage.setItem(SERVER_BOOT_STORAGE_KEY, APP_STATE.serverBootId);
    return;
  }
  if (previous !== APP_STATE.serverBootId) {
    localStorage.setItem(SERVER_BOOT_STORAGE_KEY, APP_STATE.serverBootId);
    APP_STATE.running = false;
    resetDatabaseAndReload();
  }
}

function resetDatabaseAndReload() {
  const db = APP_STATE.db;
  if (db) db.close();
  const req = indexedDB.deleteDatabase(DB_NAME);
  req.onsuccess = () => location.reload();
  req.onerror = () => location.reload();
  req.onblocked = () => location.reload();
}

async function suggestRuntimeFix(errorText) {
  if (!APP_STATE.imageApiReady) return "";
  try {
    const response = await fetch("/api/suggest-fix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: errorText })
    });
    const payload = await response.json();
    if (!response.ok) return "";
    return String(payload.suggestion || "").trim();
  } catch {
    return "";
  }
}

async function reportRuntimeError(message, source = "client") {
  if (!APP_STATE.runtimeGuardianEnabled) return;
  const suggestion = await suggestRuntimeFix(message);
  addRuntimeLog(message, source, suggestion);
  renderRuntimeLogs();
  persistSoon();
  if (APP_STATE.runtimeGuardianAutoReload) {
    setTimeout(() => location.reload(), 1200);
  }
}

async function applySuggestedPatch(logItem) {
  const response = await fetch("/api/apply-suggested-patch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      error: logItem.message,
      suggestion: logItem.suggestion
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Patch apply failed");
  }
  return payload;
}

async function pollRuntimeErrors() {
  if (!APP_STATE.runtimeGuardianEnabled) return;
  try {
    const response = await fetch("/api/runtime-errors");
    if (!response.ok) {
      APP_STATE.runtimePollFailures += 1;
      return;
    }
    const payload = await response.json();
    const errors = Array.isArray(payload.errors) ? payload.errors : [];
    if (!errors.length) return;
    APP_STATE.runtimePollFailures = 0;

    const newest = errors[0];
    const signature = `${newest.at}|${newest.source}|${newest.message}`;
    const already = APP_STATE.runtimeLogs.some(
      (item) => `${item.at}|${item.source}|${item.message}` === signature
    );
    if (!already) {
      await reportRuntimeError(newest.message, newest.source || "server");
    }
  } catch {
    APP_STATE.runtimePollFailures += 1;
  }
}

function startRuntimeGuardian() {
  if (APP_STATE.runtimePollTimer) {
    clearInterval(APP_STATE.runtimePollTimer);
  }
  APP_STATE.runtimePollTimer = setInterval(() => {
    if (document.hidden) return;
    if (APP_STATE.runtimePollFailures >= 6) return;
    pollRuntimeErrors();
  }, 5000);
}

function queueImagesForVisibleFeed() {
  if (!APP_STATE.imageApiReady) return;

  APP_STATE.feed.slice(0, 40).forEach((post) => {
    if (!post.mediaUrl && post.mediaStatus !== "pending") {
      const authorAgent = findAgentByName(post.author);
      enqueueImageGeneration(post, authorAgent?.personalityPrompt || "", {
        publishOnSuccess: false
      });
    }
  });
}

function runTick() {
  APP_STATE.tick += 1;
  let createdDrafts = 0;

  APP_STATE.agents.forEach((agent) => {
    const ranked = [...APP_STATE.feed]
      .filter((post) => post.mediaUrl && !agent.seenPostIds.has(post.id))
      .map((post) => ({ post, score: recommendationScore(agent, post) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    if (!ranked.length) return;

    const viewed = ranked[Math.floor(Math.random() * Math.min(3, ranked.length))];
    agent.seenPostIds.add(viewed.post.id);
    agent.attention += viewed.score;
    addActivity(`${agent.name} viewed @${viewed.post.author} (${viewed.post.topic}).`, "view");
    if (APP_STATE.selectedAgentId === "all" || APP_STATE.selectedAgentId === agent.id) {
      pushVisualAction({ type: "view", postId: viewed.post.id, agentId: agent.id });
    }

    if (viewed.score > 0.55 && Math.random() > 0.35) {
      viewed.post.likes += 1;
      agent.likesGiven += 1;
      addActivity(`${agent.name} liked post ${viewed.post.id}.`, "like");
      if (APP_STATE.selectedAgentId === "all" || APP_STATE.selectedAgentId === agent.id) {
        pushVisualAction({ type: "like", postId: viewed.post.id, agentId: agent.id });
      }
    }

    const boostedChance =
      APP_STATE.creativityPercent / 100 +
      (viewed.score > 0.7 ? 0.12 : 0) +
      Math.min(0.12, agent.attention * 0.008);

    const cooldownReady = APP_STATE.tick - agent.lastDraftTick >= IMAGE_DRAFT_COOLDOWN_TICKS;
    const postDecisionChance = Math.min(0.45, boostedChance * BOT_IMAGE_POST_FACTOR);

    if (cooldownReady && Math.random() < postDecisionChance) {
      const preferred = Object.entries(agent.affinity)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([topic]) => topic);

      const chosenTopic = preferred[Math.floor(Math.random() * preferred.length)];
      const draft = createPost(chosenTopic, agent.name, agent.personalityPrompt);
      draft.caption = `${draft.caption} #${chosenTopic} #gentigram`;
      addActivity(`${agent.name} drafted ${chosenTopic}; waiting for image generation.`, "post");
      agent.lastDraftTick = APP_STATE.tick;
      enqueueImageGeneration(draft, agent.personalityPrompt, {
        publishOnSuccess: true,
        agentId: agent.id,
        signal: viewed.score
      });
      createdDrafts += 1;
    }
  });

  APP_STATE.insights.unshift(
    createdDrafts ? `${createdDrafts} draft posts queued for image generation.` : "No new draft this tick."
  );
  APP_STATE.insights = APP_STATE.insights.slice(0, 10);

  render();
  queueImagesForVisibleFeed();
  persistSoon();
}

function startLoop() {
  if (APP_STATE.timer) clearInterval(APP_STATE.timer);

  APP_STATE.timer = setInterval(() => {
    if (APP_STATE.running) runTick();
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

  if (post.mediaStatus === "failed") {
    return `<div class="media-skeleton media-skeleton--error"><span class="skeleton-label">Image failed</span></div>`;
  }
  return `<div class="media-skeleton"><div class="skeleton-shimmer"></div><span class="skeleton-label">${esc(post.mediaTitle)}</span></div>`;
}

function renderFeed() {
  const previousScrollTop = ELS.feedList.scrollTop;
  const visible = APP_STATE.feed.slice(0, 70);
  ELS.feedMeta.textContent = `${APP_STATE.feed.length} posts`;
  ELS.feedList.innerHTML = visible
    .map(
      (post) => `
      <article class="post" data-post-id="${esc(post.id)}" role="button" tabindex="0" aria-label="Open post by ${esc(post.author)}">
        <div class="post-media" style="background:${esc(post.mediaGradient)}">${renderPostMedia(post)}</div>
        <strong>@${esc(post.author)}</strong>
        <p>${esc(post.caption)}</p>
        <div class="post-foot">
          <span>${esc(post.topic)} · image</span>
          <span>${post.likes} likes</span>
        </div>
      </article>`
    )
    .join("");
  if (APP_STATE.userBrowsingFeed) {
    ELS.feedList.scrollTop = previousScrollTop;
  }
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

function renderImageErrors() {
  ELS.imageErrorList.innerHTML = APP_STATE.imageErrors.length
    ? APP_STATE.imageErrors.map((item) => `<li>${esc(item)}</li>`).join("")
    : "<li>No image generation errors.</li>";
}

function renderRuntimeLogs() {
  ELS.runtimeErrorList.innerHTML = APP_STATE.runtimeLogs.length
    ? APP_STATE.runtimeLogs
        .slice(0, 80)
        .map((item) => {
          const suggestion = item.suggestion ? `<br/><strong>Fix:</strong> ${esc(item.suggestion)}` : "";
          const action = item.suggestion
            ? `<div class="button-row"><button type="button" class="apply-patch-btn" data-log-id="${esc(item.id)}">Apply Patch</button></div>`
            : "";
          return `<li>[${esc(item.source)}] ${esc(item.message)}${suggestion}${action}</li>`;
        })
        .join("")
    : "<li>No runtime errors detected.</li>";
  ELS.guardianState.textContent = APP_STATE.runtimeGuardianEnabled
    ? "Monitoring active"
    : "Monitoring paused";
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
    ? `Image API: OpenAI connected${APP_STATE.lastImageError ? ` (last error: ${APP_STATE.lastImageError})` : ""}`
    : "Image API: unavailable (start server with OPENAI_API_KEY)";
  ELS.keyMissingBanner.classList.toggle("hidden", APP_STATE.imageApiReady);
  if (!APP_STATE.imageApiReady) {
    if (APP_STATE.openAiKeyPresent && !APP_STATE.openAiKeyValidFormat) {
      ELS.keyWarningTitle.textContent = "OpenAI key detected, but format looks invalid.";
      ELS.keyWarningText.innerHTML =
        "Use a terminal key that starts with <code>sk-</code>. Avoid quotes, spaces, or line breaks. Example: <code>OPENAI_API_KEY=sk-... npm start</code>.";
    } else {
      ELS.keyWarningTitle.textContent = "OpenAI key missing.";
      ELS.keyWarningText.innerHTML =
        "Start server with <code>OPENAI_API_KEY=sk-... npm start</code> to enable feed image posting.";
    }
  }
  ELS.guardianToggle.checked = APP_STATE.runtimeGuardianEnabled;
  ELS.guardianAutoreload.checked = APP_STATE.runtimeGuardianAutoReload;
}

function renderChat() {
  const atBottom = ELS.chatList.scrollHeight - ELS.chatList.scrollTop <= ELS.chatList.clientHeight + 10;
  ELS.chatList.innerHTML = APP_STATE.chatMessages
    .map((msg) => `<article class="chat-msg ${msg.role === "me" ? "me" : "bot"}">${esc(msg.text)}</article>`)
    .join("");
  if (atBottom) {
    ELS.chatList.scrollTop = ELS.chatList.scrollHeight;
  }
}

function renderAgentPovOptions() {
  const options = [
    `<option value="all">All Agents (Auto)</option>`,
    ...APP_STATE.agents.map((agent) => `<option value="${esc(agent.id)}">${esc(agent.name)}</option>`)
  ];
  ELS.agentPov.innerHTML = options.join("");
  ELS.agentPov.value = APP_STATE.selectedAgentId;
}

function pushVisualAction(action) {
  APP_STATE.visualActions.push(action);
  APP_STATE.visualActions = APP_STATE.visualActions.slice(-20);
}

function applyVisualActions() {
  const actions = APP_STATE.visualActions.splice(0);
  actions.forEach((action) => {
    const card = ELS.feedList.querySelector(`[data-post-id="${action.postId}"]`);
    if (!card) return;
    card.classList.add("agent-focus");
    card.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => card.classList.remove("agent-focus"), 1200);
    if (action.type === "like") {
      const heart = document.createElement("span");
      heart.className = "heart-bubble";
      heart.textContent = "❤";
      card.appendChild(heart);
      setTimeout(() => heart.remove(), 1000);
    }
  });
}

function startAutoFeedScroll() {
  if (APP_STATE.autoScrollTimer) {
    clearInterval(APP_STATE.autoScrollTimer);
  }
  APP_STATE.autoScrollTimer = setInterval(() => {
    if (!APP_STATE.running) return;
    const el = ELS.feedList;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return;
    const next = el.scrollTop + 1.4;
    el.scrollTop = next >= max ? 0 : next;
  }, 35);
}

function render() {
  renderAgents();
  renderAgentPovOptions();
  renderFeed();
  applyVisualActions();
  renderInsights();
  renderSuperLog();
  renderImageErrors();
  renderRuntimeLogs();
  renderChat();
  renderSimState();
  renderControlValues();
}

function openPostModal(postId) {
  const post = APP_STATE.feed.find((item) => item.id === postId);
  if (!post) return;
  APP_STATE.modalLastFocusedEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const recs = APP_STATE.agents
    .map((agent) => ({ agent: agent.name, score: recommendationScore(agent, post) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  ELS.modalMedia.style.background = post.mediaGradient;
  ELS.modalMedia.innerHTML = renderPostMedia(post);
  ELS.modalAuthor.textContent = `@${post.author} (image)`;
  ELS.modalCaption.textContent = post.caption;
  ELS.modalMeta.textContent = `${post.topic} · ${post.likes} likes · created at tick ${post.createdAtTick}`;
  ELS.modalRecs.innerHTML = recs
    .map((item) => `<li>${esc(item.agent)} recommendation score: ${item.score.toFixed(2)}</li>`)
    .join("");

  ELS.refreshModalImageBtn.dataset.postId = post.id;
  ELS.postModal.classList.remove("hidden");
  ELS.postModal.setAttribute("aria-hidden", "false");
  ELS.closeModal.focus();
}

function closePostModal() {
  ELS.postModal.classList.add("hidden");
  ELS.postModal.setAttribute("aria-hidden", "true");
  if (APP_STATE.modalLastFocusedEl) {
    APP_STATE.modalLastFocusedEl.focus();
  }
}

ELS.speed.addEventListener("input", (event) => {
  APP_STATE.tickMs = Number(event.target.value);
  startLoop();
  renderControlValues();
  persistSoon();
});

ELS.postRate.addEventListener("input", (event) => {
  APP_STATE.creativityPercent = Number(event.target.value);
  renderControlValues();
  persistSoon();
});

ELS.toggleBtn.addEventListener("click", () => {
  APP_STATE.running = !APP_STATE.running;
  if (APP_STATE.running) APP_STATE.userBrowsingFeed = false;
  addActivity(`Simulation ${APP_STATE.running ? "resumed" : "paused"}.`, "system");
  render();
  persistSoon();
});

ELS.stepBtn.addEventListener("click", () => {
  runTick();
});

ELS.resetBtn.addEventListener("click", () => {
  const ok = window.confirm("Reset simulation state and regenerate starter content?");
  if (!ok) return;
  APP_STATE.tick = 0;
  APP_STATE.nextPostSeq = 1;
  APP_STATE.userBrowsingFeed = false;
  setupInitialState();
  if (APP_STATE.imageApiReady) seedInitialPosts();
  render();
  persistSoon();
});

ELS.agentForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = ELS.agentName.value.trim();
  const style = ELS.agentStyle.value;
  const personalityPrompt = safePersonality(ELS.agentPersonality.value);
  if (!name) return;

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
  if (!card) return;
  openPostModal(card.dataset.postId);
});

ELS.feedList.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  const card = event.target.closest(".post");
  if (!card) return;
  openPostModal(card.dataset.postId);
});

ELS.agentPov.addEventListener("change", (event) => {
  APP_STATE.selectedAgentId = event.target.value;
});

ELS.refreshFeedViewBtn.addEventListener("click", () => {
  renderFeed();
  queueImagesForVisibleFeed();
});

ELS.chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = ELS.chatInput.value.trim();
  if (!text) return;
  APP_STATE.chatMessages.push({ role: "me", text });
  ELS.chatInput.value = "";
  renderChat();
  try {
    const reply = await sendChatMessage(text);
    APP_STATE.chatMessages.push({ role: "bot", text: reply || "No response returned." });
  } catch (error) {
    APP_STATE.chatMessages.push({ role: "bot", text: `Chat error: ${error.message || "unknown error"}` });
  }
  renderChat();
});

ELS.refreshModalImageBtn.addEventListener("click", () => {
  const postId = ELS.refreshModalImageBtn.dataset.postId;
  const post = APP_STATE.feed.find((item) => item.id === postId);
  if (!post) return;

  const agent = findAgentByName(post.author);
  enqueueImageGeneration(post, agent?.personalityPrompt || "", {
    publishOnSuccess: false,
    force: true,
    retriesLeft: 3
  });
  render();
  persistSoon();
});

ELS.clearImageErrorsBtn.addEventListener("click", () => {
  APP_STATE.imageErrors = [];
  APP_STATE.lastImageError = "";
  renderImageErrors();
  renderControlValues();
  persistSoon();
});

ELS.startNewSessionBtn.addEventListener("click", () => {
  const ok = window.confirm(
    "Wipe all local simulation data and reload? This cannot be undone."
  );
  if (!ok) return;
  APP_STATE.running = false;
  APP_STATE.imageQueue = [];
  APP_STATE.runtimeLogs = [];
  APP_STATE.imageErrors = [];
  APP_STATE.chatMessages = [{ role: "bot", text: "Session reset. I am ready." }];
  resetDatabaseAndReload();
});

ELS.guardianToggle.addEventListener("change", (event) => {
  APP_STATE.runtimeGuardianEnabled = Boolean(event.target.checked);
  renderRuntimeLogs();
  persistSoon();
});

ELS.guardianAutoreload.addEventListener("change", (event) => {
  APP_STATE.runtimeGuardianAutoReload = Boolean(event.target.checked);
  persistSoon();
});

ELS.runtimeErrorList.addEventListener("click", async (event) => {
  const button = event.target.closest(".apply-patch-btn");
  if (!button) return;
  const logId = button.dataset.logId;
  const logItem = APP_STATE.runtimeLogs.find((item) => item.id === logId);
  if (!logItem || !logItem.suggestion) return;

  button.disabled = true;
  button.textContent = "Applying...";
  try {
    const result = await applySuggestedPatch(logItem);
    addActivity(`Patch applied: ${result.applied || 0} change(s). Reloading app.`, "system");
    persistSoon();
    setTimeout(() => location.reload(), 1200);
  } catch (error) {
    addRuntimeLog(error.message || "Patch apply failed", "patch-agent");
    renderRuntimeLogs();
    persistSoon();
  } finally {
    button.disabled = false;
    button.textContent = "Apply Patch";
  }
});

ELS.closeModal.addEventListener("click", closePostModal);
ELS.postModal.addEventListener("click", (event) => {
  if (event.target === ELS.postModal) closePostModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePostModal();
  if (!ELS.postModal.classList.contains("hidden") && event.key === "Tab") {
    const focusables = [ELS.refreshModalImageBtn, ELS.closeModal].filter(Boolean);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

window.addEventListener("error", (event) => {
  const msg = event?.error?.stack || event?.message || "window error";
  reportRuntimeError(msg, "client");
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event?.reason?.stack || event?.reason?.message || String(event?.reason || "unhandledrejection");
  reportRuntimeError(reason, "client");
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
  handleServerRestartReset();
  if (FORCE_FRESH_BOOT) {
    setupInitialState();
  }
  if (!APP_STATE.feed.length && APP_STATE.imageApiReady) {
    seedInitialPosts();
  }

  render();
  queueImagesForVisibleFeed();
  startAutoFeedScroll();
  startRuntimeGuardian();
  pollRuntimeErrors();
  startLoop();
  persistSoon();
}

init();
