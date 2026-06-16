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
