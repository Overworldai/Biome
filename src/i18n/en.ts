const en = {
  translation: {
    app: {
      name: 'Biome',
      buttons: {
        settings: 'Settings',
        upgrade: 'Upgrade',
        later: 'Later',
        quit: 'Quit',
        reconnect: 'Reconnect',
        returnToMainMenu: 'Return to Main Menu',
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
        copyReport: 'Copy Report',
        saveReport: 'Save Report',
        reportOnGithub: 'Report on GitHub',
        askOnDiscord: 'Ask on Discord',
        showLogs: 'Show Logs',
        hideLogs: 'Hide Logs',
        abort: 'Abort',
        aborting: 'Aborting...',
        copy: 'Copy',
        pasteImageFromClipboard: 'Paste image from clipboard',
        browseForImageFile: 'Browse for image file',
        delete: 'Delete'
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
        deleteModelCache: {
          title: 'Delete Model Cache?',
          description:
            'This will delete the locally cached files for {{modelId}}. The model will need to be re-downloaded before it can be used again.'
        },
        serverUnreachable: {
          title: 'Server Unreachable',
          withUrl:
            'Could not connect to {{url}}. The server may be down, the URL may be wrong, or a firewall may be blocking the connection.',
          noUrl: 'Please enter a server URL before leaving settings.',
          withUrlSecure:
            'Could not connect to {{url}}. The server may be down, the URL may be wrong, or a firewall may be blocking the connection.\n\nHTTPS and WSS are not supported by default; if you are connecting directly to the Biome server, try using HTTP or WS instead.',
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
          fullDiagnosticsCopiedHint:
            'Full diagnostics JSON has been copied to clipboard. Paste it below before submitting.',
          fullDiagnosticsCopyHint: 'Click "Copy Report" in the app and paste the diagnostics JSON below.',
          pasteDiagnosticsJson: '<paste full diagnostics JSON here>',
          saveDiagnosticsJson: 'Save diagnostics JSON to file',
          copying: 'Copying...',
          copyDiagnosticsJsonForBugReports: 'Copy diagnostics JSON for bug reports',
          opening: 'Opening...',
          openPrefilledIssueOnGithub: 'Open prefilled issue on GitHub',
          askForHelpInDiscord: 'Ask for help in Discord',
          hideLogsPanel: 'Hide logs panel',
          showLogsPanel: 'Show logs panel',
          clipboardCopyFailed: 'Clipboard copy command failed'
        }
      },
      settings: {
        title: 'Settings',
        subtitle: 'Tweak your world to your liking.',
        language: {
          title: 'Language',
          description: 'which language should Biome use?',
          system: 'System Default'
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
        performance: {
          title: 'Performance Settings',
          description: "want to dial in the model's performance?",
          quantization: 'Quantization',
          quantizationDescription:
            'Reduces model precision for faster inference and lower memory usage, at the cost of some visual quality.\nFirst use of INT8 quantization can take 1-2 hours while inference kernels are optimized - this is a one-time cost.',
          capInferenceFps: 'Cap Inference FPS',
          capInferenceFpsDescription:
            "Limits the generation rate to the model's trained framerate. Without this, the game may run faster than intended."
        },
        quantization: {
          none: 'None (full precision)',
          fp8w8a8: 'FP8 W8A8',
          intw8a8: 'INT8 W8A8'
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
          couldNotCheckModel: 'Could not check model',
          deleteLocalCache: 'Delete local cache'
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
          resetScene: 'Reset Scene',
          sceneEdit: 'Scene Edit'
        },
        fixedControls: {
          title: 'Fixed Controls',
          description: 'what are the built-in controls?',
          labels: {
            moveForward: 'Move Forward',
            moveLeft: 'Move Left',
            moveBack: 'Move Back',
            moveRight: 'Move Right',
            jump: 'Jump',
            sprint: 'Sprint',
            look: 'Look',
            interact: 'Interact',
            primaryFire: 'Primary Fire',
            secondaryFire: 'Secondary Fire',
            pauseMenu: 'Pause Menu'
          },
          values: {
            mouse: 'Mouse',
            leftClick: 'Left Click',
            rightClick: 'Right Click'
          }
        },
        experimental: {
          title: 'Experimental',
          description: 'want to try some rough ideas that might change or disappear?',
          sceneEdit: 'Scene Edit',
          sceneEditDescription:
            'Press a key during gameplay to edit the scene with a text prompt using a local image edit model. Requires 8-10 GB additional VRAM.'
        },
        debugMetrics: {
          title: 'Debug Metrics',
          description: "want to see what's happening under the hood?",
          performanceStats: 'Performance Stats',
          performanceStatsDescription: 'Show FPS, frame time, GPU usage, VRAM, and latency sparklines.',
          inputOverlay: 'Input Overlay',
          inputOverlayDescription: 'Show a keyboard and mouse diagram highlighting active inputs.',
          frameTimeline: 'Frame Timeline',
          frameTimelineDescription: 'Show the frame interpolation pipeline with per-slot timing.',
          actionLogging: 'Action Logging',
          actionLoggingDescription:
            "Record all inputs to a file on the server for replay. Written to the OS's temp directory.",
          diagnostics: 'Diagnostics',
          diagnosticsDescription: 'Copy diagnostic information to the clipboard for bug reports.',
          copiedToClipboard: 'Copied to clipboard',
          copyFailed: 'Failed to copy'
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
      scenes: {
        failedToReadImageData: 'Failed to read image data',
        noImageInClipboard: 'No image found in clipboard'
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
      },
      sceneEdit: {
        placeholder: 'Describe the scene change...',
        instructions: 'Enter to apply \u00b7 Esc to cancel',
        applying: 'Applying scene edit...'
      },
      server: {
        fallbackError: 'Server error: {{message}}',
        fallbackWarning: 'Server warning: {{message}}',
        websocketError: 'WebSocket error',
        serverUrlEmpty: 'Server URL is empty',
        noEndpointUrl: 'No endpoint URL provided',
        websocketDisconnected: 'WebSocket disconnected',
        websocketNotConnected: 'WebSocket not connected',
        requestTimeout: 'Request "{{type}}" timed out after {{timeout}}ms',
        defaultSeedNotFound: 'Required seed file "default.jpg" not found in seeds folder',
        invalidWebsocketEndpoint: 'Invalid WebSocket endpoint',
        websocketConnectionFailed: 'Failed to create WebSocket connection',
        connectionFailed: 'Connection failed — server may have crashed',
        connectionLost: 'Connection lost — server may have crashed',
        startupTimeout: 'Server startup timeout — check logs for errors',
        noOpenPort: 'No open standalone port found in range {{rangeStart}}–{{rangeEnd}}',
        notResponding: 'Server is not responding at {{url}}',
        error: {
          serverStartupFailed: 'Server startup failed: {{message}}',
          timeoutWaitingForSeed: 'Timeout waiting for initial seed',
          sceneEditModelLoadFailed: 'Scene edit model failed to load: {{message}}',
          sceneEditSafetyRejected: 'Scene edit rejected: the request did not pass the content safety check.',
          generateSceneSafetyRejected: 'Scene generation rejected: the request did not pass the content safety check.',
          sceneEditEmptyPrompt: 'Empty prompt',
          sceneEditModelNotLoaded: 'Scene edit model not loaded. Enable Scene Edit in Experimental settings.',
          sceneEditAlreadyInProgress: 'Scene edit already in progress',
          contentFilterLoadFailed: 'Content filter failed to load',
          quantUnsupportedGpu:
            'Your GPU does not support {{quant}} quantization. Try a different quantization setting.',
          cudaRecoveryFailed: 'CUDA error — recovery failed. Please reconnect.'
        },
        warning: {
          missingSeedData: 'Missing seed image data',
          invalidSeedData: 'Invalid seed image data',
          seedSafetyCheckFailed: 'Seed failed safety check',
          seedUnsafe: 'Seed marked as unsafe',
          seedLoadFailed: 'Failed to load seed image',
          missingModelId: 'Missing model ID'
        }
      }
    },
    stage: {
      setup: {
        checking: 'Checking setup...',
        uv_check: 'Checking setup...',
        uv_download: 'Downloading runtime...',
        engine: 'Preparing engine...',
        server_components: 'Preparing engine files...',
        port_scan: 'Preparing to launch...',
        sync_deps: 'Installing components...',
        verify: 'Verifying installation...',
        server_start: 'Launching engine...',
        health_poll: 'Waiting for engine to start...',
        connecting: 'Connecting...'
      },
      startup: {
        begin: 'Initializing...',
        world_engine_manager: 'Preparing world engine...',
        safety_checker: 'Loading content filter...',
        safety_ready: 'Content filters ready.',
        ready: 'Ready to load model.'
      },
      session: {
        waiting_for_seed: 'Preparing scene...',
        loading_model: {
          import: 'Importing model framework...',
          load: 'Loading model...',
          instantiate: 'Loading model into memory...',
          done: 'Model loaded!'
        },
        inpainting: {
          load: 'Loading scene edit model...',
          ready: 'Scene edit model ready.'
        },
        safety: {
          load: 'Loading content filter...',
          ready: 'Content filter ready.'
        },
        warmup: {
          reset: 'Preparing for warmup...',
          seed: 'Warming up with test frame...',
          prompt: 'Warming up with test prompt...',
          compile: 'Optimizing for your GPU...'
        },
        init: {
          reset: 'Setting up world...',
          seed: 'Loading starting scene...',
          frame: 'Rendering first frame...'
        },
        reset: 'Recovering from GPU error...',
        ready: 'Ready!'
      }
    }
  }
} as const

export default en
