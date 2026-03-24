# Agent-Board — Product Improvement Roadmap

> Goal: Evolve agent-board from a personal internal tool into a consumer-facing product with meaningful safety guardrails, user context, and observable metrics. This is the "wrapping and splitting the logic" phase.

---

## Mental Model

The core agent logic doesn't change. What changes is the layer around it:

```
[ User Context & Identity ]
        ↓
[ Prompt Wrapping & Safety Layer ]
        ↓
[ Existing Agent/Model Logic ]
        ↓
[ Response Filtering & Output Controls ]
        ↓
[ Metrics & Observability Layer ]
        ↓
[ User-Facing Surface ]
```

Each phase below builds one of these layers.

---

## Phase 1 — User Context & Identity
*Who is the user and what does that change?*

### Goals
- Introduce a lightweight user model — doesn't need to be full auth yet, even a session identity is enough to start
- Attach context to every interaction: who asked, when, what model, what session
- Establish the foundation that safety and metrics layers build on

### Tasks
- [ ] Add session identity — anonymous UUID on first visit, persistent via localStorage or cookie
- [ ] Add optional user profile — name, role, preferences (can be self-reported, no auth required initially)
- [ ] Pass user context as system prompt metadata on every request — model should know it's talking to "a developer" vs "a student" vs "unknown"
- [ ] Store session context in existing Postgres schema — user_id, session_id, created_at, model, endpoint
- [ ] Add a simple session history view to the dashboard — what did this user ask, what model, when

### Why this first
Everything else — safety rules, metrics, personalization — requires knowing who you're talking to. Even an anonymous session ID unlocks a lot.

---

## Phase 2 — Prompt Wrapping & Safety Layer
*Make the product safe for users who aren't you*

### Goals
- Wrap every outbound prompt with a system-level safety context
- Detect and handle sensitive input categories before they reach the model
- Filter or flag problematic outputs before they reach the user
- Make this configurable per-user role or experience type

### Tasks

#### Input Safety
- [ ] Build a `PromptWrapper` middleware layer that prepends a system prompt to every request
  - Role context: "You are a helpful assistant for [context]. You should not..."
  - Hard rails: self-harm, illegal activity, PII extraction, prompt injection attempts
  - Soft rails: off-topic detection, redirect to appropriate resource
- [ ] Add an input classifier before sending to model
  - Categories: safe / sensitive / blocked
  - Use a lightweight local model (llama2 is already in your stack) for classification — keep it local-first
  - Log classification result as a metric event (see Phase 3)
- [ ] Build a blocked input response handler — graceful, non-robotic refusal messages
- [ ] Add prompt injection detection — look for "ignore previous instructions", role-switching attempts, jailbreak patterns

#### Output Safety
- [ ] Add a `ResponseFilter` layer on model output before rendering
  - Detect PII in responses (names, emails, phone numbers)
  - Flag or redact self-harm adjacent content
  - Log filter events as metrics
- [ ] Add a user-facing feedback mechanism — "Was this helpful?" / "Report a problem" — simple thumbs on each response
  - Store feedback as a metric event tied to session + message

#### Configuration
- [ ] Build a `SafetyConfig` object per session/user type
  - `strict` — full rails, for unknown or public users
  - `standard` — default developer experience
  - `research` — fewer restrictions, requires explicit opt-in
- [ ] Expose safety mode toggle in dashboard UI (already have safe mode concept via NemoClaw — extend this)

---

## Phase 3 — Metrics & Observability
*Let user behavior tell you what to build next*

### Goals
- Every meaningful interaction is a recorded event
- Build a metrics dashboard that surfaces patterns, not just counts
- Use error and event-driven signals to understand where users succeed, struggle, or bail

### Event Schema

Every event should capture:
```json
{
  "event_id": "uuid",
  "session_id": "uuid",
  "user_id": "uuid or anonymous",
  "timestamp": "ISO8601",
  "event_type": "string",
  "model": "string",
  "endpoint": "string",
  "metadata": {}
}
```

### Event Types to Capture

| Event | What it tells you |
|-------|------------------|
| `session_start` | How often people come back |
| `message_sent` | Volume, model distribution |
| `message_received` | Latency, response length |
| `input_classified` | What categories of prompts are coming in |
| `input_blocked` | Where safety rails are firing |
| `output_filtered` | Where output safety is catching things |
| `model_switched` | Which models people prefer mid-session |
| `safe_mode_toggled` | Who needs stricter/looser rails |
| `feedback_positive` | What's working |
| `feedback_negative` | What isn't |
| `session_end` | Session length, message count |
| `error` | What's breaking and how often |

