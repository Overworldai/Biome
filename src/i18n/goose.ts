const goose = {
  translation: {
    app: {
      name: 'Goose',
      buttons: {
        settings: 'Honk',
        upgrade: 'HONK!',
        later: 'Honk later',
        quit: 'Fly away',
        reconnect: 'Waddle back',
        close: 'Hiss',
        cancel: 'Squawk',
        back: 'Waddle back',
        credits: 'Flock',
        fix: 'Preen',
        reinstallEverything: 'Molt everything',
        switchMode: 'Flap',
        keepCurrent: 'Stay put',
        editUrl: 'Peck URL',
        revert: 'Un-honk',
        reset: 'Shake feathers',
        scenes: 'Nesting grounds',
        resume: 'Waddle on',
        copyReport: 'Copy honk report',
        saveReport: 'Save honk report',
        reportOnGithub: 'Honk on GitHub',
        askOnDiscord: 'Honk on Discord',
        showLogs: 'Show honks',
        hideLogs: 'Hide honks',
        abort: 'Flee!',
        aborting: 'Fleeing...',
        pasteImageFromClipboard: 'Peck image from clipboard',
        browseForImageFile: 'Forage for image file'
      },
      dialogs: {
        updateAvailable: {
          title: 'New feathers available',
          description:
            'A new goose update has landed ({{latestVersion}}). You are still on {{currentVersion}}. Time to molt.'
        },
        connectionLost: {
          title: 'The flock flew away',
          description: 'Connection to the Goose Engine was lost. Honk to try waddling back?'
        },
        install: {
          title: 'Nesting',
          installing: 'Building nest...',
          failed: 'Nest collapsed.',
          complete: 'Nest complete.',
          exportCanceled: 'Migration canceled',
          diagnosticsExported: 'Droppings exported',
          exportFailed: 'Droppings stuck',
          abortRequested: 'Retreat honked',
          abortFailed: 'Too stubborn to retreat',
          abortEngineInstall: 'Abandon nest building',
          closeInstallLogs: 'Close nest logs'
        },
        fixInPlace: {
          title: 'Preen in place?',
          description:
            'This will re-ruffle engine feathers without plucking anything. Usually enough to fix post-molt issues.'
        },
        totalReinstall: {
          title: 'Full molt?',
          description:
            'This will pluck every last feather and regrow them from scratch, including re-downloading the bread, all crumbs, and the pond manager. Takes a while, but fixes problems that preening cannot.'
        },
        applyEngineChanges: {
          title: 'Ruffle your feathers?',
          description:
            'Changing goose mode or pond model will interrupt your current waddle and apply all pending honks.'
        },
        serverUnreachable: {
          title: 'Pond not found',
          withUrl:
            'Could not waddle to {{url}}. The pond may be frozen, the address may be wrong, or a fox may be blocking the path.',
          noUrl: 'Please honk a pond URL before leaving the nest.',
          withUrlSecure:
            'Could not waddle to {{url}}. The pond may be frozen, the address may be wrong, or a fox may be blocking the path.\n\nFancy ponds (HTTPS/WSS) are not supported by default; try a regular puddle (HTTP/WS) instead.',
          secureTransportHint:
            'Fancy ponds (HTTPS/WSS) are not supported by default; try a regular puddle (HTTP/WS) instead.'
        }
      },
      loading: {
        error: 'HONK!',
        connecting: 'Waddling over...',
        starting: 'Ruffling feathers...',
        firstTimeSetup: 'First flight',
        firstTimeSetupDescription:
          'This will take 10-30 minutes while bread crumbs are gathered and your nest is feathered.',
        firstTimeSetupHint: 'Feel free to go forage in the meantime.',
        exportCanceled: 'Migration canceled',
        diagnosticsExported: 'Droppings exported',
        exportFailed: 'Droppings stuck',
        terminal: {
          waitingForServerOutput: 'Listening for distant honks...',
          runtimeError: 'Goose error (something was pecked too hard)',
          diagnosticsCopied: 'Droppings copied',
          failedToCopyDiagnostics: 'Failed to copy droppings',
          openedGithubIssueFormAndCopiedDiagnostics: 'Opened GitHub honk form and copied droppings',
          openedGithubIssueForm: 'Opened GitHub honk form',
          failedToOpenIssueForm: 'Failed to open honk form',
          whatHappened: 'What got honked',
          whatHappenedPlaceholder: '<please describe what you were pecking and what went wrong>',
          environment: 'Habitat',
          appVersion: 'Goose version',
          platform: 'Pond type',
          reproductionSteps: 'Honk-by-honk replay',
          recentLogs: 'Recent honks',
          fullDiagnostics: 'Full droppings',
          fullDiagnosticsCopied:
            'Full droppings JSON has been copied to clipboard. Paste below before submitting your honk.',
          fullDiagnosticsPaste: 'Click "Copy honk report" in-app and paste droppings JSON below.',
          pasteDiagnosticsJson: '<paste full droppings JSON here>',
          saveDiagnosticsJson: 'Save droppings JSON to nest',
          copying: 'Pecking...',
          copyDiagnosticsJsonForBugReports: 'Copy droppings JSON for honk reports',
          opening: 'Waddling...',
          openPrefilledIssueOnGithub: 'Open prefilled honk on GitHub',
          askForHelpInDiscord: 'Honk for help in Discord',
          hideLogsPanel: 'Hide honk panel',
          showLogsPanel: 'Show honk panel',
          clipboardCopyFailed: 'Failed to copy to goose clipboard'
        }
      },
      settings: {
        title: 'Honk',
        subtitle: 'Ruffle your pond to your liking.',
        language: {
          title: 'Goose dialect',
          description: 'which honk should Goose use?',
          system: 'Local pond'
        },
        engineMode: {
          title: 'Goose Engine',
          description: 'run your own goose, or borrow one from the flock?',
          standalone: 'Lone goose',
          server: 'The flock'
        },
        serverUrl: {
          title: 'Pond URL',
          descriptionPrefix: 'the address of the pond running the goose',
          setupInstructions: 'nesting instructions',
          checking: 'sniffing...',
          connected: 'in the pond',
          unreachable: 'pond frozen',
          placeholder: 'http://localhost:7987'
        },
        worldEngine: {
          title: 'Goose Engine',
          description: 'is the local goose healthy?',
          checking: 'sniffing...',
          yes: 'honk',
          no: 'hiss',
          fixInPlace: 'Preen in place',
          totalReinstall: 'Full molt'
        },
        performance: {
          title: 'Waddle Tuning',
          description: "want to dial in the goose's waddle?",
          quantization: 'Feather compression',
          quantizationDescription:
            'Plucks a few feathers for faster waddling with less nest space, at the cost of some plumage quality.\nFirst INT8 plucking takes 1-2 hours while the goose optimizes its molt - this is a one-time cost.',
          capInferenceFps: 'Cap honk rate',
          capInferenceFpsDescription:
            "Limits the waddling rate to the flock's trained pace. Turning this off may result in the goose waddling faster than intended."
        },
        quantization: {
          none: 'None (full plumage)',
          fp8w8a8: 'FP8 W8A8',
          intw8a8: 'INT8 W8A8'
        },
        worldModel: {
          title: 'Goose Model',
          description: 'which goose will waddle through your world?',
          local: 'nearby',
          download: 'migrate',
          removeCustomModel: 'Release custom goose',
          custom: 'Wild goose...',
          checking: 'sniffing...',
          modelNotFound: 'Goose not found',
          couldNotLoadModelList: 'Could not find the flock',
          couldNotCheckModel: 'Could not inspect goose'
        },
        volume: {
          title: 'Loudness',
          description: 'how loud should the honking be?',
          master: 'overall honk',
          soundEffects: 'wing flaps',
          music: 'goose song'
        },
        mouseSensitivity: {
          title: 'Neck sensitivity',
          description: 'how much should the goose turn its neck when you move?',
          sensitivity: 'neck range'
        },
        keybindings: {
          title: 'Beak bindings',
          description: 'which keys do you want to peck?',
          resetScene: 'Shake off',
          sceneEdit: 'Pond edit'
        },
        fixedControls: {
          title: 'Built-in instincts',
          description: 'what can a goose do?',
          labels: {
            moveForward: 'Waddle forward',
            moveLeft: 'Waddle left',
            moveBack: 'Waddle back',
            moveRight: 'Waddle right',
            jump: 'Flap',
            sprint: 'Charge',
            look: 'Crane neck',
            interact: 'Peck',
            primaryFire: 'Honk',
            secondaryFire: 'Hiss',
            pauseMenu: 'Tuck head under wing'
          },
          values: {
            mouse: 'Neck',
            leftClick: 'Left peck',
            rightClick: 'Right peck'
          }
        },
        experimental: {
          title: 'Experimental honks',
          description: 'want to try some half-baked eggs that might hatch or roll away?',
          sceneEdit: 'Pond edit',
          sceneEditDescription:
            'Honk a key during waddling to edit the pond with a text quack using a local image edit model. Requires 8-10 GB additional nest space.'
        },
        debugMetrics: {
          title: 'Goose telemetry',
          description: 'want to see what the goose is thinking?',
          performanceStats: 'Waddle stats',
          performanceStatsDescription:
            'Show honks per second, waddle time, pond usage, nest memory, and lag sparklines.',
          inputOverlay: 'Peck overlay',
          inputOverlayDescription: 'Show a beak and webbed-foot diagram highlighting active pecks.',
          frameTimeline: 'Feather timeline',
          frameTimelineDescription: 'Show the feather interpolation pipeline with per-egg timing.',
          actionLogging: 'Migration log',
          actionLoggingDescription:
            "Record all pecks and waddles to a file on the pond server for replay. Honked to the OS's temp nest.",
          videoRecording: 'Pond footage',
          videoRecordingDescription: "Record pond frames to an MP4 filmstrip. Honked to the OS's temp nest."
        },
        credits: {
          title: 'The flock'
        }
      },
      pause: {
        title: 'Nesting',
        pinnedScenes: {
          title: 'Favorite ponds',
          description: 'Your favorite ponds. Use the Nesting grounds button to {{suffix}} more ponds.',
          uploadSuffix: 'browse, pin or migrate',
          pinSuffix: 'browse or pin'
        },
        unlockIn: 'preening for {{seconds}}s',
        scenes: {
          title: 'Nesting grounds',
          description_one: 'All of your {{count}} pond.',
          description_other: 'All of your {{count}} ponds.',
          uploadHint: 'Use the buttons to discover more ponds, or drag/paste them in.',
          dropImagesToAddScenes: 'Drop bread to add ponds'
        },
        sceneCard: {
          unsafe: 'Fox nearby',
          unpinScene: 'Leave pond',
          pinScene: 'Claim pond',
          removeScene: 'Abandon pond'
        }
      },
      scenes: {
        failedToReadImageData: 'Failed to nibble image data',
        noImageInClipboard: 'No bread crumb found in clipboard'
      },
      window: {
        minimize: 'Tuck',
        maximize: 'Spread wings',
        close: 'Fly away'
      },
      social: {
        website: 'Gooseworld website',
        x: 'Gooseworld on X',
        discord: 'Gooseworld Discord',
        github: 'Gooseworld GitHub',
        feedback: 'Send a honk'
      },
      sceneEdit: {
        placeholder: 'Describe the pond change...',
        instructions: 'Enter to quack \u00b7 Esc to waddle away',
        applying: 'Rearranging the pond...'
      },
      server: {
        fallbackError: 'Goose error: {{message}}',
        fallbackWarning: 'Goose warning: {{message}}',
        websocketError: 'WebSocket honk failed',
        serverUrlEmpty: 'Pond URL is empty',
        noEndpointUrl: 'No pond address provided',
        websocketDisconnected: 'Goose connection severed',
        websocketNotConnected: 'Goose not connected to pond',
        requestTimeout: 'Request "{{type}}" took too long ({{timeout}}ms) — the goose fell asleep',
        defaultSeedNotFound: 'Required bread crumb "default.jpg" not found in the stash',
        invalidWebsocketEndpoint: 'Invalid pond connection',
        websocketConnectionFailed: 'Failed to waddle to the pond',
        connectionFailed: 'Failed to reach the pond — the goose may have flown away',
        connectionLost: 'Lost sight of the pond — the goose may have flown away',
        startupTimeout: 'The goose took too long to wake up — check the nest logs',
        noOpenPort: 'No open pond found in range {{rangeStart}}–{{rangeEnd}}',
        notResponding: 'The goose is not honking back at {{url}}',
        error: {
          serverStartupFailed: 'The goose failed to wake up',
          timeoutWaitingForSeed: 'Timeout waiting for bread crumb',
          sceneEditModelLoadFailed: 'Pond edit model failed to load',
          sceneEditSafetyRejected: 'Pond edit rejected: the honk did not pass the fox safety check.',
          sceneEditEmptyPrompt: 'Empty quack',
          sceneEditModelNotLoaded: 'Pond edit model not loaded. Enable Pond Edit in Experimental Honks settings.',
          sceneEditAlreadyInProgress: 'Pond edit already in progress',
          contentFilterLoadFailed: 'Fox detector failed to load',
          quantUnsupportedGpu: 'Your nest does not support {{quant}} feather compression. Try a different setting.',
          cudaRecoveryFailed: 'CUDA honk — recovery failed. Please re-waddle.'
        },
        warning: {
          missingSeedData: 'The bread crumb has gone missing from the nest',
          invalidSeedData: 'That bread crumb looks funny — not fit for a goose',
          seedSafetyCheckFailed: 'Bread crumb failed fox inspection',
          seedUnsafe: 'Bread crumb marked as suspicious by the flock',
          seedLoadFailed: 'Failed to nibble bread crumb',
          missingModelId: 'Missing goose model ID'
        }
      }
    },
    stage: {
      setup: {
        checking: 'Inspecting the pond...',
        uv_check: 'Inspecting the pond...',
        uv_download: 'Fetching bread...',
        engine: 'Preening the goose...',
        server_components: 'Gathering feathers...',
        port_scan: 'Scouting for a good pond...',
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
        safety_ready: 'Fox detector operational.',
        ready: 'Ready to unleash the goose.'
      },
      session: {
        waiting_for_seed: 'Choosing a pond...',
        loading_model: {
          import: 'Importing goose genetics...',
          load: 'Hatching the goose...',
          instantiate: 'Loading goose into pond...',
          done: 'The goose has landed!'
        },
        inpainting: {
          load: 'Loading pond editor...',
          ready: 'Pond editor ready.'
        },
        safety: {
          load: 'Loading fox detector...',
          ready: 'Fox detector ready.'
        },
        warmup: {
          reset: 'Stretching wings...',
          seed: 'Test waddle...',
          prompt: 'Practice honk...',
          compile: 'Optimizing honk frequency for your hardware...'
        },
        init: {
          reset: 'Filling the pond...',
          seed: 'Placing the goose...',
          frame: 'First honk...'
        },
        reset: 'Recovering from a bad honk...',
        ready: 'HONK!'
      }
    }
  }
} as const

export default goose
