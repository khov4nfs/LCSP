# LCSP Git Flow

LCSP uses a lightweight Git Flow aligned with the Capstone Project Management Plan.

## Branch roles

- `main`: stable release and Capstone milestone branch.
- `develop`: integration branch for active weekly work.
- `feat/*`, `fix/*`, `docs/*`, `test/*`, `refactor/*`, `chore/*`, `ci/*`, `build/*`, `perf/*`, `style/*`, `revert/*`: short-lived task branches.
- `release/*`: temporary stabilization branches when a release or milestone needs a freeze period.
- `hotfix/*`: urgent fixes created from `main` for a released baseline.

Regular task branches must use:

```text
type/LCSP-<issue-number>-<short-kebab-description>
```

Example:

```text
feat/LCSP-239-update-wizard-context
fix/LCSP-240-fix-assessment-status
docs/LCSP-241-update-srs
```

## Normal development flow

```text
develop
  └─ task branch
       └─ Pull Request -> develop
                            └─ release PR -> main
```

1. Update `develop`.

```bash
git fetch origin
git switch develop
git pull --ff-only origin develop
```

2. Create a task branch from `develop`.

```bash
git switch -c feat/LCSP-239-update-wizard-context
```

3. Commit and push.

```bash
git add .
git commit -m "feat: LCSP-239 update wizard context"
git push -u origin feat/LCSP-239-update-wizard-context
```

4. Open a Pull Request from the task branch into `develop`.

5. Merge only after required review and repository checks pass.

Do not open regular feature/fix/docs task Pull Requests directly into `main`.

## Weekly release

For a normal one-week iteration that does not need a separate stabilization period:

```text
develop -> Pull Request -> main -> deploy/tag
```

The release Pull Request should contain only the integrated scope that has passed the release gate.

## Release branch

Use a `release/*` branch when a milestone or release needs stabilization while new development continues on `develop`.

```bash
git switch develop
git pull --ff-only origin develop
git switch -c release/0.4.0
git push -u origin release/0.4.0
```

Flow:

```text
develop -> release/* -> main
             |
             +----------> synchronize release fixes back to develop
```

Only release-oriented fixes, testing corrections, and release documentation should be added to the release branch.

## Hotfix flow

Urgent fixes for a released baseline start from `main`.

```bash
git switch main
git pull --ff-only origin main
git switch -c hotfix/LCSP-250-fix-login-production
git push -u origin hotfix/LCSP-250-fix-login-production
```

After review and testing:

```text
hotfix/* -> main
hotfix/* -> develop
```

The fix must be synchronized back to `develop` so active development contains the production correction.

## Local git-flow initialization

Each developer may initialize the `git-flow` CLI locally. This only configures the local clone; it does not create or configure GitHub branch protection.

Install the extension if needed, then run:

```bash
git fetch origin
git switch develop
git pull --ff-only origin develop
git flow init
```

Use these answers:

```text
Production branch: main
Development branch: develop
Feature branch prefix: feat/
Bugfix branch prefix: bugfix/
Release branch prefix: release/
Hotfix branch prefix: hotfix/
Support branch prefix: support/
Version tag prefix: <empty>
```

LCSP supports task prefixes beyond `feat/`, so `fix/`, `docs/`, `test/`, `refactor/`, `chore/`, `ci/`, `build/`, `perf/`, `style/`, and `revert/` branches should continue to be created with normal Git commands.

Because LCSP integrates changes through GitHub Pull Requests, do not use `git flow feature finish` or other `finish` commands to merge task branches locally into protected integration/release branches. Open a Pull Request instead.

## Pull Request targets

| Source branch | Target branch |
| --- | --- |
| `feat/*`, `fix/*`, `docs/*`, `test/*`, `refactor/*`, `chore/*`, `ci/*`, `build/*`, `perf/*`, `style/*`, `revert/*` | `develop` |
| `release/*` | `main`, then synchronize release fixes to `develop` |
| `develop` | `main` for a short weekly release without a stabilization branch |
| `hotfix/*` | `main` and `develop` |

## GitHub repository setup

Recommended repository roles:

```text
Default branch: develop
Stable/release branch: main
Integration branch: develop
```

Both `main` and `develop` should be protected. `main` should have the strongest release protection. Regular task branches should remain deletable after merge.

CI should run for Pull Requests targeting both `develop` and `main`, so task integration and release promotion are both checked.
