---
name: security-audit
description: Security audit of AI-Agent-Builder focused on untrusted generated code — Docker sandbox, static policy bypasses, auth/isolation, secrets, injection, path traversal, exported-Skill risk and dependencies. Use before releases, after sandbox/auth changes, or when adding any code-execution feature.
---

# /security-audit

**Purpose:** confirm that hostile generated Skills cannot reach the host, secrets or other users, and list gaps.

**When:** before release/demo, after touching sandbox.py, validation.py, auth.py, adapters.py or API routes.

**Required tools:** Read, Grep, Bash (read-only + existing tests). Delegate to `security-engineer`.

## Steps
1. Run the existing security tests: `cd apps/api && .venv/Scripts/python.exe -m pytest -q tests/test_sandbox.py
   tests/test_validation.py tests/test_api.py tests/test_evaluation.py`. Record results verbatim.
2. Sandbox flags review (`docker_cmd` in sandbox.py): network, user, caps, read-only, limits, timeout, no mounts.
3. Static-policy bypass review: list bypasses (getattr/`__builtins__`/string-built imports) and confirm each is
   contained by the sandbox; the policy is defense in depth only.
4. AuthN/Z: every route's dependency; LOOPBACK guard vs proxies; API key hashing/revocation; run isolation per key.
5. Secrets: `git log -p | grep -iE "sk-|ghp_|aab_[A-Za-z0-9_-]{30}|password="`; audit redaction; evidence files.
6. Injection & files: subprocess argument lists, `safe_relpath` usage at every file read/write/export,
   ZIP layout, install commands built from slug (slug regex).
7. Dependencies: `npm audit --omit=dev`; list Python deps from `uv.lock`.
8. Findings in FINDING_FORMAT (IDs SE-n); every P0 must include a reproduction or a test that demonstrates it.

## Expected output
docs/reviews/SECURITY_REVIEW.md

## Verification criteria
Each fixed issue later gets a regression test named in its acceptance criteria.

## Failure handling
Docker unavailable → sandbox findings "not verified at runtime"; never claim containment without a run.
