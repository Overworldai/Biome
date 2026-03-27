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
        exportLogs: 'Scatter droppings',
        copyReport: 'Copy honk report',
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
          exportDiagnosticsJson: 'Export droppings JSON',
          copying: 'Pecking...',
          copyDiagnosticsJsonForBugReports: 'Copy droppings JSON for honk reports',
          opening: 'Waddling...',
          openPrefilledIssueOnGithub: 'Open prefilled honk on GitHub',
          askForHelpInDiscord: 'Honk for help in Discord',
          hideLogsPanel: 'Hide honk panel',
          showLogsPanel: 'Show honk panel'
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
          resetScene: 'Shake off'
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
        debugMetrics: {
          title: 'Goose telemetry',
          description: 'want to see what the goose is thinking?',
          performanceStats: 'Waddle stats',
          inputOverlay: 'Peck overlay',
          frameTimeline: 'Feather timeline'
        },
        gooseMode: {
          label: 'Goose Mode',
          facts: [
            'Geese can sleep with one half of their brain awake to stay alert for danger.',
            'A migrating goose can fly over 1,500 miles in a single day with favorable winds.',
            'Goose families are tight-knit: both parents guard goslings during their first weeks.',
            'Canada geese use dozens of distinct calls to signal direction, danger, and regrouping.',
            'Flying in a V saves energy by sharing uplift from the wingtip vortices ahead.',
            'Many geese return to the same nesting area year after year.',
            'When one goose is injured, others may stay nearby instead of leaving it behind.',
            'Goose feathers are naturally water-resistant and excellent at trapping warmth.',
            'Goslings can swim within a day of hatching, often under close parental escort.',
            'Some goose species can fly at very high altitudes while crossing mountain ranges.',
            'Canada Goose numbers rebounded from major declines in the early 1900s through conservation and hunting rules.',
            'Cackling Goose used to be grouped with Canada Goose until ornithologists split them into separate species in 2004.',
            'There are seven recognized Canada Goose subspecies, including the very large giant Canada Goose.',
            'The giant Canada Goose was once thought extinct until a small population was rediscovered in Minnesota in 1962.',
            'Canada Geese tend to choose mates close to their own size and usually pair for life.',
            'Adult Canada Geese typically do not form breeding pairs until they are at least two years old.',
            'Older goslings sometimes travel in combined groups called gang broods watched over by adults.',
            'A defensive Canada Goose may hiss, spread its wings, pump its head, charge, or even fly at threats.',
            'Canada Geese do much of their feeding on land, especially on grasses, sedges, seeds, and berries.',
            'Geese eat aquatic plants and sometimes small aquatic animals such as mollusks or crustaceans.',
            'Migrating geese often stop in farm fields to feed on cultivated grains.',
            'When the lead bird in a V formation gets tired, it can rotate to the back so another bird takes over.',
            'Many Canada Geese in the lower 48 are now year-round residents rather than long-distance migrants.',
            'Far northern Canada Geese still make the long migrations that were once more typical for the species.',
            'One Canada Goose can carry roughly 20,000 to 25,000 feathers.',
            'Most of a goose feather coat is insulating down that helps it handle icy water and cold weather.',
            'Canada Geese replace all of their feathers through molt, and their wing feathers drop all at once in late summer.',
            'During a wing molt, a goose can be grounded for several weeks before new flight feathers grow in.',
            'Young geese can imprint on the first suitable moving figure they encounter and may stay attached to it long-term.',
            'Geese are highly social and often integrate well with other animals when raised around them.',
            'A female goose is a goose, a male is a gander, and airborne groups are often called skeins.',
            'Though they are waterfowl, geese spend much of their time on land.',
            'Geese may show grief-like behavior after losing a mate or a clutch of eggs.',
            'They often spend time preening, grazing, and collecting plant material to improve their nests.',
            'Geese form strong social bonds and can show clear affection toward others in their group.'
          ]
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
      }
    },
    stage: {
      'setup.checking': 'Inspecting the pond...',
      'setup.uv_check': 'Inspecting the pond...',
      'setup.uv_download': 'Fetching bread...',
      'setup.engine': 'Preening the goose...',
      'setup.server_components': 'Gathering feathers...',
      'setup.port_scan': 'Scouting for a good pond...',
      'setup.sync_deps': 'Stashing bread crumbs...',
      'setup.verify': 'Counting feathers...',
      'setup.server_start': 'Releasing the goose...',
      'setup.health_poll': 'Waiting for the goose to wake up...',
      'setup.connecting': 'Waddling over...',
      'startup.begin': 'Honking into existence...',
      'startup.world_engine_manager': 'Assembling the flock...',
      'startup.safety_checker': 'Training the fox detector...',
      'startup.safety_warmup': 'Test-hissing at shadows...',
      'startup.safety_ready': 'Fox detector operational.',
      'startup.seed_storage': 'Organizing the bread stash...',
      'startup.seed_validation': 'Inspecting each crumb...',
      'startup.ready': 'Ready to unleash the goose.',
      'session.waiting_for_seed': 'Choosing a pond...',
      'session.loading_model.import': 'Importing goose genetics...',
      'session.loading_model.load': 'Hatching the goose...',
      'session.loading_model.instantiate': 'Loading goose into pond...',
      'session.loading_model.done': 'The goose has landed!',
      'session.warmup.reset': 'Stretching wings...',
      'session.warmup.seed': 'Test waddle...',
      'session.warmup.prompt': 'Practice honk...',
      'session.warmup.compile': 'Optimizing honk frequency for your hardware...',
      'session.init.reset': 'Filling the pond...',
      'session.init.seed': 'Placing the goose...',
      'session.init.frame': 'First honk...',
      'session.reset': 'Recovering from a bad honk...',
      'session.ready': 'HONK!'
    }
  }
} as const

export default goose
