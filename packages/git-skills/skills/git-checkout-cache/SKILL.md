---
name: git-checkout-cache
description: "Cache and refresh remote git repositories under ~/.cache/checkouts/<host>/<org>/<repo> for reuse. Use when the user points you to a remote git repository as reference, or when you need to read, search or analyze a remote repo locally without full clone overhead."
---

Use this skill when the user points you to a remote git repository (GitHub/GitLab/Bitbucket URLs, `git@...`, or `owner/repo` shorthand) as a reference for reading or analysis.

The goal is to keep a reusable local checkout that is:
- **stable** (predictable path)
- **up to date** (periodic fetch + fast-forward when safe)
- **efficient** (partial clone with `--filter=blob:none`, no repeated full clones)

## Cache location

```
~/.cache/checkouts/<host>/<org>/<repo>
```

Example: `github.com/aretw0/agents-lab` → `~/.cache/checkouts/github.com/aretw0/agents-lab`

## Command

```bash
bash checkout.sh <repo> --path-only
```

Examples:

```bash
bash checkout.sh aretw0/agents-lab --path-only
bash checkout.sh github.com/mitsuhiko/minijinja --path-only
bash checkout.sh https://github.com/mitsuhiko/minijinja --path-only
```

The script will:
1. Parse the repo reference into `host/org/repo`
2. Clone if missing (partial clone with `--filter=blob:none`)
3. Reuse existing checkout if present
4. Fetch from `origin` when stale (default interval: 300s)
5. Attempt fast-forward merge if checkout is clean and has upstream

## Force refresh

```bash
bash checkout.sh <repo> --force-update --path-only
```

## Recommended workflow

1. Resolve path via `checkout.sh --path-only`
2. Use that path for `grep`, `read`, `find`, and analysis
3. On later references to the same repo, call `checkout.sh` again — hits cache

## Notes

- `owner/repo` shorthand defaults to `github.com`
- Prefer not to edit directly in the shared cache — create a worktree or copy for task-specific changes
