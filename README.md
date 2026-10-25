# AI圓桌會議

讓你訂閱的 ChatGPT、Claude、Gemini、Grok 圍坐一桌開會：各自提案、互相挑戰，最後由主持人整理出結論。

- Windows 10／11 桌面程式，每個 AI 都透過你電腦上的**官方命令列工具**、用**你自己的帳號**登入，不需要申請 API Key
- 沒有訂閱的 AI 也能用「手動貼上」模式加入討論
- 對話只存在這台電腦，用 Windows 帳戶加密
- 由 [山姆蛋實驗室 SamEgg Lab](https://samtss.com/tools/ai-roundtable/) 製作，以 MIT 授權開源

> 本工具不是 OpenAI、Anthropic、Google、xAI 的官方產品。

## 下載與安裝

1. 到 [**Releases**](https://github.com/starrytss/ai-roundtable/releases/latest) 打開最新版本
2. 在版本說明下方的 **Assets**（收合時請點開）點選 **`AI_Roundtable_Setup_v1.5.0.zip`**
   - 一般使用者**不需要**下載 `Source code (zip)` 或 `Source code (tar.gz)`，那是給開發者的原始碼
3. 在下載的 zip 上按右鍵 →「解壓縮全部」，不要直接在壓縮檔裡執行
4. 雙擊資料夾裡的 **`Setup.bat`**
   - 出現「Windows 已保護您的電腦」時，按「其他資訊」→「仍要執行」
   - 依畫面選擇要使用的 AI；需要下載官方安裝程式時會先顯示網址，確認後才執行
5. 完成後桌面會出現「AI圓桌會議」。第一次開啟會做連線檢查，按「測試」確認每個 AI 真的能回答

**檢查檔案（選用）**：每個版本的 Assets 都附有 `SHA256SUMS.txt`。在 PowerShell 執行下面的指令，結果應該和檔案裡的值相同。

```powershell
Get-FileHash .\AI_Roundtable_Setup_v1.5.0.zip
```

**從舊版升級**：直接下載新版並執行 `Setup.bat`，對話與設定會保留。v1.0 的明文 `data.json` 會在第一次開啟時自動轉移並加密，舊檔保留給你決定是否刪除。

**解除安裝**：執行 `%LOCALAPPDATA%\Roundtable\uninstall.bat`。程式、對話、工作資料夾和 CLI 登入分開詢問。

## 需要什麼

- Windows 10 或 11
- Node.js LTS（安裝程式會自動安裝）
- 至少一個 AI 訂閱，並安裝它的官方命令列工具（安裝程式會引導）

| AI | 使用的命令列工具 | 權限控制 |
| --- | --- | --- |
| Claude | Claude Code | 工具清單與檔案範圍由 Claude Code 強制 |
| ChatGPT | Codex CLI | 寫入由沙盒限制在工作資料夾，仍可讀取電腦上的檔案 |
| Gemini | Antigravity（`agy`） | 本程式無法限制它的檔案與指令權限，第一次使用前需要你確認 |
| Grok | — | 尚未實測 |

## 功能

- **多 AI 討論**：勾選要參與的 AI，設定輪數與主持人；勾一位就是一般聊天
- **這個對話的分工**：為每位 AI 指定這次的職務，大家同時往不同方向研究，最後由主持人整合；可存成研究團隊範本，同一家 AI 也能多坐一席負責另一個方向
- **送出前檢查**：列出每一位接收者與預計呼叫次數，可以逐項查看並取消要傳送的內容
- **每輪後暫停與追問**：補充限制、略過某位 AI、`@點名` 追問、引用回答文字請另一位 AI 查證
- **整理共識與證據**：列出共識、分歧與重要主張；只有真的讀取過來源的主張才標成「有讀取來源支持」
- **分工接力**：依職務一棒接一棒（研究 → 企劃 → 審查 → 整理），每棒有驗收條件，可以退回修改
- **共用資料區與成果檔**：放文件與網址指定分享對象；產生 Markdown、HTML、CSV 成果檔，每次都是新版本
- **版本比較與討論分支**：逐行比較兩個回答，從某一輪之後分出方案 A／B
- **圖片與設計稿**：每題最多 5 張；看不到圖的 AI 會被告知，不會假裝看過
- **模型選擇與新增席位**：同一家 AI 可以用不同模型或角色多坐一位
- **本機搜尋、標籤、收藏、任務佇列、匿名比較**

## 資料與隱私

- 本機 API 只聽 `127.0.0.1`，每次啟動換一組 token，並檢查 Host 與 Origin，只接受圓桌自己的視窗
- 所有提示都經由標準輸入交給官方 CLI，不經過任何第三方伺服器
- 對話與設定存在 `%LOCALAPPDATA%\AI-Roundtable`，以 AES-256-GCM 加密，金鑰由 Windows DPAPI 保護；附上的圖片以原檔保存，沒有加密
- 可以備份、還原、匯出（可設密碼）、設定保存期限，並可選擇遮蔽 Email、手機、卡號、API 金鑰等敏感資訊

## 各版本更新

每個版本的完整說明在 [Releases](https://github.com/starrytss/ai-roundtable/releases) 與 [CHANGELOG.md](CHANGELOG.md)。

| 版本 | 日期 | 重點 |
| --- | --- | --- |
| [v1.5.0](https://github.com/starrytss/ai-roundtable/releases/tag/v1.5.0) | 2026-10-25 | 這個對話的分工：每位 AI 負責不同方向、主持人整合；研究團隊範本；同一家 AI 多席各負責一個方向 |
| [v1.4.0](https://github.com/starrytss/ai-roundtable/releases/tag/v1.4.0) | 2026-10-25 | 圖片與設計稿、模型選擇與新增席位、本機全文搜尋／標籤／收藏、任務佇列、匿名比較、收斂提示與時間上限 |
| [v1.3.0](https://github.com/starrytss/ai-roundtable/releases/tag/v1.3.0) | 2026-10-25 | 分工接力、共用資料區、成果範本與成果檔、檔案面板、版本比較與採納紀錄、討論分支 |
| [v1.2.0](https://github.com/starrytss/ai-roundtable/releases/tag/v1.2.0) | 2026-10-25 | 每輪後暫停、`@點名` 追問與引用查證、共識與證據整理、任務簡報、分類記憶、用量顯示 |
| [v1.1.0](https://github.com/starrytss/ai-roundtable/releases/tag/v1.1.0) | 2026-10-25 | 送出前確認接收者、五級權限、加密儲存與備份、敏感資訊遮蔽、重試與續跑、連線檢查、安全的安裝與解除安裝 |
| [v1.0.0](https://github.com/starrytss/ai-roundtable/releases/tag/v1.0.0) | 2026-10-24 | 第一版：多個 AI 用你自己的訂閱帳號一起討論、主持人整理結論、手動貼上模式 |

## 開發

不需要安裝任何 npm 套件。

```powershell
npm test              # 執行全部測試（用模擬 CLI，不連任何 AI 服務、不用額度）
npm run dev           # 用模擬 CLI 在 http://127.0.0.1:3499 開啟程式
npm run build         # 產生安裝包到 dist/
```

- 執行程式需要 Node.js 18 以上；建置安裝包需要 Node.js 20.15 以上
- `npm run dev` 可以用規則檔模擬失敗、額度用完等狀況，說明在 `scripts/dev-fake.mjs` 開頭
- 同一個提交執行 `npm run build` 會得到位元組完全相同的 zip，安裝包內的 `BUILD.json` 記錄它對應的提交與每個檔案的 SHA-256
- 需求與驗證進度在 [docs/requirements-tracker.md](docs/requirements-tracker.md)

```
app/server.js      本機伺服器與 API
app/lib/           引擎、各家 CLI 參數、加密儲存、搜尋、成果檔等
app/ui/            介面（純 ES module，嚴格 CSP）
test/              自動測試與模擬 CLI
scripts/           建置與開發工具
Setup.bat 等       Windows 安裝、啟動、解除安裝腳本（保留原始位元組，請勿轉換換行）
```

### 回報問題與貢獻

- 錯誤與建議請開 [Issue](https://github.com/starrytss/ai-roundtable/issues)，附上版本號、Windows 版本與使用的 AI；請不要貼上對話內容、帳號或金鑰
- Pull Request 請附上測試，並確認 `npm test` 全部通過
- 發現安全問題請先用 GitHub 的 [Security advisories](https://github.com/starrytss/ai-roundtable/security/advisories/new) 私下回報

## 授權

[MIT](LICENSE)
