# AI Roundtable (AI圓桌會議)

Seat the ChatGPT, Claude, Gemini and Grok subscriptions you already have around one table: each AI makes its own proposal, they challenge each other, and a moderator writes up the conclusion.

- A Windows 10/11 desktop app. Every AI runs through the **official command-line tool** on your computer and signs in with **your own account**. No API keys needed
- An AI you don't subscribe to can still join in "manual paste" mode
- Conversations stay on this computer, encrypted with your Windows account
- Made by [SamEgg Lab (山姆蛋實驗室)](https://samtss.com/tools/ai-roundtable/) and open-sourced under the MIT license

> The interface is available in English and Traditional Chinese, and the AIs answer in the language you ask in. 中文說明請看官網：https://samtss.com/tools/ai-roundtable/
>
> This tool is not an official product of OpenAI, Anthropic, Google or xAI.

## Download and install

1. Open the latest version on the [**Releases**](https://github.com/starrytss/ai-roundtable/releases/latest) page
2. Under **Assets** below the release notes (expand it if collapsed), click **`AI_Roundtable_Setup_v1.6.0.zip`**
   - You do **not** need `Source code (zip)` or `Source code (tar.gz)`. Those are for developers
3. Right-click the downloaded zip → "Extract All". Don't run anything from inside the zip
4. Double-click **`Setup.bat`** in the extracted folder and choose English (press Enter) or 中文
   - If Windows shows "Windows protected your PC", click "More info" → "Run anyway"
   - Choose which AIs to use. Before downloading an official installer, Setup shows its URL and waits for your confirmation
5. When it finishes, an "AI Roundtable" shortcut appears on your desktop. The first launch runs a connection check, where you can change the language again. Click "Test" to confirm each AI really answers

**Verify the file (optional)**: every release includes `SHA256SUMS.txt`. Run this in PowerShell and compare the result with the value in that file.

```powershell
Get-FileHash .\AI_Roundtable_Setup_v1.6.0.zip
```

**Upgrading**: download the new version and run `Setup.bat` again. Your conversations and settings are kept. A v1.0 plain-text `data.json` is migrated and encrypted on first launch, and the old file is left for you to delete.

**Uninstall**: run `%LOCALAPPDATA%\Roundtable\uninstall.bat`. It asks separately about the app, your conversations, the work folders and the CLI sign-ins.

## Requirements

- Windows 10 or 11
- Node.js LTS (installed automatically by Setup)
- At least one AI subscription and its official command-line tool (Setup guides you)

| AI | Command-line tool | Permission control |
| --- | --- | --- |
| Claude | Claude Code | Tool list and file scope are enforced by Claude Code |
| ChatGPT | Codex CLI | Writes are sandboxed to the work folder; it can still read files on your computer |
| Gemini | Antigravity (`agy`) | This app cannot restrict its file and command access, so you must confirm before first use |
| Grok | — | Not tested yet |

## Features

- **Multi-AI discussion**: pick the AIs, the number of rounds and a moderator. Pick only one and it's a normal chat
- **Team roles for this chat**: give each AI its own role for this chat so they research different directions at the same time, then the moderator integrates everything. Save a team as a template, and seat the same AI twice to cover two directions
- **Pre-send check**: lists every recipient and the expected number of calls; inspect and remove each part of what will be sent
- **Pause and follow up after each round**: add constraints, skip an AI, `@mention` an AI with a follow-up, or quote part of an answer and ask another AI to verify it
- **Consensus and evidence**: lists agreements, disagreements and key claims. A claim is marked "supported by a source that was read" only when the AI actually read that source
- **Relay**: work passes from role to role (research → planning → review → final), each step has acceptance criteria and can be sent back for revision
- **Shared materials and output files**: share documents and URLs with chosen AIs; generate Markdown, HTML and CSV outputs, each as a new version
- **Version diff and branches**: compare two answers line by line, or branch into plan A/B after any round
- **Images and design mockups**: up to 5 per question. An AI that can't see images is told so instead of pretending
- **Model choice and extra seats**: the same AI can take another seat with a different model or role
- **Local search, tags, favorites, task queue and anonymous comparison**
- **English or Chinese interface**: chosen during setup and switchable any time from the language button at the bottom of the sidebar. Prompts sent to the AIs follow the interface language, and the AIs answer in the language of your question

## Data and privacy

- The local API listens only on `127.0.0.1`, uses a new token on every start and checks Host and Origin, so it only accepts the app's own window
- Prompts go to the official CLIs through standard input and never pass through a third-party server
- Conversations and settings are stored in `%LOCALAPPDATA%\AI-Roundtable`, encrypted with AES-256-GCM, with the key protected by Windows DPAPI. Attached images are stored as original files without encryption
- Back up, restore, export (optionally password-protected) and set a retention period. Optionally mask emails, phone numbers, card numbers, API keys and other sensitive data before sending

## Version history

Full notes are on [Releases](https://github.com/starrytss/ai-roundtable/releases) and in [CHANGELOG.md](CHANGELOG.md).

| Version | Date | Highlights |
| --- | --- | --- |
| [v1.6.0](https://github.com/starrytss/ai-roundtable/releases/tag/v1.6.0) | 2026-10-25 | English and Chinese interface (English by default for new installs), English prompts and templates, bilingual installer; AIs answer in the language of your question |
| [v1.5.0](https://github.com/starrytss/ai-roundtable/releases/tag/v1.5.0) | 2026-10-25 | Team roles for this chat: each AI researches its own direction and the moderator integrates; research team templates; the same AI can take two seats with different directions |
| [v1.4.0](https://github.com/starrytss/ai-roundtable/releases/tag/v1.4.0) | 2026-10-25 | Images and design mockups, model choice and extra seats, local full-text search with tags and favorites, task queue, anonymous comparison, convergence hints and a time limit |
| [v1.3.0](https://github.com/starrytss/ai-roundtable/releases/tag/v1.3.0) | 2026-10-25 | Relay, shared materials, output templates and files, file panel, version diff with adoption log, discussion branches |
| [v1.2.0](https://github.com/starrytss/ai-roundtable/releases/tag/v1.2.0) | 2026-10-25 | Pause after each round, `@mention` follow-ups and quote-to-verify, consensus and evidence, task brief, typed memory, usage display |
| [v1.1.0](https://github.com/starrytss/ai-roundtable/releases/tag/v1.1.0) | 2026-10-25 | Recipient confirmation, five permission levels, encrypted storage with backups, sensitive-data masking, retry and resume, connection check, safer install and uninstall |
| [v1.0.0](https://github.com/starrytss/ai-roundtable/releases/tag/v1.0.0) | 2026-10-24 | First release: several AIs discuss using your own subscriptions, a moderator concludes, manual paste mode |

## Development

No npm packages to install.

```powershell
npm test              # run all tests with a simulated CLI (no AI service, no usage)
npm run dev           # open the app at http://127.0.0.1:3499 with the simulated CLI
npm run build         # build the installer zip into dist/
```

- Running the app needs Node.js 18 or later; building the installer needs Node.js 20.15 or later
- `npm run dev` can simulate failures, exhausted quotas and more with a rules file; see the top of `scripts/dev-fake.mjs`
- Building the same commit with `npm run build` produces a byte-identical zip. `BUILD.json` inside the installer records the commit and the SHA-256 of every file
- Requirements and verification status are in [docs/requirements-tracker.md](docs/requirements-tracker.md)
- Code comments are in Traditional Chinese. Interface text is written in Chinese and translated with the dictionary in `app/ui/js/i18n-en.js`; prompts for the AIs are in `app/lib/context.js` (Chinese) and `app/lib/prompts-en.js` (English)

```
app/server.js      local server and API
app/lib/           engine, CLI arguments per AI, encrypted store, search, output files and more
app/ui/            interface (plain ES modules, strict CSP)
test/              automated tests and the simulated CLI
scripts/           build and development tools
Setup.bat etc.     Windows install, launch and uninstall scripts (keep their exact bytes; don't convert line endings)
```

### Issues and contributions

- Report bugs and ideas in [Issues](https://github.com/starrytss/ai-roundtable/issues) with the version, your Windows version and the AIs you use. Please don't paste conversation content, accounts or keys
- Pull requests should include tests and pass `npm test`
- Report security problems privately through [Security advisories](https://github.com/starrytss/ai-roundtable/security/advisories/new)

## License

[MIT](LICENSE)
