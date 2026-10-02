# Negus

**A customizable workspace with a personal assistant as the main conversation entry.**

The desktop shows the information users care about. A general assistant handles quick requests and can involve specialist agents for traceable background work. Features should share real data and reusable capabilities. This is the product direction, not a claim that every workflow is implemented.

## Start here

- [Product definition](PRODUCT_DEFINITION.md): current direction, behavior and open decisions.
- [Project guide](PROJECT.md): existing capabilities, code and runtime entry points.
- [Documentation and project memory](docs/README.md): decisions, sources, open questions and reading paths.
- [Feature index](docs/feature-development/FEATURE_STATUS_INDEX.md): all 23 feature records.
- [Assistant rules](AI_ASSISTANT_WORK_RULES.md) and [user profile](USER_PROFILE.md).

The React/TypeScript frontend lives in `web-ui/`; Node.js services live in `windows/server/`. Cross-platform commands are provided by `scripts/negus.mjs`. `runtime/` contains local operational data.

Real Codex conversations, group collaboration, desktop components, provider configuration, attachments and deliverables have implementation foundations. Arbitrary business-component generation and publishing, the complete assistant organization, and seamless Desktop/Web continuity remain subject to design and acceptance.

On macOS, normal deployment with `pnpm negus:build` and `pnpm negus:start` automatically installs service recovery checks every three hours. See the [deployment and maintenance guide](docs/operations/NEGUS_SERVICE_CONTROL.md) for prerequisites and platform limits.

## Legacy theme tool

Codex Dream Skin is a historical starting point and is planned for gradual retirement. Its code is still present; shared scripts, assets and CI dependencies must be checked before removal. Historical guides: [macOS](macos/README.md), [Windows](windows/README.md).

[中文](README.md). Not an official OpenAI product. Documentation updated: 2026-09-29 18:31 +08:00, PM-003.
