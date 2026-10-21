# Contributing

Thanks for your interest in contributing! This guide covers the basics.

## Getting started

1. Fork the repository and clone your fork.
2. Install dependencies (see the project README).
3. Create a feature branch off `main`.

## Commit hooks

This repository uses [Husky](https://typicode.github.io/husky/) to run checks before you commit. The pre-commit hook runs [Gitleaks](https://github.com/gitleaks/gitleaks) to scan staged changes for secrets (API keys, tokens, credentials).

- If Gitleaks detects a potential secret, the commit is **blocked**. Remove the secret from your changes and rotate it if it was ever pushed.
- If a finding is a **false positive**, add a suppression entry to `.gitleaksignore` (keyed by the finding's fingerprint) and commit that change alongside your work.

You can run the scan manually at any time:

```sh
gitleaks detect --source . --config .gitleaks.toml
```

## CI gates

In addition to the pre-commit hook, the `secrets-scan` workflow runs Gitleaks on every pull request as an additional gate. A PR will not pass checks if secrets are detected.

## Pull requests

- Keep changes focused and scoped to the linked issue.
- Describe what changed and why in the PR description.
- Make sure all CI checks pass before requesting review.
