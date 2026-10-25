# AI Roundtable changelog

Every installer is attached to [GitHub Releases](https://github.com/starrytss/ai-roundtable/releases), and its source is the tag with the same name (for example `v1.5.0`).

v1.0 to v1.4 were developed inside the samtss-lab repository. The full commit history moved here, but the commit IDs changed, so `BUILD.json` in those installers records the original samtss-lab commit. From v1.5.0 on, building the tagged commit with `npm run build` produces a byte-identical zip.

## v1.6.0 (2026-10-25)

Installer: [AI_Roundtable_Setup_v1.6.0.zip](https://github.com/starrytss/ai-roundtable/releases/download/v1.6.0/AI_Roundtable_Setup_v1.6.0.zip)
SHA-256: `788b92c3825717eb6a6928a4b0f1abf618e086dc3dbb73d67f4d94f530ec6f3c`
Source: tag `v1.6.0` (commit `f3ad16884572d772881b1e97930cb14ce4bef68f`; `npm run build` on this commit produces the same zip)

English and Chinese interface
- The whole interface is available in English and Traditional Chinese: buttons, dialogs, error messages, notes about each AI's permissions, dates and the exported Markdown
- New installs start in English. Data created before this version keeps Chinese
- Choose the language at the start of Setup.bat; the first launch's connection check also offers the choice, and the language button at the bottom of the sidebar switches any time
- Only interface text is translated. AI answers, your questions and anything you typed (names, roles, notes) stay exactly as written
- Prompts sent to the AIs follow the interface language: each prompt has a full English version (discussion modes, team roles, moderator integration, relay, fact checking, briefs, output templates)
- The AIs answer in the language of your question, whatever the interface language. Tested with real accounts: English interface with an English question (ChatGPT and Claude, 2 rounds with team roles) and with a Chinese question, and Chinese interface with an English question
- English built-in templates (research teams, relay teams, task briefs) when the interface is English
- Setup.bat and the uninstaller are bilingual; the desktop shortcut is named "AI Roundtable" or "AI圓桌會議"
- README.txt in the installer starts with an English section

Notes
- If an existing installation is reinstalled with a different language, the app keeps its current language; switch it from the sidebar

## v1.5.0 (2026-10-25)

Installer: [AI_Roundtable_Setup_v1.5.0.zip](https://github.com/starrytss/ai-roundtable/releases/download/v1.5.0/AI_Roundtable_Setup_v1.5.0.zip)
SHA-256: `81c304f69f9495eb3238e37db22d60a3044ad460abf11de67bff6548c2d3fce4`
Source: tag `v1.5.0` (commit `0c157197e183929ae79ece1b9e5dc06c40e3ffc4`; `npm run build` on this commit produces the same zip)

Team roles for this chat
- New "👥 分工" (Team) button in the input area: give each AI its own role for this chat so they research different directions at the same time. From round 2, every answer is labeled with its role, and each AI is asked to add to or challenge the other directions from its own role
- The moderator receives the full list of roles, summarizes each direction, explains where they support or conflict with each other, then gives an integrated recommendation and what still needs checking. The moderator integrates without keeping its own research direction
- The team is saved on the chat and applies only to that chat, replacing the role in AI settings. A new chat starts without it, a branch copies it, and retries or an extra round reuse the same roles
- Research team templates: built-in "市場調查小組" (market research) and "產品評估小組" (product evaluation); save and delete your own
- The same AI can take several seats, each with its own direction (using the extra seats from v1.4)
- The pre-send check and the answer cards show each AI's role
- Relay still uses each step's own role and ignores the team
- Tested with real accounts: ChatGPT, Claude and a second Claude seat each covered one direction; after 2 rounds Claude integrated them; all 7 calls succeeded

Fixes
- The "text only" permission no longer repeats the same sentence in the prompt

## v1.4.0 (2026-10-25)

Installer: [AI_Roundtable_Setup_v1.4.0.zip](https://github.com/starrytss/ai-roundtable/releases/download/v1.4.0/AI_Roundtable_Setup_v1.4.0.zip)
SHA-256: `b4e15ae602856c8acc063683cb3dc30605af79d5cb3a16fc5092918c56b88e90`
Source: tag `v1.4.0` (`BUILD.json` in the installer records samtss-lab commit `d0f6fb630260483124f2646e1ee7bb26e0f34682`)

Phase 4
- Images and design mockups: up to 5 per question (PNG/JPG/WebP/GIF, up to 10 MB, format checked by file content). Tested: Claude (stream-json image blocks, no tools) and Codex (`--image`) see images directly; Antigravity rejects image blocks, so the image goes into the work folder and its file tool opens it (works). Grok and custom commands are unverified, and their prompt says they can't see the image. Images are stored as original files in the data folder, unencrypted
- Model choice and capabilities: Claude alias list, Antigravity list read from `agy models`, Codex typed in. Settings show text, image, search, file and command capabilities; Gemini's file and command access is marked "cannot be controlled"
- Extra AI seats: the same AI can take another seat with its own name, model and role. The four built-in seats can't be deleted
- Local full-text search, tags and favorites: search questions and answers across all projects, filter by tag, AI, date or favorite. Favorites are separate from project memory
- Task queue: runs one task at a time and saves each answer to its own chat; tasks can be canceled; the queue is paused when the app restarts
- Anonymous comparison: hides AI names and shuffles the order until you pick; records your preference per task type and says clearly it isn't accuracy
- Convergence hints: from round 2, estimates new information with character-trigram overlap and suggests summarizing or checking only the disagreements when it's low. A time limit for the whole discussion (60 minutes by default) stops it automatically and says why
- When the app is closed or unreachable, the window shows one notice and recovers automatically when the app is back

## v1.3.0 (2026-10-25)

Installer: [AI_Roundtable_Setup_v1.3.0.zip](https://github.com/starrytss/ai-roundtable/releases/download/v1.3.0/AI_Roundtable_Setup_v1.3.0.zip)
SHA-256: `fca631fe05c5cbbd4d60818801ec302c3d65e7450c8ecabe34a9b26f853ffde5`
Source: tag `v1.3.0` (`BUILD.json` in the installer records samtss-lab commit `2ef856c840bd02e138e83b47551126b2199fb4f2`)

Phase 3
- Relay: each step has a role, an assigned AI, a task, acceptance criteria and a hand-off scope (previous step, all previous steps, or the question only). Steps run in order, so no two AIs edit the same file at once. Each step can be reviewed and sent back for revision (feedback goes only to that step and the old version is kept), and a failure stops and waits for a retry. Two built-in team templates, and you can save your own; roles and AIs are separate
- Shared materials: text, URLs and text files. Each item has its own audience and whether it's attached by default, and you can choose per question. Files shared with only some AIs are not placed in the work folder
- Output templates: marketing proposal, work breakdown and schedule, budget comparison, decision record, website requirements, test and acceptance checklist. Applied only to the final step
- Output files: Markdown, HTML (printable to PDF) and CSV (the first table, opens in Excel). Each format is numbered separately and never overwritten, and an old version can be saved back as a new one. Word and PowerPoint are not generated by this app
- File panel: files in the work folder with their source (output, written by an AI, shared material), preview and download; links are not followed
- Version diff and adoption log: compare any two answers, summaries or outputs line by line; record which suggestions were adopted or rejected and why, optionally into project memory
- Discussion branches: start a new chat after any round or step, with the shared context and work folder fully copied, so the two never affect each other

## v1.2.0 (2026-10-25)

Installer: [AI_Roundtable_Setup_v1.2.0.zip](https://github.com/starrytss/ai-roundtable/releases/download/v1.2.0/AI_Roundtable_Setup_v1.2.0.zip)
SHA-256: `bf3f6965e00a6cecf1d5248b134722b33c94fbd9b6511495ba55df7eacc4b47b`
Source: tag `v1.2.0` (`BUILD.json` in the installer records samtss-lab commit `d2979958ec5b20b9aae17c605f359790bd804058`)

Phase 2 collaboration
- Pause after each round: add instructions (applied only to later rounds and the summary), skip an AI in the next round, continue, stop pausing, summarize now or stop here. A skip you chose doesn't count as a failure
- Follow-ups and quotes: an `@Claude`-style mention goes only to that AI. Select text in an answer to "quote and ask" or "ask an AI to verify". Quoted text is fenced as untrusted data, with a link back to the source
- Consensus and evidence: an AI that took part summarizes agreements, disagreements, claims, items to verify and decisions to make, using text only. "Supported by a source that was read" requires a read in the CLI's event log; otherwise it becomes "cited without a read record"
- Task brief: goal, audience, budget, timeline, must-keep conditions and output format. Three built-in templates and your own. The AIs list their assumptions once for any field left empty
- Typed memory: preferences, confirmed decisions, items to verify and rejected suggestions, with source and date; edit, delete or replace (the replaced version is kept)
- The pre-send check shows usage reported by the CLI (currently only Claude Code reports it); the others show unknown

Known limits
- Codex search events contain keywords and domains but no per-page URLs, so URLs cited by ChatGPT show as "not yet verified" in the evidence panel

## v1.1.0 (2026-10-25)

Installer: [AI_Roundtable_Setup_v1.1.0.zip](https://github.com/starrytss/ai-roundtable/releases/download/v1.1.0/AI_Roundtable_Setup_v1.1.0.zip)
SHA-256: `71058ca1eb338ee262cd08cd4a2f65d590a7645af37a46339372f976ff6ff43c`
Source: tag `v1.1.0` (`BUILD.json` in the installer records samtss-lab commit `5311b68fc7f69bfe9c30a1a7777d7ad15cedda12`)

Security and privacy
- Before sending, lists every recipient and the moderator. If the moderator isn't one of the selected AIs, both the interface and the server block it unless you explicitly agree
- "查看傳送內容" (View what's sent) shows each part and lets you remove it: project description, memory, history summary, skill content, reference URLs and other AIs' answers
- Five permission levels (text only / search and read the web / read / write / run commands), using each CLI's official flags: Claude uses `--tools --restricted --safe-mode`, Codex uses `-s read-only|workspace-write --ignore-user-config --ephemeral`. Antigravity can't be restricted and needs confirmation
- Each project and chat has its own work folder, with path and junction escape checks
- Conversations encrypted with AES-256-GCM, key protected by Windows DPAPI. v1.0 plain-text data is migrated automatically. Versioned backups, restore, password-protected export and retention period
- Optional masking of sensitive data (email, mobile number, national ID, card number, API key, private key, password). Relaying skill content is off by default
- All prompts go through standard input (including Antigravity's stream-json), and error messages no longer include prompt content
- The local API stays on 127.0.0.1 with a new token every start and Host/Origin checks, plus a CSP. Google Fonts are no longer loaded

Stability
- Results are done / partial / failed / stopped / interrupted, with reasons
- Retry a single AI, a single round or only the moderator's summary. After an interruption, resume; steps that may already have been sent need confirmation before resending
- Content budget: the question and rules are always kept in full; everything else is added by priority, and omitted ranges are marked
- Shows search, web reads, file reads/writes and answering based on CLI events; no events means no guessed progress
- The connection check distinguishes not installed, incompatible version, not signed in, not yet tested, test passed and usage limited
- Single-instance lock file; `start.bat` only asks the old instance to quit after confirming its identity; if the port is taken, the next one is used
- Setup shows the URL of each remote install script and asks for confirmation first; uninstall handles the app, conversations, work folders and CLI sign-ins separately

## v1.0.0 (2026-10-24)

Installer: [AI_Roundtable_Setup_v1.0.zip](https://github.com/starrytss/ai-roundtable/releases/download/v1.0.0/AI_Roundtable_Setup_v1.0.zip) (the version updated by samtss-lab commit `4bc39f4`)
Source: tag `v1.0.0` (samtss-lab commit `ad02310`, byte-identical to the installer contents)

First release
- Several AIs at one table: pick the AIs and 1 to 3 rounds; each proposes, they challenge each other, and a moderator concludes. "再討論一輪" (One more round) is available
- Each AI uses the official command-line tool on your computer and your own subscription; an AI you don't subscribe to can join in manual paste mode
- Custom commands and roles for each AI (for example "a reviewer who hunts for flaws")
- Projects and chats: the project description and project memory are shared by every chat in the project, and a conclusion can be added to project memory
- Skills: lists the skills installed on your computer, with an option to allow skills and tools
- Setup wizard: `Setup.bat` installs the chosen CLIs, signs in to each and creates a desktop shortcut; `uninstall.bat` removes it
