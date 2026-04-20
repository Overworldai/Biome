const he = {
  translation: {
    app: {
      name: 'Biome',
      buttons: {
        settings: 'הגדרות',
        upgrade: 'שדרוג',
        later: 'אחר כך',
        quit: 'יציאה',
        reconnect: 'התחבר מחדש',
        returnToMainMenu: 'חזרה לתפריט הראשי',
        close: 'סגור',
        cancel: 'ביטול',
        back: 'חזרה',
        credits: 'קרדיטים',
        fix: 'תקן',
        reinstallEverything: 'התקן הכול מחדש',
        switchMode: 'החלף מצב',
        keepCurrent: 'שמור נוכחי',
        editUrl: 'URL ערוך כתובת',
        revert: 'שחזר',
        reset: 'איפוס',
        scenes: 'סצנות',
        resume: 'המשך',
        copyReport: 'העתק דוח',
        saveReport: 'שמור דוח',
        reportOnGithub: 'דווח ב-GitHub',
        askOnDiscord: 'שאל ב-Discord',
        showLogs: 'הצג לוגים',
        hideLogs: 'הסתר לוגים',
        abort: 'בטל',
        aborting: 'מבטל...',
        copy: 'העתק',
        pasteImageFromClipboard: 'הדבק תמונה מהלוח',
        browseForImageFile: 'בחר קובץ תמונה',
        delete: 'מחק'
      },
      dialogs: {
        updateAvailable: {
          title: 'עדכון זמין',
          description: 'גרסה חדשה של Biome זמינה ({{latestVersion}}). אצלך מותקנת הגרסה {{currentVersion}}.'
        },
        connectionLost: {
          title: 'החיבור נותק',
          description: 'החיבור ל-World Engine נותק. לנסות להתחבר מחדש?'
        },
        install: {
          title: 'התקנה',
          installing: 'מתקין...',
          failed: 'נכשל.',
          complete: 'הושלם.',
          exportCanceled: 'ייצוא בוטל',
          diagnosticsExported: 'הדיאגנוסטיקה יוצאה',
          exportFailed: 'הייצוא נכשל',
          abortRequested: 'בקשת ביטול נשלחה',
          abortFailed: 'נכשל ביטול ההתקנה',
          abortEngineInstall: 'בטל התקנת מנוע',
          closeInstallLogs: 'סגור לוגי התקנה'
        },
        fixInPlace: {
          title: 'לתקן במקום?',
          description: 'זה יסנכרן מחדש את תלויות המנוע בלי למחוק דבר. בדרך כלל זה מספיק כדי לפתור בעיות אחרי עדכון.'
        },
        totalReinstall: {
          title: 'התקנה מחדש מלאה?',
          description:
            'זה ימחק לחלוטין את תיקיית המנוע ויתקין הכול מחדש, כולל הורדה מחדש של Python, כל התלויות ומנהל החבילות UV. זה עשוי לקחת זמן, אבל יכול לפתור בעיות עקשניות ש"תיקון במקום" לא פותר.'
        },
        applyEngineChanges: {
          title: 'להחיל שינויים במנוע?',
          description: 'שינוי מצב המנוע או מודל העולם יקטע את הסשן הנוכחי שלך ויחיל את כל ההגדרות הממתינות.'
        },
        deleteModelCache: {
          title: 'למחוק את המודל?',
          description:
            '<bold>{{modelId}}</bold> מורד למכשיר זה. מחיקתו תפנה מקום בדיסק, אך יהיה צורך להוריד את המודל מחדש לפני שניתן יהיה להשתמש בו שוב.'
        },
        serverUnreachable: {
          title: 'אי אפשר להגיע לשרת',
          withUrl: 'לא ניתן להתחבר אל {{url}}. ייתכן שהשרת כבוי, שהכתובת שגויה, או שחומת אש חוסמת את החיבור.',
          noUrl: 'יש להזין כתובת שרת לפני שיוצאים מההגדרות.',
          withUrlSecure:
            'לא ניתן להתחבר אל {{url}}. ייתכן שהשרת כבוי, שהכתובת שגויה, או שחומת אש חוסמת את החיבור.\n\nHTTPS ו-WSS אינם נתמכים כברירת מחדל; אם אתה מתחבר ישירות לשרת Biome, נסה להשתמש ב-HTTP או WS במקום.',
          secureTransportHint:
            'HTTPS ו-WSS אינם נתמכים כברירת מחדל; אם אתה מתחבר ישירות לשרת Biome, נסה להשתמש ב-HTTP או WS במקום.'
        }
      },
      loading: {
        error: 'שגיאה',
        connecting: 'מתחבר...',
        starting: 'מפעיל...',
        firstTimeSetup: 'הגדרה ראשונית',
        firstTimeSetupDescription: 'זה ייקח 10–30 דקות בזמן שהרכיבים יורדו ויעברו אופטימיזציה למערכת שלך.',
        firstTimeSetupHint: 'בינתיים אפשר ללכת להכין קפה.',
        exportCanceled: 'ייצוא בוטל',
        diagnosticsExported: 'הדיאגנוסטיקה יוצאה',
        exportFailed: 'הייצוא נכשל',
        terminal: {
          waitingForServerOutput: 'ממתין לפלט מהשרת...',
          runtimeError: 'שגיאת ריצה',
          diagnosticsCopied: 'הדיאגנוסטיקה הועתקה',
          failedToCopyDiagnostics: 'העתקת הדיאגנוסטיקה נכשלה',
          openedGithubIssueFormAndCopiedDiagnostics: 'טופס issue ב-GitHub נפתח והדיאגנוסטיקה הועתקה',
          openedGithubIssueForm: 'טופס issue ב-GitHub נפתח',
          failedToOpenIssueForm: 'פתיחת טופס ה-issue נכשלה',
          whatHappened: 'מה קרה',
          whatHappenedPlaceholder: '<נא לתאר מה עשית ומה נכשל>',
          environment: 'סביבה',
          appVersion: 'גרסת אפליקציה',
          platform: 'פלטפורמה',
          reproductionSteps: 'שלבי שחזור',
          recentLogs: 'לוגים אחרונים',
          fullDiagnostics: 'דיאגנוסטיקה מלאה',
          fullDiagnosticsCopiedHint: 'קובץ ה-JSON המלא של הדיאגנוסטיקה הועתק ללוח. הדבק אותו למטה לפני השליחה.',
          fullDiagnosticsCopyHint: 'לחץ על "העתק דוח" באפליקציה והדבק למטה את JSON הדיאגנוסטיקה.',
          pasteDiagnosticsJson: '<הדבק כאן את JSON הדיאגנוסטיקה המלא>',
          saveDiagnosticsJson: 'שמור את JSON הדיאגנוסטיקה לקובץ',
          copying: 'מעתיק...',
          copyDiagnosticsJsonForBugReports: 'העתק JSON דיאגנוסטיקה לדיווחי באגים',
          opening: 'פותח...',
          openPrefilledIssueOnGithub: 'פתח issue מוכן מראש ב-GitHub',
          askForHelpInDiscord: 'בקש עזרה ב-Discord',
          hideLogsPanel: 'הסתר חלונית לוגים',
          showLogsPanel: 'הצג חלונית לוגים',
          clipboardCopyFailed: 'פקודת ההעתקה ללוח נכשלה'
        }
      },
      settings: {
        title: 'הגדרות',
        subtitle: 'התאם את העולם שלך בדיוק כמו שאתה אוהב.',
        language: {
          title: 'שפה',
          description: 'באיזו שפה Biome צריך להשתמש?',
          system: 'ברירת מחדל של המערכת'
        },
        engineMode: {
          title: 'מצב מנוע',
          description: 'איך להריץ את המודל? כחלק מ-Biome או במקום אחר?',
          standalone: 'עצמאי',
          server: 'שרת'
        },
        serverUrl: {
          title: 'כתובת שרת',
          descriptionPrefix: 'הכתובת של שרת ה-GPU שמריץ את המודל',
          setupInstructions: 'הוראות התקנה',
          checking: 'בודק...',
          connected: 'מחובר',
          unreachable: 'לא זמין',
          placeholder: 'http://localhost:7987'
        },
        worldEngine: {
          title: 'מנוע העולם',
          description: 'האם המנוע המקומי תקין?',
          checking: 'בודק...',
          yes: 'כן',
          no: 'לא',
          fixInPlace: 'תקן במקום',
          totalReinstall: 'התקנה מחדש מלאה'
        },
        performance: {
          title: 'הגדרות ביצועים',
          description: 'רוצה לכוון את ביצועי המודל?',
          quantization: 'קוונטיזציה',
          quantizationDescription:
            'מפחיתה את דיוק המודל כדי לאפשר אינפרנס מהיר יותר ושימוש נמוך יותר בזיכרון, על חשבון ירידה מסוימת באיכות הוויזואלית.\nשימוש ראשון בקוונטיזציית INT8 עשוי לקחת 1–2 שעות בזמן שהקרנלים של האינפרנס עוברים אופטימיזציה — זו עלות חד-פעמית.',
          capInferenceFps: 'הגבלת FPS Inference',
          capInferenceFpsDescription:
            'מגביל את קצב הגנרציה לקצב הפריימים שעליו המודל אומן. בלי זה, המשחק עלול לרוץ מהר מהמתוכנן.'
        },
        quantization: {
          none: 'ללא (דיוק מלא)',
          fp8w8a8: 'FP8 W8A8',
          intw8a8: 'INT8 W8A8'
        },
        worldModel: {
          title: 'מודל עולם',
          description: 'איזה מודל Overworld ידמה את העולם שלך?',
          local: 'מקומי',
          download: 'הורדה',
          removeCustomModel: 'הסר מודל מותאם אישית',
          custom: 'מותאם אישית...',
          checking: 'בודק...',
          modelNotFound: 'המודל לא נמצא',
          couldNotLoadModelList: 'לא ניתן לטעון את רשימת המודלים',
          couldNotCheckModel: 'לא ניתן לבדוק את המודל',
          deleteLocalCache: 'מחק את המודל'
        },
        volume: {
          title: 'עוצמת קול',
          description: 'כמה חזק הדברים צריכים להיות?',
          master: 'ראשי',
          soundEffects: 'אפקטים קוליים',
          music: 'מוזיקה'
        },
        mouseSensitivity: {
          title: 'רגישות עכבר',
          description: 'כמה המצלמה צריכה לזוז כשאתה מזיז את העכבר?',
          sensitivity: 'רגישות'
        },
        gamepadSensitivity: {
          title: 'רגישות גיימפד',
          description: 'כמה המצלמה צריכה לזוז כשאתה מזיז את הסטיק הימני?',
          sensitivity: 'רגישות'
        },
        keybindings: {
          title: 'מקשי שליטה',
          description: 'באילו מקשים אתה רוצה להשתמש?',
          conflictWith: 'מתנגש עם <key>"{{other}}"</key>',
          resetToDefaults: 'אפס לברירת מחדל'
        },
        gamepad: {
          title: 'גיימפד',
          description: 'איך אתה שולט במשחק עם הגיימפד?',
          notDetectedHint: '(הגיימפד לא זוהה, נסה ללחוץ על כפתור כלשהו!)',
          labels: {
            move: 'תנועה',
            look: 'מבט',
            jump: 'קפיצה',
            crouch: 'כפיפה',
            interact: 'אינטראקציה',
            sceneEdit: 'עריכת סצנה',
            sprint: 'ספרינט',
            primaryFire: 'ירי ראשי',
            secondaryFire: 'ירי משני',
            resetScene: 'איפוס סצנה',
            pauseMenu: 'תפריט עצירה'
          }
        },
        controls: {
          labels: {
            moveForward: 'התקדמות',
            moveLeft: 'תנועה שמאלה',
            moveBack: 'תנועה אחורה',
            moveRight: 'תנועה ימינה',
            jump: 'קפיצה',
            crouch: 'כפיפה',
            sprint: 'ספרינט',
            interact: 'אינטראקציה',
            primaryFire: 'ירי ראשי',
            secondaryFire: 'ירי משני',
            pauseMenu: 'תפריט עצירה',
            resetScene: 'איפוס סצנה',
            sceneEdit: 'עריכת סצנה'
          }
        },
        experimental: {
          title: 'ניסיוני',
          description: 'רוצה לנסות רעיונות גולמיים שעלולים להשתנות או להיעלם?',
          sceneEdit: 'עריכת סצנה',
          sceneEditDescription:
            'לחץ על מקש במהלך המשחק כדי לערוך את הסצנה עם פרומפט טקסט בעזרת מודל מקומי לעריכת תמונה. דורש 8–10GB נוספים של VRAM.'
        },
        debugMetrics: {
          title: 'מדדי דיבוג',
          description: 'רוצה לראות מה קורה מאחורי הקלעים?',
          performanceStats: 'סטטיסטיקות ביצועים',
          performanceStatsDescription: 'הצג FPS, זמן פריים, שימוש ב-GPU, VRAM וגרפי השהיה.',
          inputOverlay: 'שכבת קלט',
          inputOverlayDescription: 'הצג תרשים מקלדת ועכבר שמדגיש קלטים פעילים.',
          frameTimeline: 'ציר זמן פריימים',
          frameTimelineDescription: 'הצג את צינור האינטרפולציה של הפריימים עם תזמון לכל שלב.',
          actionLogging: 'רישום פעולות',
          actionLoggingDescription:
            'הקלט את כל הקלטים לקובץ בשרת לצורך ניגון חוזר. נשמר בתיקיית ה-temp של מערכת ההפעלה.',
          diagnostics: 'דיאגנוסטיקה',
          diagnosticsDescription: 'העתק מידע דיאגנוסטי ללוח לצורך דיווחי באגים.',
          copiedToClipboard: 'הועתק ללוח',
          copyFailed: 'ההעתקה נכשלה'
        },
        credits: {
          title: 'קרדיטים'
        }
      },
      pause: {
        title: 'מושהה',
        pinnedScenes: {
          title: 'סצנות מוצמדות',
          description: 'הסצנות המוצמדות שלך. השתמש בכפתור סצנות כדי לצפות בעוד סצנות{{suffix}}.',
          uploadSuffix: ', להצמיד או להעלות',
          pinSuffix: ' או להצמיד'
        },
        unlockIn: 'ייפתח בעוד {{seconds}}ש׳',
        scenes: {
          title: 'סצנות',
          description_one: 'כל {{count}} הסצנה שלך.',
          description_other: 'כל {{count}} הסצנות שלך.',
          uploadHint: 'השתמש בכפתורים כדי להוסיף עוד סצנות, או גרור/הדבק אותן.',
          dropImagesToAddScenes: 'גרור תמונות כדי להוסיף סצנות'
        },
        sceneCard: {
          unsafe: 'לא בטוח',
          unpinScene: 'בטל הצמדה של סצנה',
          pinScene: 'הצמד סצנה',
          removeScene: 'הסר סצנה'
        }
      },
      scenes: {
        failedToReadImageData: 'קריאת נתוני התמונה נכשלה',
        noImageInClipboard: 'לא נמצאה תמונה בלוח'
      },
      window: {
        minimize: 'מזער',
        maximize: 'הגדל',
        close: 'סגור'
      },
      social: {
        website: 'אתר Overworld',
        x: 'Overworld ב-X',
        discord: 'Overworld ב-Discord',
        github: 'Overworld ב-GitHub',
        feedback: 'שלח אימייל משוב'
      },
      sceneEdit: {
        placeholder: 'תאר את השינוי בסצנה...',
        instructions: 'Enter להחלה · Esc לביטול',
        applying: 'מחיל עריכת סצנה...'
      },
      server: {
        fallbackError: 'שגיאת שרת: {{message}}',
        fallbackWarning: 'אזהרת שרת: {{message}}',
        websocketError: 'שגיאת WebSocket',
        serverUrlEmpty: 'כתובת השרת ריקה',
        noEndpointUrl: 'לא סופקה כתובת endpoint',
        websocketDisconnected: 'חיבור ה-WebSocket נותק',
        websocketNotConnected: 'ה-WebSocket לא מחובר',
        requestTimeout: 'הבקשה "{{type}}" פגה לאחר {{timeout}}ms',
        defaultSeedNotFound: 'קובץ ה-seed הנדרש "default.jpg" לא נמצא בתיקיית seeds',
        invalidWebsocketEndpoint: 'כתובת WebSocket לא חוקית',
        websocketConnectionFailed: 'יצירת חיבור WebSocket נכשלה',
        connectionFailed: 'החיבור נכשל — ייתכן שהשרת קרס',
        connectionLost: 'החיבור אבד — ייתכן שהשרת קרס',
        startupTimeout: 'תם הזמן להפעלת השרת — בדוק את הלוגים לשגיאות',
        noOpenPort: 'לא נמצא פורט פתוח בטווח {{rangeStart}}–{{rangeEnd}}',
        notResponding: 'השרת לא מגיב ב-{{url}}',
        error: {
          serverStartupFailed: 'הפעלת השרת נכשלה: {{message}}',
          timeoutWaitingForSeed: 'תם הזמן להמתנה ל-seed ההתחלתי',
          sceneEditModelLoadFailed: 'טעינת מודל עריכת הסצנה נכשלה: {{message}}',
          sceneEditSafetyRejected: 'עריכת הסצנה נדחתה: הבקשה לא עברה את בדיקת הבטיחות.',
          generateSceneSafetyRejected: 'יצירת הסצנה נדחתה: הבקשה לא עברה את בדיקת הבטיחות.',
          sceneEditEmptyPrompt: 'פרומפט ריק',
          sceneEditModelNotLoaded: 'מודל עריכת הסצנה לא נטען. הפעל את Scene Edit בהגדרות הניסיוניות.',
          sceneEditAlreadyInProgress: 'עריכת סצנה כבר מתבצעת',
          contentFilterLoadFailed: 'טעינת מסנן התוכן נכשלה',
          quantUnsupportedGpu: 'ה-GPU שלך לא תומך בקוונטיזציית {{quant}}. נסה הגדרת קוונטיזציה אחרת.',
          cudaRecoveryFailed: 'שגיאת CUDA — השחזור נכשל. נא להתחבר מחדש.'
        },
        warning: {
          missingSeedData: 'חסרים נתוני seed',
          invalidSeedData: 'נתוני seed לא חוקיים',
          seedSafetyCheckFailed: 'ה-seed נכשל בבדיקת בטיחות',
          seedUnsafe: 'ה-seed סומן כלא בטוח',
          seedLoadFailed: 'טעינת תמונת ה-seed נכשלה',
          missingModelId: 'חסר מזהה מודל'
        }
      }
    },
    stage: {
      setup: {
        checking: 'בודק התקנה...',
        uv_check: 'בודק התקנה...',
        uv_download: 'מוריד סביבת ריצה...',
        engine: 'מכין מנוע...',
        server_components: 'מכין קבצי מנוע...',
        port_scan: 'מתכונן להפעלה...',
        sync_deps: 'מתקין רכיבים...',
        verify: 'מאמת התקנה...',
        server_start: 'מפעיל מנוע...',
        health_poll: 'ממתין לעליית המנוע...',
        connecting: 'מתחבר...'
      },
      startup: {
        begin: 'מאתחל...',
        world_engine_manager: 'מכין מנוע עולם...',
        safety_checker: 'טוען מסנן תוכן...',
        safety_ready: 'מסנני התוכן מוכנים.',
        ready: 'מוכן לטעינת מודל.'
      },
      session: {
        waiting_for_seed: 'מכין סצנה...',
        loading_model: {
          import: 'מייבא מסגרת מודל...',
          load: 'טוען מודל...',
          instantiate: 'טוען מודל לזיכרון...',
          done: 'המודל נטען!'
        },
        inpainting: {
          load: 'טוען מודל עריכת סצנה...',
          ready: 'מודל עריכת הסצנה מוכן.'
        },
        safety: {
          load: 'טוען מסנן תוכן...',
          ready: 'מסנן התוכן מוכן.'
        },
        warmup: {
          reset: 'מתכונן לחימום...',
          seed: 'מחמם עם פריים בדיקה...',
          prompt: 'מחמם עם פרומפט בדיקה...',
          compile: 'מבצע אופטימיזציה ל-GPU שלך...'
        },
        init: {
          reset: 'מגדיר עולם...',
          seed: 'טוען סצנת פתיחה...',
          frame: 'מרנדר פריים ראשון...'
        },
        reset: 'מתאושש משגיאת GPU...',
        ready: 'מוכן!'
      }
    }
  }
} as const

export default he
