# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial project setup
- OpenLLM endpoint (`llm_openllm`, port 8082)
- Ollama model loading performance audit (`docs/MODEL_LOADING_AUDIT.md`) — passive log analysis of all 8 load events, bottleneck identified (`load_tensors: mmap=false`), honest assessment vs. ≥50% acceptance criteria (~17-23% average reduction from model swap, not 50%), ranked recommendations (GPU > selective loading > warmup).
- Opt-in `ollama-warmup` compose service (`warmup` profile) — one-shot container that pre-loads `PRIMARY_LLM_MODEL` during `docker compose up` so the cold model load cost (~15-23s) hits at stack-start rather than on the first user chat message. Enable with `docker compose --profile warmup up ollama-warmup`. — opt-in second OpenAI-compatible endpoint for custom/fine-tuned HuggingFace models, gated behind the `openllm` compose profile and `OPENLLM_ENABLED` flag, registered alongside Ollama and Docker Model Runner. See `docs/AI_STACK_STRATEGY.md`.
- **Device profile system** — three-tier hardware profiles (`minimal` / `laptop` / `desktop`) auto-select the best default Ollama model based on GPU VRAM and system RAM. Set `DEVICE_PROFILE` in `.env` to override, or run `scripts/detect-profile.ps1 -Write` to auto-detect and write the value. Profile definitions live in `config/device-profiles.json`; active profile (name, GPU flag, model assignments) is surfaced in the dashboard System panel via `GET /api/docker/status`.
- **Custom LLM endpoint registry** (`CUSTOM_LLM_ENDPOINTS`) — add any number of OpenAI-compatible endpoints (OpenRouter, vLLM, LM Studio, etc.) via a JSON array in `.env`. Each entry is merged into the endpoint registry at startup alongside Ollama and Docker Model Runner; the dashboard endpoint selector and system panel update dynamically. API keys are injected as `Authorization: Bearer` headers and reported as `hasApiKey: true` (key value never sent to the frontend).
- **NVIDIA GPU compose overlay** (`config/docker-compose.gpu.yml`) — opt-in overlay that enables NVIDIA runtime + `deploy.resources.reservations.devices` for the Ollama service. Apply with `docker compose -f config/docker-compose.yml -f config/docker-compose.gpu.yml --project-directory . up -d`. Prerequisites (NVIDIA drivers, Container Toolkit, Docker Desktop GPU support) documented in the file header.
- **Hardware detection script** (`scripts/detect-profile.ps1`) — PowerShell script that queries `nvidia-smi` and WMI to detect GPU VRAM and system RAM, then recommends and optionally writes a `DEVICE_PROFILE` value to `.env`. Run `.\scripts\detect-profile.ps1 -Write` for a one-command setup.
- **Workspace file I/O** — agents can now read, write, and git-commit files in a user-declared host folder. Set `WORKSPACE_PATH` in `.env` and apply `config/docker-compose.workspace.yml` to bind-mount it into the container at `/workspace`. New `/api/workspace/*` API routes: `GET /status`, `GET /ls`, `GET /read`, `POST /write`, `GET /git/status`, `POST /git/commit`, `POST /git/push` — all sandboxed to prevent path traversal. The System panel gains a file browser, breadcrumb navigation, changed-file list, commit message input, and Commit + Push buttons. `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` env vars control commit attribution.

### Added

- **Plugin tools in the agent runtime** — enabled plugin tools are now merged into
  the model's tool list for the developer/research/website experiences (exposed as
  `<plugin>__<tool>` function-call names), so an agent can call a plugin tool on its
  own instead of only through the manual `POST /api/plugins/:name/tools/:tool/invoke`
  HTTP endpoint. See `docs/API.md#plugins`.
- **CI unit-test gate** — `.github/workflows/ci.yml` now runs `npm run test:unit`
  before the image build, so a failing suite fails CI.

### Changed

- Consistent `agent-board` naming across the dashboard UI (page title, onboarding
  banner, 3D LiminalDashboard hub/hero text), OTEL service identifiers, PowerShell
  scripts, and the `tools/website` and `tools/content-gen` npm package scopes
  (`@motor-pool/*` → `@agent-board/*`). A prior docs-only rename (PR #61) hadn't
  reached the running application.

### Deprecated

### Removed

- Archived `docs/QUICK_REFERENCE.md`, `docs/README-orchestration.md`, and
  `docs/MCP_SETUP.md` to `docs/archive/` — all three predated the current compose
  service names and MCP/plugin architecture and were superseded by `README.md` and
  `docs/API.md`.

### Fixed

- `config/docker-compose.yml` mixed two incompatible relative-path conventions
  (build contexts resolved from the compose file's own directory; `env_file`/volume
  entries assumed `--project-directory .`), so the README's own Quick Start command
  failed every build. All paths now resolve consistently from `config/`.
- `scripts/setup-docker-stack.ps1` cd'd into a `motor-pool` directory that doesn't
  exist for anyone who cloned this repo under its real name.

### Security

## [0.1.0] - 2026-05-24

### Added

- Project initialization

[Unreleased]: https://github.com/nitsuah/agent-board/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nitsuah/agent-board/releases/tag/v0.1.0
