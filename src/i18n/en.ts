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
          japanese: 'Japanese',
          chinese: 'Chinese'
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
} as const

export default en
