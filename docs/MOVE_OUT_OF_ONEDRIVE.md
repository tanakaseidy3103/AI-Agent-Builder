# Moving the repository out of OneDrive (Windows)

Why: on 2026-11-14 the repository lived in `C:\Users\<you>\OneDrive\Área de Trabalho\AI-Agent-Builder`. While builds,
tests and generations wrote files, OneDrive used more CPU time than any other process and held handles on new
folders. Deleting test folders and renaming freshly written package folders then failed with "Access is denied"
(the API now retries that rename; the test harnesses use a fresh folder per run). A non-synchronised folder avoids
both problems.

Principle: **copy, verify, then decide**. Never move in one step, and delete nothing until the copy is verified.
Staged changes live in `.git/index`, unstaged and untracked ones in the working tree: copying the whole folder,
`.git` included, keeps all three exactly.

## 1. Prepare (in the current folder)

1. Stop everything that uses the folder: uvicorn (Studio, demo), Vite, Playwright, terminals and VS Code windows
   opened there. Docker containers can stay up (their data is in Docker volumes, not in the folder).
2. OneDrive → right-click the folder → **Always keep on this device**, and wait until every file shows the green
   check. Cloud-only placeholders would otherwise be downloaded during the copy, or fail.
3. Record the state to compare later (PowerShell, in the repository):

```powershell
git status --porcelain=v1 --untracked-files=all > $env:TEMP\aab-status-before.txt
git diff --cached | Out-File -Encoding utf8 $env:TEMP\aab-staged-before.diff
git diff          | Out-File -Encoding utf8 $env:TEMP\aab-unstaged-before.diff
(Get-FileHash $env:TEMP\aab-staged-before.diff).Hash, (Get-FileHash $env:TEMP\aab-unstaged-before.diff).Hash
```

4. Pause OneDrive syncing (taskbar icon → Pause syncing → 2 hours).

## 2. Copy (not move)

Keep the folder name `AI-Agent-Builder`: Docker Compose derives the project name (and the volume names, e.g.
`ai-agent-builder_pgdata`) from it, so the Postgres data is found again.

```powershell
robocopy "$env:USERPROFILE\OneDrive\Área de Trabalho\AI-Agent-Builder" "C:\dev\AI-Agent-Builder" /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /XD node_modules .venv dist dist-demo test-results playwright-report __pycache__ .pytest_cache
```

This copies `.git`, the ignored but needed files (`apps/api/.env`, `apps/api/.env.demo`, `apps/api/data`,
`apps/api/data-demo`) and everything else. Only re-creatable folders are skipped. robocopy exit codes 0–7 mean
success; 8 or more means some files were not copied: fix and run it again.

## 3. Rebuild the environments in the new folder

```powershell
cd C:\dev\AI-Agent-Builder
npm ci                                   # node_modules
cd apps\api; uv sync --frozen; cd ..\..  # .venv (a virtualenv holds absolute paths; never copy it)
```

## 4. Verify before using it

```powershell
cd C:\dev\AI-Agent-Builder
git status --porcelain=v1 --untracked-files=all > $env:TEMP\aab-status-after.txt
Compare-Object (Get-Content $env:TEMP\aab-status-before.txt) (Get-Content $env:TEMP\aab-status-after.txt)   # must print nothing
git diff --cached | Out-File -Encoding utf8 $env:TEMP\aab-staged-after.diff
git diff          | Out-File -Encoding utf8 $env:TEMP\aab-unstaged-after.diff
(Get-FileHash $env:TEMP\aab-staged-after.diff).Hash, (Get-FileHash $env:TEMP\aab-unstaged-after.diff).Hash  # same as before
git fsck --no-dangling
cd apps\api; .venv\Scripts\python.exe -m pytest -q; cd ..\web; npx vitest run
```

## 5. Afterwards

- Open the new folder in VS Code and work only there.
- Keep the OneDrive copy untouched until you have worked in the new folder for a while; then remove it yourself
  (nothing in this procedure deletes it).
- Resume OneDrive syncing.
