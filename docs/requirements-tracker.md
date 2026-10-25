# AI Roundtable requirements tracker

Status: ✅ done　🟡 partly done　⏳ to do　⏸ deferred　(Tests: simulated = CLI simulated by `test/fake-cli.mjs`; real = real accounts and CLIs)

Last updated: 2026-10-25　Version: v1.6.0 (tag `v1.6.0`, developed in starrytss/ai-roundtable); v1.5.0; v1.4.0 (samtss-lab commit `d0f6fb6`), v1.3.0 (commit `2ef856c`), v1.2.0 (commit `d297995`) and v1.1.0 (commit `5311b68`) are kept as recoverable versions

## 2. Before starting

| Item | Status | Notes |
|---|---|---|
| Read AGENTS.md | ✅ | Catalog, design, SEO and tests updated following the site rules |
| Branch, remote and uncommitted changes | ✅ | Developed on `feature/ai-roundtable-v1.1`, merging new `origin/main` commits along the way |
| Keep other work | ✅ | Kept other people's commits such as the cover image and the About studio; fixed a test the cover commit didn't update |
| Source, installer and page match | ✅ | v1.0 source `ad02310` is byte-identical to `AI_Roundtable_Setup_v1.0.zip`; v1.1 onward, see CHANGELOG |
| Recoverable versions and data backup | ✅ | v1.0 source stays in Git; automatic backup on start and before migration; migration tested on a copy of real user data, then the copy was deleted and the original's hash was unchanged |
| CLI versions and capabilities | ✅ | Claude Code 2.1.310, Codex CLI 0.164.0, Antigravity agy 1.4.7, Grok not installed; event formats recorded in `test/fixtures` |

## 3. P0 security and privacy

| # | Item | Status | Implementation and evidence |
|---|---|---|---|
| 1 | Data recipients | ✅ | `engine.js` normalize/check and the pre-send check in `composer.js`; tests engine "unchecked moderator" and server "HTTP: unchecked moderator" (simulated) |
| 2 | What is actually sent | ✅ | Sections in `context.js`, openPreview in `dialogs.js`; manual paste shows the full prompt; 3 context tests (simulated) |
| 3 | Actual permissions | 🟡 | Claude and Codex use official flags (run for real); Antigravity was observed writing files inside and outside the folder, so it's marked "cannot be restricted" and needs confirmation; user settings that change behavior (Codex config.toml, Claude local settings) are neutralized with isolation flags. No option yet to write Antigravity deny rules, because that changes the user's global settings and needs separate consent |
| 4 | Project and task folder isolation | ✅ | `workspace.js`; tests for junction and `..` escapes (real junctions) |
| 5 | Local data protection | ✅ | DPAPI + AES-256-GCM, legacy migration, fallback when encryption fails, files untouched on key mismatch, backup and restore, password export, retention; the CLIs' own logs are listed in the "資料" (Data) panel. DPAPI and migration of a copy of user data tested for real |
| 6 | Masking and skill sharing | ✅ | `redact.js`; relaying skills is off by default and shows the source; 2 context tests (simulated) |
| 7 | Less command-line exposure | ✅ | Claude, Codex and Antigravity all use stdin (real); prompts removed from error messages; Grok and custom commands can only use arguments, and the interface warns clearly |
| 8 | Keep the local API protection | ✅ | 127.0.0.1, new token each start, Host/Origin, CSP, Markdown escaped first; untrusted content fenced; server tests (simulated) |
| 9 | Correct the public page | ✅ | Removed unverified quota amounts and forum claims; updated recipients, permissions, storage location, deletion and test scope |

## 4. P1 stability and maintenance

| # | Item | Status | Implementation and evidence |
|---|---|---|---|
| 1 | Correct completion status | ✅ | `status.js`; tests for all failed, some failed, moderator failed, stopped, interrupted (simulated) |
| 2 | Retry one part | ✅ | `engine.retry`; retry one AI, only the summary, retry limit (simulated, and used in the interface) |
| 3 | Resume after interruption | ✅ | Every step is saved; marked interrupted on restart; resuming needs confirmation to resend (simulated, and after killing the server process for real) |
| 4 | Content length | ✅ | Content budget with an omission report; replaces the fixed 8 turns / 1,500 / 6,000-character truncation |
| 5 | Live progress | ✅ | Stream events parsed for all three (real formats); without events only "sent, waiting for reply" is shown |
| 6 | Connection diagnosis | ✅ | Not installed / incompatible version (required flags checked) / not signed in / not tested / test passed / usage limited / failed |
| 7 | Safe start and stop | ✅ | Lock file + identity + secret; no longer stops processes by port; uses the next port on conflict (simulated) |
| 8 | Backup and updates | ✅ | Versioned backups, format version and migration, import and restore, recovery from corruption |
| 9 | Source matches installer | ✅ | Reproducible `scripts/build.mjs`; BUILD.json; CHANGELOG |
| 10 | Install sources and uninstall | 🟡 | Remote scripts show their URL and need confirmation; winget with a fixed source; uninstall by part; Google Fonts removed; Claude's non-essential traffic can be turned off. The vendors publish no install-script hashes, so they can't be verified; no official flag found for Codex/Antigravity telemetry, only disclosed |

