# Residue

![platform](https://img.shields.io/badge/platform-Windows-lightgrey)
![License](https://img.shields.io/github/license/omer-denen/residue-cleaner)
![Version](https://img.shields.io/github/v/tag/omer-denen/residue-cleaner?label=version)

[Türkçe (varsayılan)](README.md) · **English**

**A CLI cleaner that shows its evidence.** AI coding tools and developer
tooling leave CLI caches, model stores, virtual environments, sessions and
updater leftovers behind — none of them show up in the Windows "Add or remove
programs" list. Residue recognises these folders
**by the evidence inside them, not by their names**: it tells you what each
folder is, what exactly deletion would cost, and why it decided that way.

> **This is not a Windows disk cleaner.** It is not a general disk cleanup,
> registry/PATH repair, "PC tune-up" or free-up-space tool. Its scope is only
> the developer and AI leftovers that Windows never lists. **Nothing is
> deleted without your approval;** the first scan only lists.

> **Alpha (0.3.0-alpha.0):** The project is **pre-beta**. The UI and contract may
> change; before using it for real deletions, try `--dry-run` and the vault.
> The version stays **0.x** until a stable release is announced. The `2.2.0`
> version on npm predates this alpha; the alpha package is not published.

## Why trust it?

Every operation is analyzed first. Dependencies are identified and presented
for your approval. If you want, you can put it on a plan and move it to your
vault. Control is entirely yours. We do not delete anything... You do the
cleanup.

---

## Scope and limits

| It does not | Why |
|---|---|
| Touch the registry, PATH or uninstall entries **by default** | It is not general Windows maintenance; `residue env` can clean PATH only after explicit approval + backup |
| Delete your documents, photos or projects "to free space" | Those folders are never decisions |
| Delete a folder just because of its name | Without evidence it says "unidentified" and **reports only** |
| Delete models, agent sessions or skills | That is your data; they never become delete targets |
| Delete its own data (logs, backup vault) | The tool never targets its own data directory |

It answers one question with evidence: **"What is this folder, and what happens if I delete it?"**

---

## Start in 30 seconds

1. Install **Node.js 22.6 or newer** → [nodejs.org](https://nodejs.org) (LTS).
2. Open **PowerShell**: Start → type `PowerShell` → open.
3. Type this and press Enter:

   ```powershell
   node bin/residue.mjs scan
   ```

4. The tool scans the folders left behind by developer and AI tooling and
   lists each one with **what it is, what deletion would cost and why it
   decided that way**. Measuring large folders can take a few minutes; stop
   it with `Ctrl+C`.
5. Pick what you want to move to the vault → `residue clean` → read the plan
   → type `TASI` for medium/high risk → confirm. Permanent deletion
   (`--purge`) asks for `SIL`.
6. Prefer a browser over the terminal? Run `node bin/residue.mjs ui --web`.

The default mode moves items into the tool's own **vault**, so a wrong
decision is reversible (`residue undo --restore`).

> **2.2.0 note:** The browser UI is back: `residue ui --web` (loopback only;
> the token travels in an `HttpOnly + SameSite=Strict` cookie and never
> appears in the URL). The UI never decides anything: lists, totals and
> approval phrases come from the decision engine. Deletion is still a
> two-step, written-approval flow.
>
> **2.0.0 note:** The project was renamed: **Residue** (npm package
> `residue-cleaner`, command `residue`). Your data (vault, journal) lives
> in `%LOCALAPPDATA%\residue`.

### Never used a terminal before?

- Run `node --version`; if it is below `v22.6.0`, install the LTS from nodejs.org.
- `node bin/residue.mjs scan` downloads the package on first run; it takes a few seconds.
- `node bin/residue.mjs` prints the command list and the help text.
- You do not have to delete anything; `residue clean --dry-run` shows the
  plan only.

---

## Browser UI (2.2.0)

Prefer a browser over the terminal:

```powershell
node bin/residue.mjs ui --web
```

- The server listens on **`127.0.0.1` only**; it cannot be reached from the
  network.
- Every start generates a fresh token. The token is delivered in an
  `HttpOnly + SameSite=Strict` cookie and **never appears in the address bar**.
- Screens: **Overview**, **Disk**, **Plan/Approval**, **Projects**, **Tools**,
  **PATH & Environment**, **Graph**, **Schedules**, **Vault**, **Settings**.
- The UI never decides anything: which clusters are listed, which are
  selectable, all totals and the approval phrases (`TASI`, `SIL`, `BOŞALT`,
  `TEMİZLE`, `PLANLA`) come from the decision engine. The browser never sends
  a path to delete.
- Deletion and plan execution remain **two-step**: plan first, written
  approval second. High-risk targets are flagged separately; `--yes` cannot
  skip this.
- **Keyboard:** `/` focuses search, `?` opens the shortcut list, `Esc` closes;
  arrow keys move between sections. `Tab`, `Enter` and `Space` select rows and
  open details. "Skip to content" and "Skip to the list" links jump straight
  into long screens.
- **Projects** is read-only: project sources are never delete targets; only
  dependencies, the lockfile hash and a reproducible recipe are reported.
- **With the update check off, no network request is made.** When enabled, only
  the npm registry version number is queried; there is no telemetry.

> The UI runs on the headless API exposed by `residue api`. To bind that API
> to your own tools instead, use `residue api --port 4321`; it serves no UI.

---

## If you use AI coding tools

> **New to AI tools** — installing your first agent or model? This section is
> for you. You can be a senior developer and still be new to AI tooling.

AI coding tools download a lot in the background: model files, GPU libraries,
Python environments, package caches, agent sessions and skills. They never
appear in "Add or remove programs", and it is hard to tell what can be
regenerated and what is **your data**.

| What is on the AI side? | What Residue does |
|---|---|
| Agent sessions, skills, memory | **Keeps them.** User value; never produces a delete target. |
| Plugin dependencies inside an agent workspace | **Reported.** Regenerable; skills and plan files are kept. |
| Model files | **Keeps them.** Only unusable GPU leftovers become candidates; CPU models stay. |
| GPU libraries | A candidate only when proven unused; otherwise untouched. |
| Python / conda environments | **Reports** old or idle ones; project-bound environments are kept. |
| Package caches | Safe candidate because they can be downloaded again. |
| Unused CLI tools | Produces a removal **plan**; never removes anything on its own. |

### Plain-language glossary

| Term | What it means |
|---|---|
| **Cache** | Files that can be downloaded again; deleting them recreates them. |
| **Model** | The big file that is the AI's "brain"; re-downloading can be gigabytes. |
| **Environment** | An isolated install of a project's Python packages. |
| **Agent session / skill** | Chat history and learned skills — **your data**. |

> Rule: **agent data, skills and models are never deleted automatically.** Only
> reproducible caches and parts proven unusable become candidates.

---

## What it finds — and what it leaves alone

**Finds (shows as candidates):**

| Category | Examples |
|---|---|
| Package caches | npm, NuGet, conda, uv |
| Interpreter environments | `.venv`, conda environments |
| Model stores | ONNX / GGUF files |
| GPU leftovers | unused CUDA libraries |
| Updater leftovers | updater folders, old versions |
| CLI / agent leftovers | unused tools |

**Leaves alone:**

| Untouched | Why |
|---|---|
| Documents, photos, projects | never scanned |
| Application settings | only cache folders are targeted |
| Agent sessions and skills | user value |
| Files tracked by Git | version-controlled files are never deleted |
| Virtual disks | report only |
| SDK installations | report only |
| The tool's own data directory | journals and the backup vault live there |

---

## Project scan: leftovers inside your own project

To look at `node_modules`, `.venv` or `dist` inside a project, you choose the
folder to scan:

```bash
residue scan --root C:\projects\myapp
```

In this mode:

- Results are **report-only**: no delete target is ever produced.
- The `.git` folder is not scanned, and files **tracked** by Git can never be
  targeted. Only untracked or `.gitignore`d paths are considered.
- A project scan does not touch your 24-hour system scan cache.

---

## Why it is safe

- **Evidence:** every decision says why it was made; when evidence is missing
  the tool says "unidentified" and only reports.
- **Two steps:** a plan first, then a written approval. Vault move asks
  `TASI`, permanent deletion asks `SIL`; `--yes` cannot bypass it.
- **Vault:** default mode; deleted items move to the tool's vault and can be restored.
- **Journal:** every destructive step is written first; interrupted work is reported by `residue recover`.
- **Evidence tree:** every recommendation is explained as observation → evidence → claim.
- **Dependency graph:** CLI removal is blocked when a hard/active dependency would break.
- **Environment variables:** secrets are masked; writes only happen via `env --clean --apply` with a backup and typed approval.
- **Targeted deletion:** not the whole folder — only the safe part.
- **Git awareness:** tracked files can never be targeted; project scans are
  report-only.
- **Last line of defence:** if the delete layer is asked to remove an ancestor of
  a protected path, or the tool's own data directory, it refuses.
- **Local and open:** the tool runs only on this machine; no telemetry, MIT
  licensed.

---

## FAQ

**I only want to look, not delete.**
Inspect; nothing is deleted. In the terminal, `residue clean --dry-run`
shows the plan only.

**Will it delete my AI agent's chats, skills or model?**
No. Agent sessions and skills count as user data. Models are kept; only GPU
leftovers proven unusable become candidates.

**Will it delete `node_modules` inside my project?**
A project scan (`--root`) never produces delete targets; it only reports. Files
tracked by Git are protected in every mode anyway.

**I deleted something by mistake.**
Restore from the vault: `residue undo --restore`.

**How do I open the browser UI?**
Run `node bin/residue.mjs ui --web`; it opens on `127.0.0.1`. Press `Ctrl+C`
in the terminal to close it.

**The UI says "invalid token".**
Every start generates a new token, so an old tab or URL becomes invalid.
Close the terminal and start `residue ui --web` again.

**Can I disable a standalone tool without deleting it?**
Yes. Quarantine it: `residue quarantine <ad>`. The shim moves to the vault
(the command leaves PATH), your data stays in place, and the restore steps
are written to the vault.

**Why is the scan slow?**
It measures the largest folders on disk. You can stop it at any time with
**Cancel scan**.

**Node is missing / too old.**
Install the LTS from [nodejs.org](https://nodejs.org); verify with
`node --version`.

**Does it work outside Windows?**
Windows only for now.

**My antivirus warned me.**
The tool can delete files. Run `residue clean --dry-run` first; it deletes
nothing.

**Is my data sent anywhere?**
No. Everything runs locally.

**How do I uninstall it?**
`npm uninstall -g residue-cleaner`. If you only used `npx`, nothing is installed.

---

## Installation

**Requirements:** Windows 10/11 and Node.js 22.6+ ([nodejs.org](https://nodejs.org)).
No administrator rights needed.

```bash
git clone https://github.com/omer-denen/residue-cleaner.git
cd residue-cleaner && npm install
node bin/residue.mjs scan   # scan without installing anything globally
```

Command form: `node bin/residue.mjs <subcommand>` (e.g. `node bin/residue.mjs scan`).

**Uninstall:** there is no npm install; delete the repository folder.
Tool data lives under `%LOCALAPPDATA%\residue` (logs, scan cache, backup
vault). **The tool never lists or deletes this directory in its own scans**;
because the backup vault lives there, do not delete it by hand either.

| Problem | Fix |
|---|---|
| "Invalid token" | A new token is generated on every start; close the old address |
| Terminal UI looks broken | Use a real terminal (PowerShell / Windows Terminal) |
| Non-Windows system | Only Windows is supported for now |

---

## Usage

```bash
residue                     # command list and help
residue scan                # scan and list in the terminal
residue scan --root .       # report project-internal leftovers only
residue clean --dry-run     # show the plan only, delete nothing
residue clean               # two-step confirmation + vault (reversible)
residue undo --restore      # restore from the vault
residue repair --dry-run    # show broken / partial installations
residue repair              # repair (ONAR confirmation; live output)
residue quarantine <ad>     # move a standalone tool to the vault (KARANTINA confirmation)
residue env                 # PATH / environment analysis (read-only)
residue env --clean         # PATH cleanup plan (writes nothing)
residue project [dir]       # project dependencies + reproducible recipe
residue graph               # CLI dependency graph; --what-if <name>
residue schedule            # scheduled vault cleanup (daily/weekly)
residue vault               # vault inventory / retention / permanent delete
residue recover             # report interrupted operations
residue ui                  # terminal UI (Ink; needs a real terminal)
residue ui --web            # browser UI (dist/web; 127.0.0.1)
residue api                 # headless HTTP/SSE API (no UI; 127.0.0.1)
```

For more: `residue help`

---

## Updates

The automatic update check is **off by default**. Choosing `Daily` or
`Weekly` in the Settings screen queries only the npm registry version number;
while it is off, **no network request is made**.
Manual update:

```bash
git pull                        # update from source
npm install                     # refresh dependencies
```

- Source: <https://github.com/omer-denen/residue-cleaner>

The automatic update check is **off** by default (no network request is made).
To enable it, set **Update check** in the Settings screen to `Daily` or
`Weekly`.

---

## License

MIT — see [LICENSE](LICENSE).

Residue never sends data anywhere; everything runs on your machine.
The deletion decision always belongs to you.
