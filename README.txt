AI Roundtable v1.6
==================
by SamEgg Lab
English guide and source code: https://github.com/starrytss/ai-roundtable
（中文說明在下方）

Seat the ChatGPT, Claude, Gemini and Grok subscriptions you already have around one table: each AI proposes, they challenge each other, and a moderator writes the conclusion.
Every AI runs through the official command-line tool on your computer with your own account. No API keys needed.

[Install]
1. Extract this folder (don't run anything from inside the zip)
2. Double-click Setup.bat and choose English or 中文 first
   - If Windows shows "Windows protected your PC", click "More info" → "Run anyway"
3. Choose the AIs you use. Before downloading an official installer, Setup shows its URL and waits for your confirmation
4. An "AI Roundtable" shortcut appears on your desktop. The first launch runs a connection check; click "Test" to confirm each AI really answers

[Language]
- The interface and the prompts sent to the AIs follow the language you choose; the AIs answer in the language you ask in
- Switch any time with the language button at the bottom of the sidebar

[Where your data is]
- Conversations and settings: %LOCALAPPDATA%\AI-Roundtable (encrypted with your Windows account)
- Files created by AIs: %LOCALAPPDATA%\AI-Roundtable\workspaces
- Uninstall: %LOCALAPPDATA%\Roundtable\uninstall.bat

This tool is not an official product of OpenAI, Anthropic, Google or xAI.


AI圓桌會議 v1.6
================
山姆蛋實驗室 SamEgg Lab 製作
使用說明與常見問題：https://samtss.com/tools/ai-roundtable/

讓你訂閱的 ChatGPT、Claude、Gemini、Grok 圍坐一桌開會：各自提案、互相挑戰，最後由主持人整理出結論。
每個 AI 都透過你電腦上的官方命令列工具、使用你自己的帳號。

【安裝】
1. 解壓縮這個資料夾（不要直接在壓縮檔裡執行）
2. 雙擊 Setup.bat
   - 如果出現「Windows 已保護您的電腦」，按「其他資訊」→「仍要執行」
3. 依畫面選擇要使用的 AI；需要下載官方安裝程式時會先顯示網址，確認後才執行
4. 完成後桌面會出現「AI圓桌會議」。第一次開啟會做「連線檢查」，按「測試」確認每個 AI 真的能回答

【資料會傳給誰】
- 送出前，輸入框下方會列出這次的接收者（包含主持人）與預計呼叫次數
- 按「查看傳送內容」可以看到每一項實際內容，並選擇要不要附上專案說明、記憶、歷史、技能內容
- 主持人如果沒有被勾選為參與者，仍會收到問題與最後一輪的回答，畫面會清楚標示

【第二階段新增】
- 每輪後暫停：補充限制、略過下一輪的某位 AI、直接總結或停在這裡
- @點名追問與引用：選取回答裡的文字可以「引用追問」或「請某位 AI 查證」，只有被點名的 AI 會收到
- 整理共識與證據：列出共識、分歧與重要主張；只有真的讀取過來源的主張才會標成「有讀取來源支持」
- 任務簡報：目標、對象、預算、時程等欄位，可存成範本；沒填的欄位會請 AI 一次列出假設
- 分類記憶：偏好、已確認的決策、待查證、未採用的建議，可編輯、刪除與取代

【第三階段新增】
- 分工接力：依職務一棒接一棒（例如研究 → 企劃 → 審查 → 整理），每棒有任務與驗收條件，可以退回修改；團隊範本可以另存
- 共用資料區：放文件、網址、文字檔，指定分享給哪些 AI
- 成果範本與檔案：行銷提案、分工時程、預算比較、決策紀錄、網站需求、驗收清單；可產生 Markdown、HTML（可列印成 PDF）、CSV（Excel 可開啟），每次產生都是新版本
- 檔案面板、版本比較與採納紀錄：預覽、下載、回到舊版本、逐行比較，記下採納或拒絕的建議
- 討論分支：從某一輪或某一棒之後建立方案 A／B，兩邊互不影響

【第四階段新增】
- 圖片與設計稿：每題最多 5 張。Claude 與 ChatGPT 直接看圖，Gemini 用自己的讀檔工具打開；看不到圖的 AI 會被告知它沒看到，不會假裝看過。圖片以原檔存在這台電腦，沒有加密
- 模型選擇與新增席位：每個 AI 可選模型（Gemini 的清單來自 agy models）；同一家可以用不同模型或角色多坐一位；設定頁顯示文字、圖片、搜尋、檔案、指令能力
- 本機搜尋、標籤與收藏：搜尋所有專案，依關鍵字、標籤、AI、日期、收藏篩選；收藏和專案記憶分開
- 任務佇列：先排好多個提問，一次執行一個，可以取消；程式重新開啟後佇列會先暫停
- 匿名比較：隱藏 AI 名稱選出最有幫助的回答再揭曉；只記錄你的偏好，不是正確率
- 收斂提示與時間上限：新一輪和上一輪很接近時提示可以直接總結；整場討論超過時間上限會自動停止並註明原因

【v1.5 新增】
- 這個對話的分工：按輸入區的「👥 分工」，為每位 AI 指定這次的職務（例如市場、成本、風險），大家同時往不同方向研究，最後由主持人整合成一份結論
- 分工只套用在這個對話，會取代 AI 設定裡的角色；可以存成研究團隊範本（內建「市場調查小組」「產品評估小組」）
- 同一家 AI 想做兩個方向：先在 AI 設定「新增 AI 席位」，再在分工裡各填一個職務
- 送出前的檢查列與每張回答卡片都會標出職務；重試與再討論一輪沿用同一組分工

【v1.6 新增】
- 介面語言：可選英文或中文；安裝時先選，之後在側欄最下方的語言按鈕切換
- 送給 AI 的提示跟著介面語言，AI 會用你提問的語言回答
- 升級前已經在用的程式維持中文

【權限】
- Claude：工具清單與檔案範圍由 Claude Code 強制
- ChatGPT（Codex）：寫入由沙盒限制在工作資料夾；仍可讀取電腦上的檔案
- Gemini（Antigravity）：本程式無法限制它的檔案與指令權限，需要你先確認
- Grok：尚未實測

【資料存在哪裡】
- 對話與設定：%LOCALAPPDATA%\AI-Roundtable（用 Windows 帳戶加密）
- AI 產生的檔案：%LOCALAPPDATA%\AI-Roundtable\workspaces（每個對話一個資料夾）
- 在程式左下角「資料」可以備份、還原、匯出（可設密碼）、設定保存期限
- v1.0 的 data.json 會在第一次開啟時自動轉移並加密，舊的明文檔保留給你決定是否刪除

【需要】
- Windows 10 或 11、Node.js LTS（安裝程式會自動安裝）
- 至少一個 AI 訂閱；沒有訂閱的 AI 也能用「手動貼上」模式加入討論

【注意】
- 本工具不是 OpenAI、Anthropic、Google、xAI 的官方產品
- 各家的使用規範、方案與額度會變動，請以官方說明為準；請只供自己使用，不要共用帳號
- 更新版本：用新版的檔案再執行一次 Setup.bat，原本的對話會保留

【解除安裝】
執行 %LOCALAPPDATA%\Roundtable\uninstall.bat。程式、對話紀錄、AI 產生的檔案、各家 CLI 的登入會分開詢問。

有問題或點子？歡迎到 https://samtss.com/say-hello/
