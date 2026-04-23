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
        returnToMainMenu: 'メインメニューに戻る',
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
        resume: '再開',
        copyReport: 'レポートをコピー',
        saveReport: 'レポートを保存',
        reportOnGithub: 'GitHubで報告',
        askOnDiscord: 'Discordで質問',
        showLogs: 'ログを表示',
        hideLogs: 'ログを隠す',
        abort: '中止',
        aborting: '中止中...',
        copy: 'コピー',
        open: '開く',
        browseForImageFile: '画像ファイルを選択',
        delete: '削除'
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
        deleteModelCache: {
          title: 'モデルを削除しますか？',
          description:
            '<bold>{{modelId}}</bold> はこのデバイスにダウンロードされています。削除するとディスク容量が空きますが、再び使用するにはモデルを再ダウンロードする必要があります。'
        },
        recordings: {
          title: '録画',
          empty: 'まだ録画がありません。録画を有効にすると、次のセッションから保存されます。',
          openFolder: 'フォルダを開く',
          refresh: '更新',
          confirmDeleteTitle: '録画を削除しますか？',
          confirmDeleteDescription: '<bold>{{filename}}</bold> を削除しますか？この操作は取り消せません。',
          openExternally: '開く'
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
          fullDiagnosticsCopiedHint:
            '完全な診断 JSON はクリップボードにコピーされています。送信前に下へ貼り付けてください。',
          fullDiagnosticsCopyHint: 'アプリ内の「レポートをコピー」を押し、診断 JSON を下へ貼り付けてください。',
          pasteDiagnosticsJson: '<完全な診断 JSON をここに貼り付けてください>',
          saveDiagnosticsJson: '診断 JSON をファイルに保存',
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
        tabs: {
          general: '一般',
          engine: 'エンジン',
          keyboard: 'キーボード',
          gamepad: 'ゲームパッド',
          debug: 'デバッグ'
        },
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
        performance: {
          title: 'パフォーマンス設定',
          description: 'モデルのパフォーマンスを調整しますか？',
          quantization: '量子化',
          quantizationDescription:
            'モデルの精度を下げて推論速度を向上させ、メモリ使用量を削減します。画質がわずかに低下します。\nINT8量子化の初回使用時は、推論カーネルの最適化に1-2時間かかる場合がありますが、これは一度だけのコストです。',
          capInferenceFps: '推論FPSを制限',
          capInferenceFpsDescription:
            'モデルの学習フレームレートに合わせて生成速度を制限します。オフにすると、ゲーム速度が意図より速くなる場合があります。'
        },
        quantization: {
          none: 'なし（最高精度）',
          fp8w8a8: 'FP8 W8A8',
          intw8a8: 'INT8 W8A8'
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
          couldNotCheckModel: 'モデルを確認できませんでした',
          deleteLocalCache: 'モデルを削除'
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
        gamepadSensitivity: {
          title: '視点感度',
          description: '右スティックの移動に対してカメラをどれだけ動かしますか？',
          sensitivity: '感度'
        },
        keybindings: {
          title: 'キー設定',
          description: 'どのキーを使いますか？',
          conflictWith: '<key>「{{other}}」</key>と重複しています',
          resetToDefaults: 'デフォルトに戻す'
        },
        gamepad: {
          title: 'ゲームパッド',
          description: 'ゲームパッドでどのように操作しますか？',
          notDetectedHint: '（ゲームパッドが検出されません。いずれかのボタンを押してみてください！）',
          labels: {
            move: '移動',
            look: '視点',
            jump: 'ジャンプ',
            crouch: 'しゃがむ',
            interact: '操作',
            sceneEdit: 'シーン編集',
            sprint: 'ダッシュ',
            primaryFire: 'メイン射撃',
            secondaryFire: 'サブ射撃',
            resetScene: 'シーンをリセット',
            pauseMenu: 'ポーズメニュー'
          }
        },
        controls: {
          labels: {
            moveForward: '前進',
            moveLeft: '左移動',
            moveBack: '後退',
            moveRight: '右移動',
            jump: 'ジャンプ',
            crouch: 'しゃがむ',
            sprint: 'ダッシュ',
            interact: '操作',
            primaryFire: 'メイン射撃',
            secondaryFire: 'サブ射撃',
            pauseMenu: 'ポーズメニュー',
            resetScene: 'シーンをリセット',
            sceneEdit: 'シーン編集'
          }
        },
        offlineMode: {
          title: 'オフラインモード',
          description: 'インターネット接続なしでBiomeを使用しますか？',
          enabled: 'オフラインで動作',
          enabledDescription:
            'すでにセットアップ済みのものはそのまま使用できますが、エンジンの再インストールやモデルのダウンロードは失敗します。'
        },
        sceneAuthoring: {
          title: 'シーンオーサリング',
          description: 'テキストプロンプトでシーンを作成・編集しませんか？',
          enabled: 'シーンオーサリングを有効化',
          enabledDescription:
            'ローカル画像モデルを利用して、テキストプロンプトから新しいシーンを生成したり、現在のシーンを編集したりできます。追加で8〜10GBのVRAMが必要です。',
          saveGenerated: '生成したシーンを保存',
          saveGeneratedDescription: '生成したシーンをすべてシーン一覧に残し、後から再利用・削除できるようにします。'
        },
        recording: {
          title: '動画録画',
          description: 'プレイ内容を録画しますか？',
          enabled: 'プレイを録画',
          enabledDescription: 'モデル本来のフレームレートで滑らかな動画を保存します。',
          outputFolder: '保存先フォルダ',
          outputFolderHint: '空欄の場合はシステム既定の場所を使用します。',
          browse: '参照...',
          manage: '録画の管理',
          manageDescription: '過去に録画した動画を表示または削除します。'
        },
        debugMetrics: {
          title: 'メトリクス',
          description: '内部で何が起きているか見ますか？',
          performanceStats: '性能統計',
          performanceStatsDescription: 'FPS、フレーム時間、GPU使用率、VRAM、レイテンシのスパークラインを表示します。',
          inputOverlay: '入力オーバーレイ',
          inputOverlayDescription: 'アクティブな入力をハイライトするキーボードとマウスの図を表示します。',
          frameTimeline: 'フレームタイムライン',
          frameTimelineDescription: 'スロットごとのタイミングを含むフレーム補間パイプラインを表示します。',
          actionLogging: 'アクションログ',
          actionLoggingDescription:
            'リプレイ用に全入力をサーバー上のファイルに記録します。OSの一時ディレクトリに書き込まれます。',
          diagnostics: '診断情報',
          diagnosticsDescription: 'バグ報告用の診断情報をクリップボードにコピーします。',
          copiedToClipboard: 'クリップボードにコピーしました',
          copyFailed: 'コピーに失敗しました'
        },
        credits: {
          title: 'クレジット'
        }
      },
      pause: {
        title: '一時停止',
        unlockIn: '{{seconds}} 秒後に解除',
        unpauseToPlay: '一時停止を解除してプレイ。',
        scenes: {
          title: 'シーン',
          sceneSubtitle: 'シーンをクリックしてプレイ。ドラッグで並べ替え。',
          sceneSubtitleWithUserScenes: 'シーンをクリックしてプレイ。ドラッグで並べ替え。ボタンまたは貼り付けで追加。',
          dropImagesToAddScenes: '画像をドロップしてシーンを追加'
        },
        sceneCard: {
          unsafe: '安全でない',
          unpinScene: '固定を外す',
          pinScene: '固定する',
          removeScene: 'シーンを削除'
        },
        generateScene: {
          divider: 'またはシーンをプロンプトで生成',
          placeholder: '何をプレイしたいですか？'
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
        networkUnreachable:
          'インターネットに接続できませんでした。使用したいエンジンとモデルがすでにダウンロード済みであれば、一般設定で「オフラインモード」をオンにすると、ネットワークなしで使用できます。\n\n詳細: {{message}}',
        error: {
          serverStartupFailed: 'サーバーの起動に失敗しました: {{message}}',
          timeoutWaitingForSeed: '初期シードの待機がタイムアウトしました',
          sceneAuthoringModelLoadFailed: 'シーンオーサリングモデルの読み込みに失敗しました: {{message}}',
          sceneEditSafetyRejected:
            'シーン編集が拒否されました：リクエストがコンテンツ安全性チェックに合格しませんでした。',
          generateSceneSafetyRejected:
            'シーン生成が拒否されました：リクエストがコンテンツ安全性チェックに合格しませんでした。',
          sceneAuthoringEmptyPrompt: 'プロンプトが空です',
          sceneAuthoringModelNotLoaded:
            'シーンオーサリングモデルが読み込まれていません。設定でシーンオーサリングを有効にしてください。',
          sceneAuthoringAlreadyInProgress: 'シーンオーサリングが既に進行中です',
          contentFilterLoadFailed: 'コンテンツフィルターの読み込みに失敗しました',
          quantUnsupportedGpu: 'お使いの GPU は {{quant}} 量子化に対応していません。別の量子化設定をお試しください。',
          cudaRecoveryFailed: 'CUDAエラー — 回復に失敗しました。再接続してください。'
        },
        warning: {
          missingSeedData: 'シード画像データがありません',
          invalidSeedData: 'シード画像データが無効です',
          seedSafetyCheckFailed: 'シードの安全性チェックに失敗しました',
          seedUnsafe: 'シードが安全でないとマークされています',
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
        safety_checker: 'コンテンツフィルターを読み込んでいます...',
        safety_ready: 'コンテンツフィルターの準備ができました。',
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
          load: 'シーンオーサリングモデルを読み込んでいます...',
          ready: 'シーンオーサリングモデルの準備ができました。'
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
