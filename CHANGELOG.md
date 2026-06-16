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

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [0.1.0] - 2026-05-24

### Added

- Project initialization

[Unreleased]: https://github.com/nitsuah/agent-board/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nitsuah/agent-board/releases/tag/v0.1.0
