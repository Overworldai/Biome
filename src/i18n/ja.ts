const ja = {
  translation: {
    app: {
      name: 'Biome',
      buttons: {
        settings: '設定',
        upgrade: 'アップグレード',
        later: '後で',
        quit: '終了',
        reconnect: '再接続',
        close: '閉じる',
        cancel: 'キャンセル',
        back: '戻る',
        credits: 'クレジット',
        fix: '修復',
        reinstallEverything: 'すべて再インストール',
        switchMode: 'モードを切り替え',
        keepCurrent: '現在のまま',
        editUrl: 'URLを編集',
        revert: '元に戻す',
        reset: 'リセット',
        scenes: 'シーン',
        resume: '再開',
        exportLogs: 'ログをエクスポート',
        copyReport: 'レポートをコピー',
        reportOnGithub: 'GitHubで報告',
        askOnDiscord: 'Discordで質問',
        showLogs: 'ログを表示',
        hideLogs: 'ログを隠す',
        abort: '中止',
        aborting: '中止中...',
        pasteImageFromClipboard: 'クリップボードから画像を貼り付け',
        browseForImageFile: '画像ファイルを選択'
      },
      dialogs: {
        updateAvailable: {
          title: 'アップデートがあります',
          description:
            '新しい Biome リリース ({{latestVersion}}) が利用可能です。現在のバージョンは {{currentVersion}} です。'
        },
        connectionLost: {
          title: '接続が切断されました',
          description: 'World Engine との接続が失われました。再接続しますか？'
        },
        install: {
          title: 'インストール',
          installing: 'インストール中...',
          failed: '失敗しました。',
          complete: '完了しました。',
          exportCanceled: 'エクスポートをキャンセルしました',
          diagnosticsExported: '診断情報をエクスポートしました',
          exportFailed: 'エクスポートに失敗しました',
          abortRequested: '中止を要求しました',
          abortFailed: 'インストールの中止に失敗しました',
          abortEngineInstall: 'エンジンのインストールを中止',
          closeInstallLogs: 'インストールログを閉じる'
        },
        fixInPlace: {
          title: 'その場で修復しますか？',
          description: '削除は行わず、エンジン依存関係を再同期します。通常はアップデート後の問題解決にこれで十分です。'
        },
        totalReinstall: {
          title: '完全に再インストールしますか？',
          description:
            'エンジンディレクトリを完全に削除し、Python、依存関係、UV パッケージマネージャーを含めて最初から再インストールします。時間はかかりますが、その場での修復で直らない問題に効くことがあります。'
        },
        applyEngineChanges: {
          title: 'エンジン変更を適用しますか？',
          description:
            'エンジンモードまたはワールドモデルを変更すると、現在のセッションが中断され、保留中の設定がすべて適用されます。'
        },
        serverUnreachable: {
          title: 'サーバーに接続できません',
          withUrl:
            '{{url}} に接続できませんでした。サーバー停止、URL の誤り、またはファイアウォールが原因の可能性があります。',
          noUrl: '設定を閉じる前にサーバー URL を入力してください。',
          withUrlSecure:
            '{{url}} に接続できませんでした。サーバー停止、URL の誤り、またはファイアウォールが原因の可能性があります。\n\nHTTPS と WSS は既定ではサポートされていません。Biome サーバーへ直接接続する場合は HTTP または WS を試してください。',
          secureTransportHint:
            'HTTPS と WSS は既定ではサポートされていません。Biome サーバーへ直接接続する場合は HTTP または WS を試してください。'
        }
      },
      loading: {
        error: 'エラー',
        connecting: '接続中...',
        starting: '起動中...',
        firstTimeSetup: '初回セットアップ',
        firstTimeSetupDescription: 'コンポーネントのダウンロードと最適化に 10〜30 分ほどかかります。',
        firstTimeSetupHint: 'その間にコーヒーでもどうぞ。',
        exportCanceled: 'エクスポートをキャンセルしました',
        diagnosticsExported: '診断情報をエクスポートしました',
        exportFailed: 'エクスポートに失敗しました',
        terminal: {
          waitingForServerOutput: 'サーバー出力を待っています...',
          runtimeError: '実行時エラー',
          diagnosticsCopied: '診断情報をコピーしました',
          failedToCopyDiagnostics: '診断情報のコピーに失敗しました',
          openedGithubIssueFormAndCopiedDiagnostics: 'GitHub の Issue フォームを開き、診断情報をコピーしました',
          openedGithubIssueForm: 'GitHub の Issue フォームを開きました',
          failedToOpenIssueForm: 'Issue フォームを開けませんでした',
          whatHappened: '何が起きましたか',
          whatHappenedPlaceholder: '<何をしていて何が失敗したかを書いてください>',
          environment: '環境',
          appVersion: 'アプリのバージョン',
          platform: 'プラットフォーム',
          reproductionSteps: '再現手順',
          recentLogs: '最近のログ',
          fullDiagnostics: '完全な診断情報',
          fullDiagnosticsCopied:
            '完全な診断 JSON はクリップボードにコピーされています。送信前に下へ貼り付けてください。',
          fullDiagnosticsPaste: 'アプリ内の「レポートをコピー」を押し、診断 JSON を下へ貼り付けてください。',
          pasteDiagnosticsJson: '<完全な診断 JSON をここに貼り付けてください>',
          exportDiagnosticsJson: '診断 JSON をエクスポート',
          copying: 'コピー中...',
          copyDiagnosticsJsonForBugReports: 'バグ報告用に診断 JSON をコピー',
          opening: '開いています...',
          openPrefilledIssueOnGithub: 'GitHub の事前入力済み Issue を開く',
          askForHelpInDiscord: 'Discord で助けを求める',
          hideLogsPanel: 'ログパネルを隠す',
          showLogsPanel: 'ログパネルを表示',
          clipboardCopyFailed: 'クリップボードへのコピーに失敗しました'
        }
      },
      settings: {
        title: '設定',
        subtitle: '世界を好みに合わせて調整します。',
        language: {
          title: '言語',
          description: 'Biome で使用する言語はどれですか？',
          system: 'システム設定'
        },
        engineMode: {
          title: 'エンジンモード',
          description: 'モデルをどこで動かしますか？ Biome 内ですか、それとも外部ですか？',
          standalone: 'スタンドアロン',
          server: 'サーバー'
        },
        serverUrl: {
          title: 'サーバー URL',
          descriptionPrefix: 'モデルを実行する GPU サーバーのアドレス',
          setupInstructions: 'セットアップ手順',
          checking: '確認中...',
          connected: '接続済み',
          unreachable: '接続不可',
          placeholder: 'http://localhost:7987'
        },
        worldEngine: {
          title: 'ワールドエンジン',
          description: 'ローカルエンジンは正常ですか？',
          checking: '確認中...',
          yes: 'はい',
          no: 'いいえ',
          fixInPlace: 'その場で修復',
          totalReinstall: '完全再インストール'
        },
        worldModel: {
          title: 'ワールドモデル',
          description: 'どの Overworld モデルで世界をシミュレートしますか？',
          local: 'ローカル',
          download: 'ダウンロード',
          removeCustomModel: 'カスタムモデルを削除',
          custom: 'カスタム...',
          checking: '確認中...',
          modelNotFound: 'モデルが見つかりません',
          couldNotLoadModelList: 'モデル一覧を読み込めませんでした',
          couldNotCheckModel: 'モデルを確認できませんでした'
        },
        volume: {
          title: '音量',
          description: '音量はどのくらいにしますか？',
          master: '全体',
          soundEffects: '効果音',
          music: '音楽'
        },
        mouseSensitivity: {
          title: 'マウス感度',
          description: 'マウス移動に対してカメラをどれだけ動かしますか？',
          sensitivity: '感度'
        },
        keybindings: {
          title: 'キー設定',
          description: 'どのキーを使いますか？',
          resetScene: 'シーンをリセット',
          sceneEdit: 'シーン編集'
        },
        fixedControls: {
          title: '固定コントロール',
          description: '組み込みの操作は何ですか？',
          labels: {
            moveForward: '前進',
            moveLeft: '左移動',
            moveBack: '後退',
            moveRight: '右移動',
            jump: 'ジャンプ',
            sprint: 'ダッシュ',
            look: '視点移動',
            interact: '操作',
            primaryFire: 'メイン射撃',
            secondaryFire: 'サブ射撃',
            pauseMenu: 'ポーズメニュー'
          },
          values: {
            mouse: 'マウス',
            leftClick: '左クリック',
            rightClick: '右クリック'
          }
        },
        experimental: {
          title: '実験的機能',
          description: 'まだ荒削りで、変更や廃止の可能性があるアイデアを試してみませんか？',
          sceneEdit: 'シーン編集',
          sceneEditDescription:
            'ゲームプレイ中にキーを押して、AIでテキストプロンプトを使ってシーンを編集します。追加で約10GBのVRAMが必要です。'
        },
        debugMetrics: {
          title: 'デバッグメトリクス',
          description: '内部で何が起きているか見ますか？',
          performanceStats: '性能統計',
          inputOverlay: '入力オーバーレイ',
          frameTimeline: 'フレームタイムライン'
        },
        credits: {
          title: 'クレジット'
        }
      },
      pause: {
        title: '一時停止',
        pinnedScenes: {
          title: '固定シーン',
          description: '固定したシーンです。シーンボタンを使って{{suffix}}さらにシーンを表示できます。',
          uploadSuffix: '、固定、またはアップロードして',
          pinSuffix: '固定して'
        },
        unlockIn: '{{seconds}} 秒後に解除',
        scenes: {
          title: 'シーン',
          description_one: '全 {{count}} 個のシーンです。',
          description_other: '全 {{count}} 個のシーンです。',
          uploadHint: 'ボタンでシーンを追加するか、ドラッグまたは貼り付けで追加できます。',
          dropImagesToAddScenes: '画像をドロップしてシーンを追加'
        },
        sceneCard: {
          unsafe: '安全でない',
          unpinScene: '固定を外す',
          pinScene: '固定する',
          removeScene: 'シーンを削除'
        }
      },
      scenes: {
        failedToReadImageData: '画像データの読み取りに失敗しました',
        noImageInClipboard: 'クリップボードに画像が見つかりません'
      },
      window: {
        minimize: '最小化',
        maximize: '最大化',
        close: '閉じる'
      },
      social: {
        website: 'Overworld のウェブサイト',
        x: 'Overworld の X',
        discord: 'Overworld の Discord',
        github: 'Overworld の GitHub',
        feedback: 'フィードバックメールを送る'
      },
      sceneEdit: {
        placeholder: 'シーンの変更を説明してください...',
        instructions: 'Enter で適用 \u00b7 Esc でキャンセル',
        applying: 'シーン編集を適用中...'
      },
      server: {
        fallbackError: 'サーバーエラー: {{message}}',
        fallbackWarning: 'サーバー警告: {{message}}',
        websocketError: 'WebSocket エラー',
        serverUrlEmpty: 'サーバーURLが空です',
        noEndpointUrl: 'エンドポイントURLが指定されていません',
        websocketDisconnected: 'WebSocket が切断されました',
        websocketNotConnected: 'WebSocket が接続されていません',
        requestTimeout: 'リクエスト「{{type}}」が {{timeout}}ms 後にタイムアウトしました',
        defaultSeedNotFound: '必須のシードファイル「default.jpg」がシードフォルダに見つかりません',
        invalidWebsocketEndpoint: '無効なWebSocketエンドポイント',
        websocketConnectionFailed: 'WebSocket接続の作成に失敗しました',
        connectionFailed: '接続に失敗しました — サーバーがクラッシュした可能性があります',
        connectionLost: '接続が失われました — サーバーがクラッシュした可能性があります',
        startupTimeout: 'サーバーの起動がタイムアウトしました — ログを確認してください',
        noOpenPort: '範囲 {{rangeStart}}–{{rangeEnd}} で空きポートが見つかりませんでした',
        notResponding: 'サーバーが {{url}} で応答していません',
        error: {
          serverStartupFailed: 'サーバーの起動に失敗しました',
          timeoutWaitingForSeed: '初期シードの待機がタイムアウトしました',
          sceneEditModelLoadFailed: 'シーン編集モデルの読み込みに失敗しました',
          sceneEditSafetyRejected:
            'シーン編集が拒否されました：リクエストがコンテンツ安全性チェックに合格しませんでした。',
          sceneEditEmptyPrompt: 'プロンプトが空です',
          sceneEditModelNotLoaded:
            'シーン編集モデルが読み込まれていません。実験的機能の設定でシーン編集を有効にしてください。',
          sceneEditAlreadyInProgress: 'シーン編集が既に進行中です',
          contentFilterLoadFailed: 'コンテンツフィルターの読み込みに失敗しました',
          cudaRecoveryFailed: 'CUDAエラー — 回復に失敗しました。再接続してください。'
        },
        warning: {
          missingFilename: 'ファイル名がありません',
          seedSafetyCheckFailed: "シード '{{filename}}' の安全性チェックに失敗しました",
          seedUnsafe: "シード '{{filename}}' は安全でないとマークされています",
          seedNotFound: 'シードファイルが見つかりません: {{filename}}',
          seedIntegrityFailed: 'ファイル整合性の検証に失敗しました — シードを再スキャンしてください',
          seedLoadFailed: 'シード画像の読み込みに失敗しました',
          missingModelId: 'モデルIDがありません'
        }
      }
    },
    stage: {
      setup: {
        checking: 'セットアップを確認しています...',
        uv_check: 'セットアップを確認しています...',
        uv_download: 'ランタイムをダウンロードしています...',
        engine: 'エンジンを準備しています...',
        server_components: 'エンジンファイルを準備しています...',
        port_scan: '起動準備をしています...',
        sync_deps: 'コンポーネントをインストールしています...',
        verify: 'インストールを検証しています...',
        server_start: 'エンジンを起動しています...',
        health_poll: 'エンジンの起動を待っています...',
        connecting: '接続中...'
      },
      startup: {
        begin: '初期化しています...',
        world_engine_manager: 'ワールドエンジンを準備しています...',
        safety_checker: 'コンテンツフィルターを設定しています...',
        safety_warmup: 'コンテンツフィルターをウォームアップしています...',
        safety_ready: 'コンテンツフィルターの準備ができました。',
        seed_storage: 'シーンを整理しています...',
        seed_validation: 'シーンを検証しています...',
        ready: 'モデルを読み込む準備ができました。'
      },
      session: {
        waiting_for_seed: 'シーンを準備しています...',
        loading_model: {
          import: 'モデルフレームワークを読み込んでいます...',
          load: 'モデルを読み込んでいます...',
          instantiate: 'モデルをメモリに読み込んでいます...',
          done: 'モデルを読み込みました。'
        },
        inpainting: {
          load: 'シーン編集モデルを読み込んでいます...',
          ready: 'シーン編集モデルの準備ができました。'
        },
        safety: {
          load: 'コンテンツフィルターを読み込んでいます...',
          ready: 'コンテンツフィルターの準備ができました。'
        },
        warmup: {
          reset: 'ウォームアップの準備をしています...',
          seed: 'テストフレームでウォームアップしています...',
          prompt: 'テストプロンプトでウォームアップしています...',
          compile: 'GPU 向けに最適化しています...'
        },
        init: {
          reset: '世界をセットアップしています...',
          seed: '開始シーンを読み込んでいます...',
          frame: '最初のフレームをレンダリングしています...'
        },
        reset: 'GPU エラーから復旧しています...',
        ready: '準備完了！'
      }
    }
  }
} as const

export default ja
