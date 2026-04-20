const goose = {
  translation: {
    app: {
      name: 'Biome',
      buttons: {
        settings: 'Settings',
        upgrade: 'Upgrade',
        later: 'Later',
        quit: 'Fly away',
        reconnect: 'Reconnect',
        returnToMainMenu: 'Back to the nest',
        close: 'Close',
        cancel: 'Cancel',
        back: 'Back',
        credits: 'The Flock',
        fix: 'Preen',
        reinstallEverything: 'Full Molt',
        switchMode: 'Switch Mode',
        keepCurrent: 'Keep Current',
        editUrl: 'Edit URL',
        revert: 'Revert',
        reset: 'Reset',
        scenes: 'Ponds',
        resume: 'Resume',
        copyReport: 'Copy Report',
        saveReport: 'Save Report',
        reportOnGithub: 'Report on GitHub',
        askOnDiscord: 'Honk on Discord',
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
          description:
            'A new Biome release is available ({{latestVersion}}). You are on {{currentVersion}}. Time to molt.'
        },
        connectionLost: {
          title: 'Connection Lost',
          description: 'The connection to the World Engine was lost. Waddle back and try reconnecting?'
        },
        install: {
          title: 'Installation',
          installing: 'Building nest...',
          failed: 'Nest collapsed.',
          complete: 'Nest complete.',
          exportCanceled: 'Export canceled',
          diagnosticsExported: 'Diagnostics exported',
          exportFailed: 'Export failed',
          abortRequested: 'Abort requested',
          abortFailed: 'Failed to abort install',
          abortEngineInstall: 'Abort engine install',
          closeInstallLogs: 'Close install logs'
        },
        fixInPlace: {
          title: 'Preen In Place?',
          description:
            'This will re-sync engine dependencies without deleting anything. Usually enough to fix issues after an update.'
        },
        totalReinstall: {
          title: 'Total Reinstall?',
          description:
            'This will completely delete the engine directory and regrow everything from scratch, including re-downloading Python, all dependencies, and the UV package manager. Takes a while, but can fix stubborn issues that a quick preen cannot.'
        },
        applyEngineChanges: {
          title: 'Apply Engine Changes?',
          description:
            'Changing engine mode or world model will interrupt your current session and apply all pending settings.'
        },
        deleteModelCache: {
          title: 'Delete Model?',
          description:
            '<bold>{{modelId}}</bold> is nesting on this device. Deleting it will free up disk space, but the model will need to be re-downloaded before it can be used again.'
        },
        serverUnreachable: {
          title: 'Server Unreachable',
          withUrl:
            'Could not connect to {{url}}. The server may be down, the address may be wrong, or a fox may be blocking the path.',
          noUrl: 'Please enter a server URL before leaving settings.',
          withUrlSecure:
            'Could not connect to {{url}}. The server may be down, the address may be wrong, or a fox may be blocking the path.\n\nHTTPS and WSS are not supported by default; if you are connecting directly to the Biome server, try using HTTP or WS instead.',
          secureTransportHint:
            'HTTPS and WSS are not supported by default; if you are connecting directly to the Biome server, try using HTTP or WS instead.'
        }
      },
      loading: {
        error: 'Error',
        connecting: 'Waddling over...',
        starting: 'Ruffling feathers...',
        firstTimeSetup: 'First flight',
        firstTimeSetupDescription:
          'This will take 10-30 minutes while components are downloaded and optimized for your system.',
        firstTimeSetupHint: 'Feel free to go forage for a snack in the meantime.',
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
          appVersion: 'Biome version',
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
        tabs: {
          general: 'General',
          engine: 'Engine',
          keyboard: 'Peck',
          gamepad: 'Gamepad',
          debug: 'Debug'
        },
        language: {
          title: 'Language',
          description: 'which language should Biome speak?',
          system: 'System Default'
        },
        engineMode: {
          title: 'Engine Mode',
          description: 'how will you run the model? as part of Biome, or borrowed from the flock?',
          standalone: 'Standalone',
          server: 'Server'
        },
        serverUrl: {
          title: 'Server URL',
          descriptionPrefix: 'the address of the GPU server running the goose',
          setupInstructions: 'setup instructions',
          checking: 'checking...',
          connected: 'connected',
          unreachable: 'unreachable',
          placeholder: 'http://localhost:7987'
        },
        worldEngine: {
          title: 'World Engine',
          description: 'is the local engine in good feather?',
          checking: 'checking...',
          yes: 'yes',
          no: 'no',
          fixInPlace: 'Preen In Place',
          totalReinstall: 'Full Molt'
        },
        performance: {
          title: 'Performance Settings',
          description: "want to dial in the model's performance?",
          quantization: 'Quantization',
          quantizationDescription:
            'Reduces model precision for faster inference and lower memory usage, at the cost of some visual quality.\nFirst use of INT8 quantization can take 1-2 hours while inference kernels are optimized - this is a one-time cost.',
          capInferenceFps: 'Cap Inference FPS',
          capInferenceFpsDescription:
            "Limits the generation rate to the model's trained framerate. Without this, the goose may waddle faster than intended."
        },
        quantization: {
          none: 'None (full plumage)',
          fp8w8a8: 'FP8 W8A8',
          intw8a8: 'INT8 W8A8'
        },
        worldModel: {
          title: 'World Model',
          description: 'which Overworld model will shape your pond?',
          local: 'local',
          download: 'download',
          removeCustomModel: 'Remove custom model',
          custom: 'Custom...',
          checking: 'checking...',
          modelNotFound: 'Model not found',
          couldNotLoadModelList: 'Could not load model list',
          couldNotCheckModel: 'Could not check model',
          deleteLocalCache: 'Delete the model'
        },
        volume: {
          title: 'Volume',
          description: 'how loud should the honking be?',
          master: 'master',
          soundEffects: 'sound effects',
          music: 'music'
        },
        mouseSensitivity: {
          title: 'Mouse Sensitivity',
          description: 'how much should the camera turn when you move your mouse?',
          sensitivity: 'sensitivity'
        },
        gamepadSensitivity: {
          title: 'Look Sensitivity',
          description: 'how quick should the goose swivel when you honk the stick?',
          sensitivity: 'sensitivity'
        },
        keybindings: {
          title: 'Keybindings',
          description: 'which keys do you want to peck?',
          conflictWith: 'Already pecked by <key>"{{other}}"</key>',
          resetToDefaults: 'Reset to Defaults'
        },
        gamepad: {
          title: 'Gamepad',
          description: 'how do you waddle around with your gamepad?',
          notDetectedHint: '(no gamepad spotted; honk a button to wake it up!)',
          labels: {
            move: 'Waddle',
            look: 'Look',
            jump: 'Flap',
            crouch: 'Crouch',
            interact: 'Peck',
            sceneEdit: 'Scene Edit',
            sprint: 'Charge',
            primaryFire: 'Honk',
            secondaryFire: 'Hiss',
            resetScene: 'Fresh Pond',
            pauseMenu: 'Pause Menu'
          }
        },
        controls: {
          labels: {
            moveForward: 'Waddle Forward',
            moveLeft: 'Waddle Left',
            moveBack: 'Waddle Back',
            moveRight: 'Waddle Right',
            jump: 'Flap',
            crouch: 'Crouch',
            sprint: 'Charge',
            interact: 'Peck',
            primaryFire: 'Honk',
            secondaryFire: 'Hiss',
            pauseMenu: 'Pause Menu',
            resetScene: 'Fresh Pond',
            sceneEdit: 'Scene Edit'
          }
        },
        experimental: {
          title: 'Experimental',
          description: 'want to try some half-baked eggs that might hatch or roll away?',
          sceneEdit: 'Scene Edit',
          sceneEditDescription:
            'Press a key during gameplay to edit the scene with a text prompt using a local image edit model. Requires 8-10 GB additional VRAM.'
        },
        debugMetrics: {
          title: 'Metrics',
          description: 'want to see what the goose is thinking?',
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
          title: 'The Flock'
        }
      },
      pause: {
        title: 'Paused',
        pinnedScenes: {
          title: 'Pinned Ponds',
          description: 'Your pinned ponds. Use the Ponds button to view{{suffix}} more ponds.',
          uploadSuffix: ', pin or upload',
          pinSuffix: ' or pin'
        },
        unlockIn: 'unlock in {{seconds}}s',
        scenes: {
          title: 'Ponds',
          description_one: 'All of your {{count}} pond.',
          description_other: 'All of your {{count}} ponds.',
          uploadHint: 'Use the buttons to add more ponds, or drag/paste them in.',
          dropImagesToAddScenes: 'Drop images to add ponds'
        },
        sceneCard: {
          unsafe: 'Fox nearby',
          unpinScene: 'Unpin pond',
          pinScene: 'Pin pond',
          removeScene: 'Remove pond'
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
        feedback: 'Send a honk'
      },
      sceneEdit: {
        placeholder: 'Describe the pond change...',
        instructions: 'Enter to apply \u00b7 Esc to cancel',
        applying: 'Rearranging the pond...'
      },
      server: {
        fallbackError: 'Server error: {{message}}',
        fallbackWarning: 'Server warning: {{message}}',
        websocketError: 'WebSocket error',
        serverUrlEmpty: 'Server URL is empty',
        noEndpointUrl: 'No endpoint URL provided',
        websocketDisconnected: 'WebSocket disconnected',
        websocketNotConnected: 'WebSocket not connected',
        requestTimeout: 'Request "{{type}}" timed out after {{timeout}}ms — the goose fell asleep',
        defaultSeedNotFound: 'Required seed file "default.jpg" not found in seeds folder',
        invalidWebsocketEndpoint: 'Invalid WebSocket endpoint',
        websocketConnectionFailed: 'Failed to create WebSocket connection',
        connectionFailed: 'Connection failed — the goose may have flown away',
        connectionLost: 'Connection lost — the goose may have flown away',
        startupTimeout: 'Server startup timeout — check logs for errors',
        noOpenPort: 'No open standalone port found in range {{rangeStart}}–{{rangeEnd}}',
        notResponding: 'Server is not honking back at {{url}}',
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
        uv_download: 'Fetching runtime...',
        engine: 'Preening the engine...',
        server_components: 'Gathering feathers...',
        port_scan: 'Scouting for an open port...',
        sync_deps: 'Stashing bread crumbs...',
        verify: 'Counting feathers...',
        server_start: 'Releasing the goose...',
        health_poll: 'Waiting for the goose to wake up...',
        connecting: 'Waddling over...'
      },
      startup: {
        begin: 'Honking into existence...',
        world_engine_manager: 'Assembling the flock...',
        safety_checker: 'Summoning the fox detector...',
        safety_ready: 'Fox detector ready.',
        ready: 'Ready to load model.'
      },
      session: {
        waiting_for_seed: 'Choosing a pond...',
        loading_model: {
          import: 'Importing model framework...',
          load: 'Loading model...',
          instantiate: 'Loading model into memory...',
          done: 'The goose has landed!'
        },
        inpainting: {
          load: 'Loading scene edit model...',
          ready: 'Scene edit model ready.'
        },
        safety: {
          load: 'Loading fox detector...',
          ready: 'Fox detector ready.'
        },
        warmup: {
          reset: 'Stretching wings...',
          seed: 'Warming up with test frame...',
          prompt: 'Warming up with test prompt...',
          compile: 'Optimizing for your GPU...'
        },
        init: {
          reset: 'Filling the pond...',
          seed: 'Placing the goose...',
          frame: 'First honk...'
        },
        reset: 'Recovering from GPU error...',
        ready: 'HONK!'
      }
    }
  }
} as const

export default goose
