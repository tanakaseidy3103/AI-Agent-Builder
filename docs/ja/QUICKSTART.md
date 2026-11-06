# クイックスタート（日本語）

## 必要なもの

- Node.js 22 以上、npm 10 以上
- [uv](https://docs.astral.sh/uv/)（Python 3.12 を自動で用意します）
- Docker Desktop（データベースとサンドボックス用）
- [Ollama](https://ollama.com) とコード生成モデル

```bash
ollama pull qwen2.5-coder
docker pull python:3.12-slim
```

## 起動

```bash
docker compose up -d db                       # PostgreSQL（127.0.0.1:5433）
cd apps/api
uv sync
.venv/Scripts/python.exe -m alembic upgrade head
.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
# 別のターミナルでリポジトリのルートから
npm install
npm run dev:web                               # http://localhost:5173
```

画面右上の「日本語」ボタンで表示言語を切り替えられます。

## 使い方

1. 「作成」画面で、作りたいエージェントを日本語で説明します（サンプルからも選べます）。
2. 「エージェントを作成」を押すと、右側の Agent Office で各工程（プランナー・デベロッパー・レビュアー・テスター・ビルダー）の作業がリアルタイムに表示されます。表示はすべてバックエンドの実際のイベントに基づきます。
3. 完了後「結果を開く」で、ファイル・マニフェスト・検証結果・エクスポートを確認します。
4. **verified** または **validated** の Skill のみエクスポートできます。ZIP をダウンロードし、表示されたコマンドで Claude Code・Codex・Cursor に導入します（既存の Skill は上書きされません）。

## 状態の意味

| 状態 | 意味 |
|---|---|
| verified | 静的チェック、3 件以上のユニットテスト、すべての評価ケース（非公開ホールドアウトを含む）がサンドボックスで合格 |
| validated | 構造は正しいが、動作は証明されていない |
| validation_failed | 静的チェックに失敗。エクスポート不可。「検証」タブに修正方法を表示 |

## 困ったとき

| 症状 | 対処 |
|---|---|
| 「API：オフライン」 | API（ポート 8000）が起動しているか確認してください |
| 「サンドボックスを利用できません」 | Docker Desktop を起動してください |
| 生成が「Ollama unreachable」で止まる | `ollama serve` が動作しているか、モデルを pull 済みか確認してください |
| verified にならない | 現在のローカルモデルでは生成 Skill の verified 率は実測 0/30 です（`docs/benchmarks/PHASE1_ANALYSIS.md`）。依頼を 1 つのルールに絞ると改善する場合があります |
