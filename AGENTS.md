# AGENTS.md

AI（Claude Code、Codex など）にこのリポジトリで開発させるときの決まり。

- まず [README.md](README.md) を読み、知りたいことの場所をそこから辿る
- 何を作るかは [docs/kikakusho.md](docs/kikakusho.md)、開発の進め方は [docs/development.md](docs/development.md)
- 作業は Issue 単位。1 Issue = 1 ブランチ = 1 PR。main に直接 push しない
- コミットメッセージと PR・Issue の本文は日本語
- コミット・PR・Issue に AI の署名（`Co-Authored-By` の行、「Generated with …」など）を付けない
- 秘密（API キー・トークン）をコミットしない
- 個人の環境のこと（手元のパス・マシンの名前）を書かない。このリポジトリは公開されている