### Tasks

#### Event Pipeline
- [ ] Build an `EventBus` — lightweight pub/sub, events fire and forget so they don't block UX
- [ ] Persist events to Postgres — `events` table with the schema above
- [ ] Add event emission to every meaningful interaction point in server.js

#### Metrics API
- [ ] `GET /api/metrics/summary` — total sessions, messages, avg session length, model distribution
- [ ] `GET /api/metrics/safety` — input classifications, blocks, output filters over time
- [ ] `GET /api/metrics/feedback` — positive/negative ratio per model, per experience type
- [ ] `GET /api/metrics/errors` — error rate, error types, affected models

#### Metrics Dashboard
- [ ] Add a Metrics tab to the existing React dashboard
- [ ] Session volume over time (line chart)
- [ ] Model usage distribution (pie or bar)
- [ ] Safety event breakdown (blocked inputs, filtered outputs)
- [ ] Feedback ratio per model
- [ ] Error rate and top error types
- [ ] Keep it simple — Recharts is already likely in your stack or trivial to add

#### Observability
- [ ] Add structured logging to every API handler — JSON logs with session_id, event_type, duration
- [ ] Add a `/api/health` extension — not just "is it up" but "is it healthy" (model response times, error rates last 5 min)
- [ ] Consider OpenTelemetry traces on the critical path (send → classify → model → filter → respond) — gives you per-stage latency

---

## Phase 4 — Experience Wrapping
*The "consumer product" layer — different entry points for different users*

### Goals
- Move from "one dashboard for everything" to "experiences" — distinct entry points with their own context, safety config, and UI
- Each experience is a thin wrapper around the same core agent logic

### Experience Ideas to Start

**Developer Assistant** (your current default)
- Full model access, standard safety, session history
- Target user: you and people like you

**Research Mode**
- Focused on long-form reasoning, document analysis
- Slightly looser rails, explicit opt-in
- Metrics focus: session length, follow-up rate

**Safe Chat** (the consumer-facing proof of concept)
- Strict safety config, simple UI, no model switching
- Target user: someone who doesn't know what Ollama is
- Metrics focus: task completion, feedback, bail rate

### Tasks
- [ ] Build an `ExperienceConfig` object — name, description, safety config, available models, UI theme
- [ ] Add an experience selector to the dashboard landing page
- [ ] Route each experience to its own system prompt and safety profile
- [ ] Track experience as a dimension on all metric events — so you can compare "did Developer users have fewer blocked inputs than Safe Chat users"

---

## Phase 5 — Polish & Resume-Ready State
*Make it something you'd demo in an interview*

- [ ] Write a proper onboarding flow — first-time user sees what it is, what it does, how to start
- [ ] Add a public demo mode — no auth required, limited to Safe Chat experience, read-only metrics
- [ ] Update README with product framing not just technical setup
- [ ] Record a 2-minute demo video — show the experience selector, send a message, show the metrics dashboard updating in real time, show a blocked input being handled gracefully
- [ ] Deploy publicly — not just localhost

---

## Prioritization

If time is short, do these in order:

1. **Session identity** (Phase 1) — unlocks everything else
2. **PromptWrapper + input classification** (Phase 2) — makes it safe to open up
3. **EventBus + events table** (Phase 3) — start collecting data even before the dashboard exists
4. **Metrics summary endpoint + basic dashboard** (Phase 3) — makes the data visible
5. **Safe Chat experience** (Phase 4) — your consumer-facing proof of concept

The rest is polish. Even getting through steps 1-4 gives you a story in an interview: "I identified the gap, here's how I thought about it, here's what I built, here's what the metrics told me."

---

## The Interview Story

When they ask about consumer-facing product experience:

> "I recognized it was a gap so I started building toward it deliberately. Agent-board started as a personal tool. I've been evolving it to understand what it takes to build for users who aren't me — adding user context, safety guardrails with configurable rails per experience type, and an event-driven metrics layer so I can watch where users succeed and where they bail. The core insight was that the agent logic doesn't change — it's the wrapping, the safety model, and the observability that turn an internal tool into a product."

That's a real answer. And you'll have the code to back it up.

---

*Ut prosim.*
