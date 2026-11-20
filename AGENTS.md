# AGENTS.md

- まず [README.md](README.md) を読み、知りたいことの場所をそこから辿る
- main に直接 push しない。ブランチを切って PR で入れる
- コミットメッセージ・ブランチ名・PR のタイトルは [docs/development.md](docs/development.md) の形にする。本文は日本語
- 秘密（API キー・トークン）をコミットしない
- 個人の環境のこと（手元のパス・マシンの名前）を書かない。このリポジトリは公開されている
- 設計は [docs/design.md](docs/design.md)、通信の仕様は [docs/api.md](docs/api.md)、ゲームの進行は [docs/game.md](docs/game.md) にある。実装がドキュメントと違うときは、同じ PR でドキュメントも直す
- ドキュメントに書かれていない仕様は、自分で決めずに人に聞く
- ツールは Vite+（`vp`）。Vite を直接呼ばず、`npm run dev`・`npm run build`・`npx vp check` を使う。Vite+ のドキュメントは `node_modules/vite-plus/docs/` にある
- 変更したら `npx vp check` を通す
