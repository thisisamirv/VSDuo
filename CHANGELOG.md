<!-- markdownlint-disable MD024 MD046 -->
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 2.4.0

### Added

- Added a CHANGELOG to trace the changes made to the project.
- Automated unit tests for stored device normalization, Duo activation parsing, base32 encoding, and SSH config host parsing.
- GitHub Actions CI that installs dependencies, builds the extension, runs the automated tests, packages the VSIX, and uploads the VSIX as a workflow artifact.
- Integration-style tests for the helper HTTP API covering ping, state, approve, deny, authorization, and stop flows.
- CI and Marketplace status badges in the README.
- Diagnostics-oriented tests for Remote SSH configured-host normalization, deduplication, and handoff command fallback ordering.

### Changed

- Refactored pure parsing and normalization logic into standalone modules so tests can run without the VS Code runtime.
- Refactored the helper implementation into a reusable HTTP server module that can be exercised directly in automated tests.
- Refactored Remote SSH configured-host discovery and handoff fallback planning into standalone modules so they can be validated outside the VS Code runtime.
- Updated dev dependencies `@types/node` to v25.7, `tsx` to v4.21, and `@types/vscode` to v1.118.
