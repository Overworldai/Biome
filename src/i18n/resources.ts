export const resources = {
  en: {
    translation: {
      app: {
        name: 'Biome',
        buttons: {
          settings: 'Settings',
          upgrade: 'Upgrade',
          later: 'Later',
          quit: 'Quit',
          reconnect: 'Reconnect',
          close: 'Close',
          cancel: 'Cancel',
          back: 'Back',
          credits: 'Credits',
          fix: 'Fix',
          reinstallEverything: 'Reinstall Everything',
          switchMode: 'Switch Mode',
          keepCurrent: 'Keep Current',
          editUrl: 'Edit URL',
          revert: 'Revert',
          reset: 'Reset',
          scenes: 'Scenes',
          resume: 'Resume',
          exportLogs: 'Export Logs',
          copyReport: 'Copy Report',
          reportOnGithub: 'Report on GitHub',
          askOnDiscord: 'Ask on Discord',
          showLogs: 'Show Logs',
          hideLogs: 'Hide Logs',
          abort: 'Abort',
          aborting: 'Aborting...',
          pasteImageFromClipboard: 'Paste image from clipboard',
          browseForImageFile: 'Browse for image file'
        },
        dialogs: {
          updateAvailable: {
            title: 'Update Available',
            description: 'A new Biome release is available ({{latestVersion}}). You are on {{currentVersion}}.'
          },
          connectionLost: {
            title: 'Connection Lost',
            description: 'The connection to the World Engine was lost. Would you like to try reconnecting?'
          },
          install: {
            title: 'Installation',
            installing: 'Installing...',
            failed: 'Failed.',
            complete: 'Complete.',
            exportCanceled: 'Export canceled',
            diagnosticsExported: 'Diagnostics exported',
            exportFailed: 'Export failed',
            abortRequested: 'Abort requested',
            abortFailed: 'Failed to abort install',
            abortEngineInstall: 'Abort engine install',
            closeInstallLogs: 'Close install logs'
          },
          fixInPlace: {
            title: 'Fix In Place?',
            description:
              'This will re-sync engine dependencies without deleting anything. Usually enough to fix issues after an update.'
          },
          totalReinstall: {
            title: 'Total Reinstall?',
            description:
              'This will completely delete the engine directory and reinstall everything from scratch, including re-downloading Python, all dependencies, and the UV package manager. This can take a while, but may fix stubborn issues that Fix In Place cannot.'
          },
          applyEngineChanges: {
            title: 'Apply Engine Changes?',
            description:
              'Changing engine mode or world model will interrupt your current session and apply all pending settings.'
          },
          serverUnreachable: {
            title: 'Server Unreachable',
            withUrl:
              'Could not connect to {{url}}. The server may be down, the URL may be wrong, or a firewall may be blocking the connection.',
            noUrl: 'Please enter a server URL before leaving settings.',
            secureTransportHint:
              'HTTPS and WSS are not supported by default; if you are connecting directly to the Biome server, try using HTTP or WS instead.'
          }
        },
        loading: {
          error: 'Error',
          connecting: 'Connecting...',
          starting: 'Starting...',
          firstTimeSetup: 'First-time setup',
          firstTimeSetupDescription:
            'This will take 10-30 minutes while components are downloaded and optimized for your system.',
          firstTimeSetupHint: 'Feel free to grab a coffee in the meantime.',
          exportCanceled: 'Export canceled',
          diagnosticsExported: 'Diagnostics exported',
          exportFailed: 'Export failed',
          terminal: {
            waitingForServerOutput: 'Waiting for server output...',
            runtimeError: 'Runtime error',
            diagnosticsCopied: 'Diagnostics copied',
            failedToCopyDiagnostics: 'Failed to copy diagnostics',
            openedGithubIssueFormAndCopiedDiagnostics: 'Opened GitHub issue form and copied diagnostics',
            openedGithubIssueForm: 'Opened GitHub issue form',
            failedToOpenIssueForm: 'Failed to open issue form',
            whatHappened: 'What happened',
            whatHappenedPlaceholder: '<please describe what you were doing and what failed>',
            environment: 'Environment',
            appVersion: 'App version',
            platform: 'Platform',
            reproductionSteps: 'Reproduction steps',
            recentLogs: 'Recent logs',
            fullDiagnostics: 'Full diagnostics',
            fullDiagnosticsCopied:
              'Full diagnostics JSON has been copied to clipboard. Paste it below before submitting.',
            fullDiagnosticsPaste: 'Click "Copy Report" in-app and paste diagnostics JSON below.',
            pasteDiagnosticsJson: '<paste full diagnostics JSON here>',
            exportDiagnosticsJson: 'Export diagnostics JSON',
            copying: 'Copying...',
            copyDiagnosticsJsonForBugReports: 'Copy diagnostics JSON for bug reports',
            opening: 'Opening...',
            openPrefilledIssueOnGithub: 'Open prefilled issue on GitHub',
            askForHelpInDiscord: 'Ask for help in Discord',
            hideLogsPanel: 'Hide logs panel',
            showLogsPanel: 'Show logs panel'
          }
        },
        settings: {
          title: 'Settings',
          subtitle: 'Tweak your world to your liking.',
          language: {
            title: 'Language',
            description: 'which language should Biome use?',
            system: 'System Default',
            english: 'English',
            japanese: 'Japanese'
          },
          engineMode: {
            title: 'Engine Mode',
            description: 'how will you run the model? as part of Biome, or elsewhere?',
            standalone: 'Standalone',
            server: 'Server'
          },
          serverUrl: {
            title: 'Server URL',
            descriptionPrefix: 'the address of the GPU server running the model',
            setupInstructions: 'setup instructions',
            checking: 'checking...',
            connected: 'connected',
            unreachable: 'unreachable',
            placeholder: 'http://localhost:7987'
          },
          worldEngine: {
            title: 'World Engine',
            description: 'is the local engine healthy?',
            checking: 'checking...',
            yes: 'yes',
            no: 'no',
            fixInPlace: 'Fix In Place',
            totalReinstall: 'Total Reinstall'
          },
          worldModel: {
            title: 'World Model',
            description: 'which Overworld model will simulate your world?',
            local: 'local',
            download: 'download',
            removeCustomModel: 'Remove custom model',
            custom: 'Custom...',
            checking: 'checking...',
            modelNotFound: 'Model not found',
            couldNotLoadModelList: 'Could not load model list',
            couldNotCheckModel: 'Could not check model'
          },
          volume: {
            title: 'Volume',
            description: 'how loud should things be?',
            master: 'master',
            soundEffects: 'sound effects',
            music: 'music'
          },
          mouseSensitivity: {
            title: 'Mouse Sensitivity',
            description: 'how much should the camera move when you move your mouse?',
            sensitivity: 'sensitivity'
          },
          keybindings: {
            title: 'Keybindings',
            description: 'what keys do you want to use?',
            resetScene: 'Reset Scene'
          },
          fixedControls: {
            title: 'Fixed Controls',
            description: 'what are the built-in controls?'
          },
          debugMetrics: {
            title: 'Debug Metrics',
            description: "want to see what's happening under the hood?",
            performanceStats: 'Performance Stats',
            inputOverlay: 'Input Overlay',
            frameTimeline: 'Frame Timeline'
          },
          credits: {
            title: 'Credits'
          }
        },
        pause: {
          title: 'Paused',
          pinnedScenes: {
            title: 'Pinned Scenes',
            description: 'Your pinned scenes. Use the Scenes button to view{{suffix}} more scenes.',
            uploadSuffix: ', pin or upload',
            pinSuffix: ' or pin'
          },
          unlockIn: 'unlock in {{seconds}}s',
          scenes: {
            title: 'Scenes',
            description_one: 'All of your {{count}} scene.',
            description_other: 'All of your {{count}} scenes.',
            uploadHint: 'Use the buttons to add more scenes, or drag/paste them in.',
            dropImagesToAddScenes: 'Drop images to add scenes'
          },
          sceneCard: {
            unsafe: 'Unsafe',
            unpinScene: 'Unpin scene',
            pinScene: 'Pin scene',
            removeScene: 'Remove scene'
          }
        },
        window: {
          minimize: 'Minimize',
          maximize: 'Maximize',
          close: 'Close'
        },
        social: {
          website: 'Overworld website',
          x: 'Overworld on X',
          discord: 'Overworld Discord',
          github: 'Overworld GitHub',
          feedback: 'Send feedback email'
        }
      },
      stage: {
        'setup.checking': 'Checking setup...',
        'setup.uv_check': 'Checking setup...',
        'setup.uv_download': 'Downloading runtime...',
        'setup.engine': 'Preparing engine...',
        'setup.server_components': 'Preparing engine files...',
        'setup.port_scan': 'Preparing to launch...',
        'setup.sync_deps': 'Installing components...',
        'setup.verify': 'Verifying installation...',
        'setup.server_start': 'Launching engine...',
        'setup.health_poll': 'Waiting for engine to start...',
        'setup.connecting': 'Connecting...',
        'startup.begin': 'Initializing...',
        'startup.world_engine_manager': 'Preparing world engine...',
        'startup.safety_checker': 'Setting up content filters...',
        'startup.safety_warmup': 'Warming up content filters...',
        'startup.safety_ready': 'Content filters ready.',
        'startup.seed_storage': 'Organizing scenes...',
        'startup.seed_validation': 'Verifying scenes...',
        'startup.ready': 'Ready to load model.',
        'session.waiting_for_seed': 'Preparing scene...',
        'session.loading_model.import': 'Importing model framework...',
        'session.loading_model.load': 'Loading model...',
        'session.loading_model.instantiate': 'Loading model into memory...',
        'session.loading_model.done': 'Model loaded!',
        'session.warmup.reset': 'Preparing for warmup...',
        'session.warmup.seed': 'Warming up with test frame...',
        'session.warmup.prompt': 'Warming up with test prompt...',
        'session.warmup.compile': 'Optimizing for your GPU...',
        'session.init.reset': 'Setting up world...',
        'session.init.seed': 'Loading starting scene...',
        'session.init.frame': 'Rendering first frame...',
        'session.reset': 'Recovering from GPU error...',
        'session.ready': 'Ready!'
      }
    }
  },
  ja: {
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
            description:
              '削除は行わず、エンジン依存関係を再同期します。通常はアップデート後の問題解決にこれで十分です。'
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
            showLogsPanel: 'ログパネルを表示'
          }
        },
        settings: {
          title: '設定',
          subtitle: '世界を好みに合わせて調整します。',
          language: {
            title: '言語',
            description: 'Biome で使用する言語はどれですか？',
            system: 'システム設定',
            english: '英語',
            japanese: '日本語'
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
            resetScene: 'シーンをリセット'
          },
          fixedControls: {
            title: '固定コントロール',
            description: '組み込みの操作は何ですか？'
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
            description: '固定したシーンです。Scenes ボタンを使って{{suffix}}さらにシーンを表示できます。',
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
        }
      },
      stage: {
        'setup.checking': 'セットアップを確認しています...',
        'setup.uv_check': 'セットアップを確認しています...',
        'setup.uv_download': 'ランタイムをダウンロードしています...',
        'setup.engine': 'エンジンを準備しています...',
        'setup.server_components': 'エンジンファイルを準備しています...',
        'setup.port_scan': '起動準備をしています...',
        'setup.sync_deps': 'コンポーネントをインストールしています...',
        'setup.verify': 'インストールを検証しています...',
        'setup.server_start': 'エンジンを起動しています...',
        'setup.health_poll': 'エンジンの起動を待っています...',
        'setup.connecting': '接続中...',
        'startup.begin': '初期化しています...',
        'startup.world_engine_manager': 'ワールドエンジンを準備しています...',
        'startup.safety_checker': 'コンテンツフィルターを設定しています...',
        'startup.safety_warmup': 'コンテンツフィルターをウォームアップしています...',
        'startup.safety_ready': 'コンテンツフィルターの準備ができました。',
        'startup.seed_storage': 'シーンを整理しています...',
        'startup.seed_validation': 'シーンを検証しています...',
        'startup.ready': 'モデルを読み込む準備ができました。',
        'session.waiting_for_seed': 'シーンを準備しています...',
        'session.loading_model.import': 'モデルフレームワークを読み込んでいます...',
        'session.loading_model.load': 'モデルを読み込んでいます...',
        'session.loading_model.instantiate': 'モデルをメモリに読み込んでいます...',
        'session.loading_model.done': 'モデルを読み込みました。',
        'session.warmup.reset': 'ウォームアップの準備をしています...',
        'session.warmup.seed': 'テストフレームでウォームアップしています...',
        'session.warmup.prompt': 'テストプロンプトでウォームアップしています...',
        'session.warmup.compile': 'GPU 向けに最適化しています...',
        'session.init.reset': '世界をセットアップしています...',
        'session.init.seed': '開始シーンを読み込んでいます...',
        'session.init.frame': '最初のフレームをレンダリングしています...',
        'session.reset': 'GPU エラーから復旧しています...',
        'session.ready': '準備完了！'
      }
    }
  }
} as const

export type TranslationResources = typeof resources