## 5. P2 collaboration

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Step in after each round | ✅ | v1.2: add, skip, continue, auto, summarize now, stop; 3 engine tests (simulated) + interface use |
| 2 | Consensus and disagreement table | ✅ | v1.2: agreements, disagreements (who and why), to verify, to decide; says clearly that majority agreement isn't verification. Claude summarized a real discussion |
| 3 | Shared materials | ✅ | v1.3: text / URL / file, audience, attached by default or chosen per question; phase3 tests (simulated) + interface use |
| 4 | Team and role templates | ✅ | v1.3: relay team templates with roles separate from AIs, save and delete; v1.5: "team roles for this chat" in normal discussions with research team templates (team tests + real accounts: ChatGPT, Claude and a Claude seat each on one direction, Claude integrating) |
| 5 | Structured memory | ✅ | v1.2: four types, source, date, edit, delete, replace; server tests (simulated) |
| 6 | Discussion branches | ✅ | v1.3: branch after a round or step, context and work folder copied, independent afterwards; phase3 tests + interface use |
| 7 | Usage and call preview | ✅ | Expected CLI calls (noted as not equal to inference count or cost), call and retry limits; Claude usage share comes from CLI events, others show unknown; never switches to a paid channel automatically |
| 8 | Output file panel | ✅ | v1.3: source (output, written by an AI, shared material), versions, preview, download, restore an old version, limited to the work folder |

## 6. P3 new features

| # | Item | Status | Dependencies and plan |
|---|---|---|---|
| 1 | Targeted follow-ups and quotes | ✅ | v1.2: @mentions, quote selected text or ask an AI to verify, jump back to the source; engine test confirms only the mentioned AI is called (simulated) |
| 2 | Relay | ✅ | v1.3: task, hand-off scope, acceptance criteria, send back for revision, stop on failure; runs in order to avoid editing files at the same time. phase3 tests (simulated) + a real 2-step run |
| 3 | Evidence and fact checking | 🟡 | v1.2: four claim states + "cited without a read record", read time and AI, request verification; works for real. Limit: Codex search events have no per-page URLs |
| 4 | Images and design mockups | ✅ | v1.4: Claude and Codex see images directly, Antigravity uses its file tool (all real); an AI that can't see images is told so; nothing uploaded to extra services. phase4 tests + a real three-AI image discussion |
| 5 | Task brief form | ✅ | v1.2: six fields, built-in and custom templates, missing items listed together; engine and server tests (simulated) |
| 6 | Output templates | 🟡 | v1.3: six templates producing Markdown/HTML/CSV (real files); Word and PowerPoint are not generated by this app, and the interface says so |
| 7 | Version diff | ✅ | v1.3: line-by-line diff, adopted/rejected log with reasons, restore an earlier version |
| 8 | Local full-text search and tags | ✅ | v1.4: all projects, keyword / tag / AI / date / favorite; local only; favorites separate from memory |
| 9 | Anonymous answer comparison | ✅ | v1.4: names hidden, revealed after choosing, personal preference stats per task type, says clearly it isn't accuracy |
| 10 | Extensible AIs and models | ✅ | v1.4: model lists, capability table, several seats for one AI; unsupported capabilities marked off or unverified |
| 11 | Task queue | ✅ | v1.4: runs in order with cancel, each answer saved to its own chat, paused on restart; no parallel runs (avoids quota and file conflicts) |
| 12 | Convergence and stop conditions | ✅ | v1.4: new-information estimate with suggestions, a time limit for the whole discussion with the stop reason shown; says clearly that similar content isn't proof of correctness |
| 13 | Later candidates | ⏸ | Evaluated, not implemented for now: (1) Voice input and read-aloud: browser speech recognition in Edge sends audio to a cloud service, which needs disclosure and consent; read-aloud could use local voices but adds little. (2) MCP and external data: the CLIs support it, but this app deliberately turns it off with --strict-mcp-config/--safe-mode to avoid widening permissions; enabling it would require listing every allowed action (no sending email or messages, editing or publishing by default). (3) Encrypted sync between computers: password-protected export and import already exist; live sync needs cloud storage and accounts, which would take data off this computer and conflicts with the current privacy design |

## 8. Acceptance checks

| Item | Status | Tests |
|---|---|---|
| All or some AIs fail | ✅ | engine tests (simulated); interface use (simulated CLI) |
| Moderator fails or isn't selected | ✅ | engine and server tests (simulated) |
| Retry one part and resume | ✅ | engine tests (simulated) + resume after killing the server process for real |
| Manual and automatic mixed | ✅ | engine tests (simulated) + pasting a reply in the interface |
| Long content and skill truncation | ✅ | context tests (simulated) |
| File isolation between projects | ✅ | server and engine tests (real junctions) |
| Unauthorized local API requests | ✅ | server tests |
| Backup, migration and restore | ✅ | store tests + real DPAPI + migration of a copy of user data |
| Recipients of targeted follow-ups | ✅ | engine tests (simulated) + interface use |
| AI that can't see images | ✅ | phase4 tests: the prompt says it can't see the image, so it doesn't pretend |
| Task queue and reply ownership | ✅ | phase4 tests: runs in order, each saved to its own chat; manual replies match step IDs |
| Output files and versions | ✅ | phase3 and server tests (no overwrite, source, save old version back) + interface use |
| Source matches installer | ✅ | build tests (two builds identical, bytes identical after Windows extraction) |
| English and Chinese interface | ✅ | i18n tests (simulated) + every dialog checked in English for untranslated text + real accounts: English UI with English and Chinese questions, Chinese UI with an English question; answers followed the question language |
| Team roles for this chat | ✅ | team tests (simulated) + real accounts: ChatGPT, Claude and a Claude seat on three directions, Claude integrating, all 7 calls succeeded |
| Real-account tests | 🟡 | Claude, Codex, Antigravity connections and event formats; a real Claude + ChatGPT discussion, consensus and evidence, and a 2-step relay; a full discussion of the same image by all three; the v1.5 team discussion; v1.6 English and mixed-language discussions; Grok not tested; Setup.bat not run end to end on a fresh computer |
