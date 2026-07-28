# Contributing to G-Container

Thanks for helping out. This project prioritises **correctness, stability and maintainability over
feature velocity** — a small, well-tested change is always more welcome than a large, clever one.

## Quick start

```bash
git clone https://github.com/astarling-x/g-container.git
cd g-container
npm install
npm test
npm run build
```

Load `dist/manifest.json` via `about:debugging#/runtime/this-firefox`, or run
`npx web-ext run --source-dir=dist`.

## Before you open a PR

```bash
npm run ci    # lint + typecheck + test + verify + package
```

Everything must pass. CI runs the same command, so there are no surprises.

## Ways to contribute

### Report a missed or over-eager domain

The single most valuable contribution. Include:

- the exact URL,
- whether it should or should not be contained,
- the output of Options → Diagnostics → _Test a URL_.

### Add a domain

See [docs/DOMAIN_DATABASE.md](docs/DOMAIN_DATABASE.md). Usually a one-line JSON change plus a test.
Please include evidence of Google ownership.

### Fix a bug

Write the failing test first. A bug fix without a regression test will be asked for changes.

### Propose a feature

Open a Discussion or an issue before writing code. Given the project's goals, features that add
configuration surface or runtime complexity need a strong justification. "Reliability is more
important than flashy features" is a real constraint here, not a slogan.

## Commit convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>
```

| Type       | Use for                               |
| ---------- | ------------------------------------- |
| `feat`     | new user-visible capability           |
| `fix`      | bug fix                               |
| `docs`     | documentation only                    |
| `test`     | tests only                            |
| `refactor` | behaviour-preserving code change      |
| `perf`     | performance improvement               |
| `build`    | build system, packaging, dependencies |
| `ci`       | CI configuration                      |
| `chore`    | maintenance                           |

Common scopes: `matcher`, `decision`, `domains`, `settings`, `storage`, `container`, `popup`,
`options`, `background`, `ci`, `docs`.

Examples:

```
feat(domains): add notebooklm.google.com
fix(matcher): reject userinfo-spoofed Google hostnames
perf(matcher): cache lookups in a bounded LRU
docs(architecture): document the loop guard invariants
```

Commit types drive release notes, so please get them right. Breaking changes use `!`
(`feat(settings)!: …`) and a `BREAKING CHANGE:` footer.

## Pull request checklist

- [ ] Focused on a single concern; small enough to review in one sitting.
- [ ] `npm run ci` passes locally.
- [ ] New behaviour has tests; bug fixes have a regression test.
- [ ] Docs updated when behaviour, permissions or the domain database changed.
- [ ] No new runtime dependency (see below).
- [ ] No new permission unless documented in `docs/PERMISSIONS.md` — CI enforces this.
- [ ] `CHANGELOG.md` updated under _Unreleased_ for user-visible changes.

## Code standards

- **TypeScript strict mode.** No `any` without a comment explaining why; no `@ts-ignore`.
- **Keep the core pure.** `src/core/` must not touch the `browser` global directly and must stay
  synchronous where it already is. That property is what makes the test suite meaningful.
- **Small files, clear interfaces.** If a module needs a diagram to explain, split it.
- **Comment the _why_, not the _what_.** Non-obvious ordering, workarounds and invariants deserve a
  comment; `i++ // increment i` does not.
- **No runtime dependencies.** The extension ships zero third-party code, which keeps the AMO review
  simple and the supply chain minimal. Dev dependencies are fine but should be justified.

## Architecture rules

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing `src/core/`. In particular:

1. Dependency direction is one-way: `background → core → domains`.
2. `decideNavigation()` stays pure and synchronous.
3. Every persisted or imported document goes through `sanitizeSettings()`.
4. A replacement tab is always created before the original is closed.
5. No code path may make a network request.

## Reviews

Maintainers aim to respond within a week. Expect questions about edge cases — especially
"what happens on a redirect chain?" and "can this break a non-Google site?". That scrutiny is the
point; please do not take it personally.

## Security issues

Do **not** open a public issue. Follow [SECURITY.md](SECURITY.md).

## Code of conduct

Be respectful and constructive. Harassment of any kind is not tolerated. Maintainers may remove
comments, commits and contributions that violate this, and may ban repeat offenders.

## Licence

By contributing you agree that your work is licensed under the [MPL-2.0](LICENSE).
