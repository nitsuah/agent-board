# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial project setup
- OpenLLM endpoint (`llm_openllm`, port 8082) — opt-in second OpenAI-compatible endpoint for custom/fine-tuned HuggingFace models, gated behind the `openllm` compose profile and `OPENLLM_ENABLED` flag, registered alongside Ollama and Docker Model Runner. See `docs/AI_STACK_STRATEGY.md`.

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
