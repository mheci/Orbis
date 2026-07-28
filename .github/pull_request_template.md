## What this changes

<!-- What does it change, and what problem does it solve? Link the issue: Fixes #123 -->

## Type

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Address list change
- [ ] Refactor, performance, tests, build or maintenance

## Checklist

- [ ] `npm run ci` passes locally
- [ ] New behaviour has tests, bug fixes have a test that would have caught the bug
- [ ] Documentation updated if behaviour, permissions or the address list changed
- [ ] `CHANGELOG.md` updated under Unreleased for anything users would notice
- [ ] No new runtime dependency
- [ ] No new permission, or it is documented in `docs/PERMISSIONS.md`
- [ ] Commit messages follow Conventional Commits

## For address list changes

- [ ] Evidence that Google owns it, included below
- [ ] Correct group chosen, on or off by default, per `docs/DOMAIN_DATABASE.md`
- [ ] Test added in `test/matcher.test.ts`
- [ ] Date updated in the JSON file

<!-- Evidence: -->

## Testing done

<!-- Anything you checked by hand in Firefox -->
