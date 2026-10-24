# AI圓桌會議 更新紀錄

每個安裝包都記錄它對應的原始碼提交（安裝包內 `BUILD.json`）。用同一個提交執行 `node scripts/build.mjs` 會得到位元組完全相同的 zip。

## v1.1.0（2026-10-25）

安裝包：`public/downloads/AI_Roundtable_Setup_v1.1.0.zip`
SHA-256：`71058ca1eb338ee262cd08cd4a2f65d590a7645af37a46339372f976ff6ff43c`
原始碼提交：`5311b68fc7f69bfe9c30a1a7777d7ad15cedda12`

安全與個資
- 送出前列出所有接收者與主持人；主持人不在已勾選的 AI 時，前後端都會擋下，除非明確同意
- 「查看傳送內容」逐項顯示並可取消：專案說明、記憶、歷史摘要、技能內容、參考網址、其他 AI 的回答
- 權限分成五級（只用文字／可搜尋與讀網頁／讀取／寫入／執行指令），使用各家 CLI 的正式參數：Claude 用 `--tools --restricted --safe-mode`，Codex 用 `-s read-only|workspace-write --ignore-user-config --ephemeral`；無法限制的 Antigravity 需要確認
- 每個專案／對話有獨立工作資料夾，路徑與 junction 越界檢查
- 對話以 AES-256-GCM 加密，金鑰由 Windows DPAPI 保護；v1.0 明文資料自動轉移；版本化備份、還原、密碼保護匯出、保存期限
- 可選的敏感資訊遮蔽（Email、手機、身分證、卡號、API 金鑰、私密金鑰、密碼），技能轉述預設關閉
- 所有提示改走標準輸入（含 Antigravity 的 stream-json），錯誤訊息移除提示內容
- 本機 API 保留 127.0.0.1、每次啟動換 token、Host／Origin 檢查，新增 CSP；不再載入 Google 字型

穩定性
- 結果分成完成／部分完成／失敗／已中止／已中斷，附原因
- 單獨重試某位 AI、某一輪或只重做主持人總結；中斷後續跑，可能已送出的步驟要確認才重送
- 內容預算：問題與規則完整保留，其餘依優先順序放入並標示省略範圍
- 依 CLI 事件顯示搜尋、讀網頁、讀寫檔案與回答狀態；沒有事件不推測進度
- 連線檢查區分未安裝、版本不相容、未登入、尚未測試、測試通過、用量受限
- 單一執行個體鎖定檔；start.bat 只在確認身分後請舊程式結束；連接埠被占用時改用下一個
- 安裝程式先顯示遠端安裝腳本網址並要求確認；解除安裝分開處理程式、對話、工作資料夾與 CLI 登入

## v1.0.0（2026-10-24）

安裝包：`public/downloads/AI_Roundtable_Setup_v1.0.zip`（提交 `4bc39f4` 更新後的版本）
原始碼：`apps/ai-roundtable` 的提交 `ad02310`（與安裝包內容逐位元組相同）
