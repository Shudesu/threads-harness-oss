# 02 Metaアプリとトークン発行

1. [Meta for Developers](https://developers.facebook.com/apps/)でアプリを作成し、作成時に尋ねられたら **Access the Threads API** ユースケースを選択します。後から追加する場合も、このユースケースを選んで設定します。
2. ユースケースのカスタマイズで `threads_basic`、`threads_content_publish`、`threads_manage_insights` を追加します。現行版の新規接続・再確認は3権限を要求します。連投を使う場合は `threads_manage_replies` も追加します。公式の返信作成と返信枠取得の仕様に合わせた条件です。content_publishだけでの連投は実地確認していません。
3. App roles → Roles → Add Peopleから **Threads Tester** として使用するThreadsアカウントを招待します。
4. 招待した本人がThreadsの「設定 → アカウント → ウェブサイトのアクセス許可（Website permissions）→ 招待」を開いて承認します。招待を送るだけでは完了しません。
5. Use cases → Access the Threads API → Settingsの下部にある **User Token Generator** で対象アカウントを選び、Generateを押してThreadsログインのポップアップで承認します。画面配置が異なる場合は公式ガイドに従います。
6. 公式の[Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/)で、対象ユーザー・Threadsアプリ・権限・実際の期限を確認します。**長期トークンと確認できた場合は交換せず、そのまま接続します。** Generatorで長期トークンが直接発行される運用報告がありますが、本人の実トークンでの検証は未実施です。すべての発行分に交換を指示しません。

**Instagram用・Facebook用・アプリ用トークンを接続欄に貼らないでください。** ThreadsのアプリIDとシークレットは、Metaアプリの別のID/シークレットと取り違えないよう、Threads欄から取得します。シークレットを管理画面のトークン欄に入力する必要はありません。

テスター以外のユーザーへの提供には、公開・権限審査などMeta側の条件を満たす必要があります。診断APIも同じアプリの認証が必要です。テスターのトークンは自己診断に使用でき、それ以外は運営者が同じアプリの `THREADS_APP_ACCESS_TOKEN` をWorkerのsecretに設定します。

外部でOAuthコードを取得する場合は、現在の認可URL `https://threads.com/oauth/authorize` を使い、登録済みredirect URIとリクエストのURIを完全一致させます。返却URI末尾の `#_` はコードに含めません。この製品にはコールバック処理がないので、製品URLを登録するだけでOAuth接続は完成しません。

一次資料: [開始手順](https://developers.facebook.com/documentation/threads/get-started.md)、[ユースケース](https://developers.facebook.com/documentation/threads/get-started/create-an-app.md)、[コード交換](https://developers.facebook.com/documentation/threads/get-started/get-access-tokens-and-permissions.md)、[トークン診断](https://developers.facebook.com/documentation/threads/troubleshooting/debug-access-token.md)。

次: [トークンの長期化](03-token.md)

追加一次資料: [Threads資格情報が別であること（公式サンプル）](https://github.com/fbsamples/threads_api/blob/main/README.md)、[返信権限](https://developers.facebook.com/documentation/threads/retrieve-and-manage-replies/create-replies.md)。
