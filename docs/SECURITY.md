# Security model

Audit date: 2026-11-06, updated 2026-11-11 (security hardening audit). This describes what the code enforces and what it does not. It makes no compliance claims
(no ISO 27001, SOC 2 or similar certification exists).

## Security boundaries

| Boundary | Enforced by | Verified by |
|---|---|---|
| **Generated code never runs in the API process** | All execution goes through `docker run` (sandbox.py) | `test_sandbox.py` (real Docker) |
| **Sandbox isolation** (the real boundary) | `--network none`, `--read-only`, tmpfs `/tmp`, uid 65534, `--cap-drop ALL`, `no-new-privileges`, memory/CPU/PID limits, wall-clock timeout, no host mounts (package streamed as tar), empty host environment | `test_no_network`, `test_timeout_enforced`, `test_host_env_not_leaked_and_fs_readonly`, `test_archive_traversal_blocked_inside_container` |
| **Eval judgement stays on the host** | only case names and inputs enter the container; `evals/` files, `expect` and the holdout flag never do; outputs are compared to expectations by the API process (`judge_case`) | `test_eval_expectations_never_enter_the_container`, `test_forged_marker_cannot_reveal_hidden_expectations` |
| **Result line** | runner writes the last stdout line, then `os._exit`; host parses only that line. This stops accidental or atexit-based overwrites, **not** deliberate forgery: Skill code runs in the same process and can write its own final line (see below) | `test_generated_code_cannot_forge_test_results` |
| **Host resources vs. sandbox output** | stdout/stderr are streamed and only the last 8 MB / 64 KB are kept; `--log-driver none` | `test_output_flood_keeps_host_memory_bounded` (before: 1.78 GB host memory for one 10 s run) |
| **Studio vs. other websites** | `Origin` / `Sec-Fetch-Site` must be local on every Studio HTTP route and on the events WebSocket (browsers apply no CORS to WebSockets) | `test_cross_site_browser_requests_to_studio_are_refused`, `test_cross_site_websocket_is_refused` |
| **Request size** | ASGI middleware refuses bodies over `MAX_REQUEST_BYTES` (2 MB) while reading, with or without Content-Length | `test_oversized_request_body_is_refused_before_parsing` |
| **Package paths** | `safe_relpath` (no `..`, absolute paths, drive letters or hidden files; allowlisted dirs and extensions; size limits) on generation, storage, file preview and export | `test_validation.py`, `test_file_preview_blocks_traversal` |
| **Studio (unauthenticated)** | loopback client check **and** Host allowlist (DNS-rebinding defence) | `test_studio_is_local_only`, `test_dns_rebinding_hosts_are_rejected` |
| **Public `/v1` API** | Bearer API keys stored as SHA-256 hashes, revocable, rate limit per key, input and output validated against schemas, runs visible only to the key that created them | `test_api.py` |
| **Export** | only `validated`/`verified` versions (HTTP 409 otherwise); install commands refuse to overwrite | `test_export_blocked_for_unvalidated`, Playwright `real.spec.ts` |
| **Secrets in logs** | audit details with key/token/password/secret names are redacted; plaintext API keys are shown once and never stored | `models._redact` |

## Not a security boundary (best effort only)

- **Static validation** (import policy, forbidden calls, stdlib attribute check) is defense in depth. Since the
  2026-11 audit it also refuses `from os import <forbidden>`, `getattr(os|sys|builtins|shutil|…, …)`, `globals()`/`vars()`,
  frame/`__builtins__`/`__subclasses__` introspection, `shutil`/`tempfile`, pathlib write/delete methods and `open()`
  with a write or non-literal mode. It is still an AST check of a dynamic language and can be bypassed by
  sufficiently indirect code; it gives early feedback and does not make arbitrary code safe.
  Since 2026-11-14 it also rejects an entrypoint that reads the file system (`code.inputs_from_data`): a quality rule
  (inputs come from `data`), not an isolation control; the sandbox filesystem is read-only either way.
- **`verified` is a quality signal, not a security guarantee.** Skill code can forge the unit-test results (tests and
  code share a process) and the result line. What it cannot do any more is see eval expectations: to pass the eval
  criterion, including the holdout case, its outputs must really match expectations held on the host.
- **Exported Skills run outside the sandbox** on the user's machine, through Claude Code / Codex / Cursor, under
  those tools' own permission prompts. Review the code before installing.

## Known gaps

| Gap | Risk | Status |
|---|---|---|
| No user accounts, no tenant isolation | Anyone with local access controls the Studio; API keys are global | open: required before any shared or hosted deployment |
| Rate limiter per process | ineffective with several workers | documented `shortcut:` |
| Audit log has no retention or export policy | — | open |
| Vite dev server must not be exposed (`vite --host`) | the proxy makes remote requests look local to the Studio | documented; production should serve the built app |
| Docker socket is required on the host for the sandbox | whoever runs the API controls Docker | by design; never mount the socket into the API container |
| Sandbox failure classes | a Skill could print Docker-like error text and exit 125 to look like an infrastructure fault | accepted: the only effect is `unavailable` (never `verified`); `sys.exit()` inside Skill code is caught by the runner, so this needs deliberate effort and gains nothing |
| API image build context | `.env`, `.env.demo` and Skill data were copied into the image by `COPY . .` | **fixed 2026-11-14** in `apps/api/.dockerignore` (verified with a test build) |
| API image user | ran as root | **fixed 2026-11-14**: uid 10001, writes only `/data` (verified: `/app` not writable, container healthy) |
| Demo stage details and live events | carried raw failure text, e.g. the model server's address, to the visitor who owns the job | **fixed 2026-11-14**: same sanitizing as job errors (`test_model_failure_never_reveals_the_model_server_in_stages_or_events`) |
| Remote model server | Ollama has no authentication | `OLLAMA_API_KEY` sends a Bearer key to an authenticating proxy (`deploy/ollama-proxy.Caddyfile.example`, only chat/tags/ps forwarded); key never logged or shown (`test_api_key_is_sent_on_every_model_server_call_and_never_in_errors`). Never expose 11434 directly |
| `/health/ready` on the public demo | reveals whether the database, sandbox image and model are up | accepted: booleans only, no versions or error text, cached 10 s so it cannot be used to spawn `docker` processes |

## Dependency audit (2026-11-14; previous: 2026-11-06)

- `npm audit` (apps/web, including dev dependencies): 0 vulnerabilities.
- `uvx pip-audit` on the locked API dependencies (`uv export --frozen --no-dev`): no known vulnerabilities.
- Secret scan (2026-11-14) of tracked and untracked, non-ignored files: only the fake credentials in
  `apps/api/tests/test_validation.py` (test data for the detector). `apps/api/.env` and `.env.demo` are git-ignored.
- Python SDK: no dependencies.
- Secret scan of all Git history (Anthropic/OpenAI/GitHub tokens, AWS keys, private keys): 0 matches.
