# 08 任意の管理者SSO

APIキーログインだけならSSO設定は不要です。信頼する管理ポータルと `ADMIN_SSO_SECRET`（32文字以上）を共有する場合に限り使います。テナントごとに秘密を分けます。

`GET /admin/sso?token=...` のtokenは `base64url(payloadJson).base64url(signature)`。署名は共有秘密をUTF-8鍵としたHMAC-SHA256で、対象はエンコード済みpayload部分です。base64urlはパディングなし。

payloadは `aud: "admin-sso"`、整数の `iat` / `exp`（Unix秒）、8〜128文字の一意な `jti`（英数字と `._:-`）。任意の `sub` は最大200文字で表示用、権限判定には使いません。

有効期間は最大300秒、発行時計の先行許容は60秒。`exp > iat` かつ未失効でなければ拒否します。migration 0002の `admin_sso_jti` に使用済みIDを記録し、再利用を拒否します。HEADは消費しません。

SSOはAPIキーと同じ管理者権限を付与します。URLをログ・チャットに残さず、必要時に発行します。署名の参照実装は `src/admin-sso-token.ts`。失敗理由は403の汎用文面にし、認証情報は公開しません。
