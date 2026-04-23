# Contributing to Revenue OS

> **Alpha** — Revenue OS is in alpha and under active development. APIs, configuration, and pipeline behavior may change between releases. We're building in the open and would love your help shaping the direction.

Thank you for your interest in contributing! Whether you're fixing a bug, adding a new data connector, improving outreach pipelines, or writing docs — every contribution matters.

---

## Before You Start

1. **Check existing issues** — someone may already be working on it
2. **Open an issue first** for large changes so we can discuss the approach
3. **Read the [SETUP-GUIDE.md](SETUP-GUIDE.md)** to get the project running locally

---

## Development Workflow

```bash
# 1. Fork and clone
git clone https://github.com/<your-username>/revenue-os.git
cd revenue-os

# 2. Install dependencies
npm install

# 3. Copy environment template
cp .env.example .env
# Fill in your API keys (see SETUP-GUIDE.md)

# 4. Create a feature branch
git checkout -b feat/your-feature-name

# 5. Make your changes and add tests

# 6. Run the test suite
npm test              # Unit tests
npm run test:integration  # Integration tests
npm run typecheck     # TypeScript strict mode

# 7. Commit and push
git add .
git commit -m "feat: describe your change"
git push origin feat/your-feature-name

# 8. Open a Pull Request
```

---

## Code Standards

- **TypeScript strict mode** — no `any` types
- **Tests required** — add unit tests for new logic; integration tests for new pipelines
- **All tests must pass** before merging (`npm run test:all`)
- **Keep it simple** — prefer clarity over cleverness

---

## What We're Looking For

Great first contributions:

- **New data connectors** — LinkedIn, ZoomInfo, Clearbit, etc.
- **New outreach channels** — SMS, LinkedIn messaging, WhatsApp
- **Pipeline improvements** — better scoring, smarter cadence logic
- **Bug fixes** — especially edge cases in enrichment or delivery
- **Documentation** — tutorials, guides, translations
- **Dashboard features** — new visualizations, filters, reports

---

## Collaborate Closely

We're actively looking for contributors and partners who want to help shape the future of open-source revenue operations. If you'd like to collaborate closely on this project or our other open-source work:

- **Open an issue** with the `collaboration` label
- **Reach out** at [team@personize.ai](mailto:team@personize.ai)
- **Join the discussion** in GitHub Discussions

---

## Sponsors

We're grateful to the companies and individuals who support this project. Sponsorship helps us maintain the project, add features, and keep it free for everyone.

### Become a Sponsor

Sponsors get their logo and link displayed here and in the project README — visible to every developer evaluating open-source revenue operations tools.

| Tier | Benefits |
|------|----------|
| **Gold** | Large logo in README + CONTRIBUTING + link + priority issue support |
| **Silver** | Medium logo in README + CONTRIBUTING + link |
| **Bronze** | Name listed in sponsors section |

**Interested?** Reach out at [sponsors@personize.ai](mailto:sponsors@personize.ai) or [open a sponsorship inquiry](https://github.com/personizeai/revenue-os/issues/new?labels=sponsorship&title=Sponsorship+Inquiry).

<!--
### Gold Sponsors
<a href="https://example.com"><img src="https://example.com/logo.png" width="200" alt="Sponsor Name" /></a>

### Silver Sponsors
<a href="https://example.com"><img src="https://example.com/logo.png" width="120" alt="Sponsor Name" /></a>

### Bronze Sponsors
- [Sponsor Name](https://example.com)
-->

*Your logo here — [become a sponsor](mailto:sponsors@personize.ai)*

---

## Code of Conduct

Be respectful, constructive, and inclusive. We're all here to build something great together.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
