# Contributing

Thanks for helping out. This project values being correct and dependable over shipping features
quickly, so a small well tested change is always more welcome than a large clever one.

## Getting set up

```bash
git clone https://github.com/astarling-x/g-container.git
cd g-container
npm install
npm test
npm run build
```

Load `dist/manifest.json` through `about:debugging#/runtime/this-firefox`, or run
`npx web-ext run --source-dir=dist` for a throwaway profile that reloads as you edit.

Node.js 20 or newer.

## Before opening a pull request

```bash
npm run ci
```

That runs formatting, type checking, tests, validation and packaging. Everything has to pass. The
build server runs the same command, so there are no surprises.

## Ways to help

### Report a missed or wrongly caught site

The most valuable thing you can send. Include:

- The exact address
- Whether it should or should not be put in the container
- The output of the URL tester in Settings, then Diagnostics

### Add an address

See [docs/DOMAIN_DATABASE.md](docs/DOMAIN_DATABASE.md). Usually one line of JSON plus a test. Please
include evidence that Google owns it.

### Fix a bug

Write the failing test first. A fix without a test that would have caught the bug will be sent back.

### Suggest a feature

Open a discussion or an issue before writing code. Given the goals of the project, anything that
adds settings or moving parts needs a solid case. Being dependable really is the product here.

## Commit messages

The project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short description
```

| Type       | Use for                                |
| ---------- | -------------------------------------- |
| `feat`     | Something new that users can see       |
| `fix`      | A bug fix                              |
| `docs`     | Documentation only                     |
| `test`     | Tests only                             |
| `refactor` | Restructuring with no behaviour change |
| `perf`     | Making something faster                |
| `build`    | Build setup, packaging, dependencies   |
| `ci`       | Build server configuration             |
| `chore`    | Maintenance                            |

Common scopes: matcher, decision, domains, settings, storage, container, popup, options, background,
icons, ci, docs.

Examples:

```
feat(domains): add notebooklm.google.com
fix(matcher): reject addresses using credentials to fake a Google hostname
perf(matcher): cache lookups with a size limit
docs(architecture): explain the loop guard rules
```

Release notes are generated from these, so the type matters. Breaking changes use an exclamation
mark, as in `feat(settings)!:`, plus a note in the message body.

## Pull request checklist

- One concern per pull request, small enough to review in a sitting
- `npm run ci` passes locally
- New behaviour has tests, bug fixes have a test that would have caught the bug
- Documentation updated if behaviour, permissions or the address list changed
- `CHANGELOG.md` updated under Unreleased for anything users would notice
- No new runtime dependency
- No new permission unless documented in `docs/PERMISSIONS.md`, which the build checks

## Code standards

**Strict TypeScript.** No `any` without a comment explaining why, and no suppressing type errors.

**Keep the core pure.** Nothing under `src/core/` may touch the browser directly or become
asynchronous where it currently is not. That property is what makes the test suite worth anything.

**Small files, clear boundaries.** If a module needs a diagram to explain, split it.

**Comment why, not what.** Unusual ordering, workarounds and rules deserve a note. Restating the
code in English does not.

**No runtime dependencies.** The extension ships no third party code, which keeps review simple and
the supply chain small. Development tools are fine but should be worth their weight.

## Architecture rules

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before touching `src/core/`. In particular:

1. Dependencies point one way: background uses core, core uses data.
2. `decideNavigation()` stays pure and synchronous.
3. Everything saved or imported is validated before use.
4. A replacement tab is always created before the original is closed.
5. If the replacement cannot be created, the original load is allowed through.
6. Nothing makes a network request.

## Reviews

Expect questions about edge cases, particularly what happens across a chain of redirects and whether
a change could break a site that is not Google. That scrutiny is the point, so please do not take it
personally. Maintainers aim to reply within a week.

## Security problems

Do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Conduct

Be decent to each other. Harassment is not tolerated, and maintainers will remove contributions and
block people who make the project unpleasant.

## Licence

Contributions are licensed under [MPL-2.0](LICENSE).
