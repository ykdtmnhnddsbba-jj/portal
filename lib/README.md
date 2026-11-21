# portal/lib

## techo-google.js
全部の手帖（アニメ・ゲーム・映画ドラマ・本・ハムスター・謎解き）で共通の Google ログインと Drive 同期。

- `TechoGoogle.create({site, clientId})` → `{redirect, token, silentOk, message, fetch, find, read, write, syncFile}`
- トークンは localStorage `techo_gauth_tok`（{t,e,scope}）に1つだけ保存し、全手帖で共有する。
- 各手帖の state は `<site>_gauth_state`、サイレント認証の多重防止は `<site>_gauth_silent`。
- `read` は失敗すると例外を投げる（404 なら `e.forget=true`）。`syncFile` は読み込み失敗時に書き込まない。
- このファイルを変えると全手帖に影響するので、変更後は全手帖で同期を確認すること。
