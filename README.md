# cli-chat-poc

CLI-based AI Chat PoC — ブラウザチャットのバックエンドに `claude` / `codex` CLI を使用する。  
APIキー不要。CLIのサブスクリプション認証をそのまま活用。

## Tech Stack

- **Backend:** Hono (TypeScript) — `tsx` で実行
- **Frontend:** React + Vite (TypeScript)
- **CLI Backend:** `claude` CLI または `codex` CLI（環境変数で切り替え）

## Project Structure

```
cli-chat-poc/
├── server/
│   ├── src/
│   │   ├── index.ts              # Hono server (port 3456)
│   │   ├── providers/
│   │   │   ├── types.ts          # AIProvider interface, Message type
│   │   │   ├── claude.ts         # claude CLI provider
│   │   │   ├── codex.ts          # codex CLI provider
│   │   │   └── index.ts          # Factory (AI_PROVIDER env)
│   │   └── routes/
│   │       └── chat.ts           # POST /api/chat (SSE streaming)
│   ├── package.json
│   └── tsconfig.json
├── client/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx               # Chat UI (dark theme)
│   │   ├── App.css
│   │   └── components/
│   │       └── ChatMessage.tsx
│   ├── index.html
│   ├── vite.config.ts            # Proxy /api → localhost:3456
│   ├── package.json
│   └── tsconfig.json
├── package.json                  # Root workspace scripts
└── README.md
```

## Setup

```bash
npm install
cd server && npm install
cd ../client && npm install
```

## Run

```bash
# claude (default)
AI_PROVIDER=claude npm run dev

# codex
AI_PROVIDER=codex npm run dev

# or run separately
npm run dev:server   # Hono on port 3456
npm run dev:client   # Vite on port 5173
```

## URLs

| Service | URL |
|---------|-----|
| Client  | http://localhost:5173 |
| Server  | http://localhost:3456 |
| Health  | http://localhost:3456/api/health |

## API

### POST /api/chat

```json
{
  "message": "Hello!",
  "sessionId": "optional-uuid"
}
```

Response: SSE stream

```
data: {"type":"session","sessionId":"uuid","provider":"claude"}

data: {"type":"text","content":"Hello"}

data: {"type":"text","content":" there!"}

data: {"type":"done"}
```

### GET /api/health

```json
{"status":"ok","provider":"claude"}
```

## CLI Output Parsing

### claude CLI
- Command: `claude --print --output-format stream-json --verbose -p <prompt>`
- JSONL output:
  - `{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}` → テキスト応答
  - `{"type":"result","result":"..."}` → 最終結果

### codex CLI
- Command: `codex exec --full-auto --json <prompt>`
- JSONL output:
  - `{"type":"item.completed","item":{"type":"agent_message","text":"..."}}` → テキスト応答
  - `{"type":"turn.completed"}` → 終了

## 検証結果

| 項目 | 結果 |
|------|------|
| claudeプロバイダーでチャット動作 | ✅ |
| codexプロバイダーでチャット動作 | ✅ |
| ストリーミング（文字が順次表示） | ✅ |
| 会話の文脈維持（前の発言を覚えている） | ✅ |
| エラーハンドリング（CLI未検出等） | ✅ |

### 備考
- codex CLI は対話にも対応している（`exec --full-auto --json` で問い合わせ可能）
- 会話履歴はサーバーメモリ上に保持（永続化なし）
- sessionIdを使い回すことで複数ターンの会話が可能
