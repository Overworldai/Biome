const zh = {
  translation: {
    app: {
      name: 'Biome',
      buttons: {
        settings: '设置',
        upgrade: '升级',
        later: '稍后',
        quit: '退出',
        reconnect: '重新连接',
        close: '关闭',
        cancel: '取消',
        back: '返回',
        credits: '鸣谢',
        fix: '修复',
        reinstallEverything: '全部重装',
        switchMode: '切换模式',
        keepCurrent: '保持当前',
        editUrl: '编辑 URL',
        revert: '恢复',
        reset: '重置',
        scenes: '场景',
        resume: '继续',
        exportLogs: '导出日志',
        copyReport: '复制报告',
        reportOnGithub: '在 GitHub 上报告',
        askOnDiscord: '去 Discord 求助',
        showLogs: '显示日志',
        hideLogs: '隐藏日志',
        abort: '中止',
        aborting: '正在中止...',
        pasteImageFromClipboard: '从剪贴板粘贴图片',
        browseForImageFile: '浏览图片文件'
      },
      dialogs: {
        updateAvailable: {
          title: '有可用更新',
          description: 'Biome 有新版本可用（{{latestVersion}}）。你当前使用的是 {{currentVersion}}。'
        },
        connectionLost: {
          title: '连接已断开',
          description: '与 World Engine 的连接已丢失。要尝试重新连接吗？'
        },
        install: {
          title: '安装',
          installing: '安装中...',
          failed: '失败。',
          complete: '完成。',
          exportCanceled: '已取消导出',
          diagnosticsExported: '诊断信息已导出',
          exportFailed: '导出失败',
          abortRequested: '已请求中止',
          abortFailed: '中止安装失败',
          abortEngineInstall: '中止引擎安装',
          closeInstallLogs: '关闭安装日志'
        },
        fixInPlace: {
          title: '原地修复？',
          description: '这会重新同步引擎依赖项，但不会删除任何内容。通常足以修复更新后的问题。'
        },
        totalReinstall: {
          title: '全部重装？',
          description:
            '这会彻底删除引擎目录并从头重新安装，包括重新下载 Python、所有依赖项以及 UV 包管理器。可能会花一些时间，但能修复原地修复无法解决的顽固问题。'
        },
        applyEngineChanges: {
          title: '应用引擎更改？',
          description: '更改引擎模式或世界模型会中断当前会话，并应用所有待保存设置。'
        },
        serverUnreachable: {
          title: '无法连接到服务器',
          withUrl: '无法连接到 {{url}}。服务器可能已停止、URL 有误，或被防火墙拦截。',
          noUrl: '离开设置前请输入服务器 URL。',
          withUrlSecure:
            '无法连接到 {{url}}。服务器可能已停止、URL 有误，或被防火墙拦截。\n\n默认不支持 HTTPS 和 WSS；如果你是直接连接 Biome 服务器，请尝试使用 HTTP 或 WS。',
          secureTransportHint: '默认不支持 HTTPS 和 WSS；如果你是直接连接 Biome 服务器，请尝试使用 HTTP 或 WS。'
        }
      },
      loading: {
        error: '错误',
        connecting: '连接中...',
        starting: '启动中...',
        firstTimeSetup: '首次设置',
        firstTimeSetupDescription: '组件下载并针对你的系统完成优化大约需要 10 到 30 分钟。',
        firstTimeSetupHint: '这段时间可以先去喝杯咖啡。',
        exportCanceled: '已取消导出',
        diagnosticsExported: '诊断信息已导出',
        exportFailed: '导出失败',
        terminal: {
          waitingForServerOutput: '正在等待服务器输出...',
          runtimeError: '运行时错误',
          diagnosticsCopied: '诊断信息已复制',
          failedToCopyDiagnostics: '复制诊断信息失败',
          openedGithubIssueFormAndCopiedDiagnostics: '已打开 GitHub issue 表单并复制诊断信息',
          openedGithubIssueForm: '已打开 GitHub issue 表单',
          failedToOpenIssueForm: '打开 issue 表单失败',
          whatHappened: '发生了什么',
          whatHappenedPlaceholder: '<请描述你当时在做什么，以及哪里出了问题>',
          environment: '环境',
          appVersion: '应用版本',
          platform: '平台',
          reproductionSteps: '复现步骤',
          recentLogs: '最近日志',
          fullDiagnostics: '完整诊断信息',
          fullDiagnosticsCopied: '完整诊断 JSON 已复制到剪贴板。请在提交前粘贴到下方。',
          fullDiagnosticsPaste: '请先在应用内点击“复制报告”，然后将诊断 JSON 粘贴到下方。',
          pasteDiagnosticsJson: '<请在此粘贴完整诊断 JSON>',
          exportDiagnosticsJson: '导出诊断 JSON',
          copying: '复制中...',
          copyDiagnosticsJsonForBugReports: '复制用于错误报告的诊断 JSON',
          opening: '正在打开...',
          openPrefilledIssueOnGithub: '打开预填充的 GitHub issue',
          askForHelpInDiscord: '去 Discord 寻求帮助',
          hideLogsPanel: '隐藏日志面板',
          showLogsPanel: '显示日志面板',
          clipboardCopyFailed: '剪贴板复制命令失败'
        }
      },
      settings: {
        title: '设置',
        subtitle: '按你的喜好调整这个世界。',
        language: {
          title: '语言',
          description: 'Biome 应该使用哪种语言？',
          system: '跟随系统'
        },
        engineMode: {
          title: '引擎模式',
          description: '你希望如何运行模型？在 Biome 内运行，还是在别处运行？',
          standalone: '独立模式',
          server: '服务器'
        },
        serverUrl: {
          title: '服务器 URL',
          descriptionPrefix: '运行模型的 GPU 服务器地址',
          setupInstructions: '安装说明',
          checking: '检查中...',
          connected: '已连接',
          unreachable: '无法访问',
          placeholder: 'http://localhost:7987'
        },
        worldEngine: {
          title: '世界引擎',
          description: '本地引擎状态正常吗？',
          checking: '检查中...',
          yes: '是',
          no: '否',
          fixInPlace: '原地修复',
          totalReinstall: '全部重装'
        },
        worldModel: {
          title: '世界模型',
          description: '要使用哪个 Overworld 模型来模拟你的世界？',
          local: '本地',
          download: '下载',
          removeCustomModel: '删除自定义模型',
          custom: '自定义...',
          checking: '检查中...',
          modelNotFound: '未找到模型',
          couldNotLoadModelList: '无法加载模型列表',
          couldNotCheckModel: '无法检查模型'
        },
        volume: {
          title: '音量',
          description: '声音要多大？',
          master: '总音量',
          soundEffects: '音效',
          music: '音乐'
        },
        mouseSensitivity: {
          title: '鼠标灵敏度',
          description: '移动鼠标时，镜头应该移动多少？',
          sensitivity: '灵敏度'
        },
        keybindings: {
          title: '按键绑定',
          description: '你想使用哪些按键？',
          resetScene: '重置场景',
          sceneEdit: '场景编辑'
        },
        fixedControls: {
          title: '固定操作',
          description: '内置操作有哪些？',
          labels: {
            moveForward: '前进',
            moveLeft: '向左移动',
            moveBack: '后退',
            moveRight: '向右移动',
            jump: '跳跃',
            sprint: '冲刺',
            look: '视角移动',
            interact: '交互',
            primaryFire: '主射击',
            secondaryFire: '副射击',
            pauseMenu: '暂停菜单'
          },
          values: {
            mouse: '鼠标',
            leftClick: '左键单击',
            rightClick: '右键单击'
          }
        },
        experimental: {
          title: '实验性功能',
          description: '想尝试一些可能会改变或消失的粗略想法吗？',
          sceneEdit: '场景编辑',
          sceneEditDescription: '在游戏过程中按键，使用AI通过文字提示编辑场景。需要额外约10GB显存。'
        },
        debugMetrics: {
          title: '调试指标',
          description: '想看看底层正在发生什么吗？',
          performanceStats: '性能统计',
          inputOverlay: '输入叠层',
          frameTimeline: '帧时间线'
        },
        credits: {
          title: '鸣谢'
        }
      },
      pause: {
        title: '已暂停',
        pinnedScenes: {
          title: '已固定场景',
          description: '这是你固定的场景。使用场景按钮可{{suffix}}更多场景。',
          uploadSuffix: '查看、固定或上传',
          pinSuffix: '查看或固定'
        },
        unlockIn: '{{seconds}} 秒后解锁',
        scenes: {
          title: '场景',
          description_one: '你一共有 {{count}} 个场景。',
          description_other: '你一共有 {{count}} 个场景。',
          uploadHint: '可使用按钮添加更多场景，或直接拖放 / 粘贴。',
          dropImagesToAddScenes: '拖放图片以添加场景'
        },
        sceneCard: {
          unsafe: '不安全',
          unpinScene: '取消固定场景',
          pinScene: '固定场景',
          removeScene: '删除场景'
        }
      },
      scenes: {
        failedToReadImageData: '无法读取图片数据',
        noImageInClipboard: '剪贴板中未找到图片'
      },
      window: {
        minimize: '最小化',
        maximize: '最大化',
        close: '关闭'
      },
      social: {
        website: 'Overworld 官网',
        x: 'Overworld 的 X',
        discord: 'Overworld Discord',
        github: 'Overworld GitHub',
        feedback: '发送反馈邮件'
      },
      sceneEdit: {
        placeholder: '描述场景变化...',
        instructions: 'Enter 应用 \u00b7 Esc 取消',
        applying: '正在应用场景编辑...'
      },
      server: {
        fallbackError: '服务器错误：{{message}}',
        fallbackWarning: '服务器警告：{{message}}',
        websocketError: 'WebSocket 错误',
        serverUrlEmpty: '服务器 URL 为空',
        noEndpointUrl: '未提供端点 URL',
        websocketDisconnected: 'WebSocket 已断开',
        websocketNotConnected: 'WebSocket 未连接',
        requestTimeout: '请求「{{type}}」在 {{timeout}}ms 后超时',
        defaultSeedNotFound: '在种子文件夹中未找到必需的种子文件「default.jpg」',
        invalidWebsocketEndpoint: '无效的 WebSocket 端点',
        websocketConnectionFailed: '无法创建 WebSocket 连接',
        connectionFailed: '连接失败 - 服务器可能已崩溃',
        connectionLost: '连接丢失 - 服务器可能已崩溃',
        startupTimeout: '服务器启动超时 - 请检查日志',
        noOpenPort: '在范围 {{rangeStart}}–{{rangeEnd}} 中未找到可用端口',
        notResponding: '服务器在 {{url}} 没有响应',
        error: {
          serverStartupFailed: '服务器启动失败',
          timeoutWaitingForSeed: '等待初始种子超时',
          sceneEditModelLoadFailed: '场景编辑模型加载失败',
          sceneEditSafetyRejected: '场景编辑被拒绝：请求未通过内容安全检查。',
          sceneEditEmptyPrompt: '提示词为空',
          sceneEditModelNotLoaded: '场景编辑模型未加载。请在实验性功能设置中启用场景编辑。',
          sceneEditAlreadyInProgress: '场景编辑已在进行中',
          contentFilterLoadFailed: '内容过滤器加载失败',
          cudaRecoveryFailed: 'CUDA 错误 - 恢复失败。请重新连接。'
        },
        warning: {
          missingFilename: '缺少文件名',
          seedSafetyCheckFailed: "种子 '{{filename}}' 安全检查失败",
          seedUnsafe: "种子 '{{filename}}' 被标记为不安全",
          seedNotFound: '未找到种子文件：{{filename}}',
          seedIntegrityFailed: '文件完整性验证失败 - 请重新扫描种子',
          seedLoadFailed: '无法加载种子图片',
          missingModelId: '缺少模型 ID'
        }
      }
    },
    stage: {
      setup: {
        checking: '正在检查设置...',
        uv_check: '正在检查设置...',
        uv_download: '正在下载运行时...',
        engine: '正在准备引擎...',
        server_components: '正在准备引擎文件...',
        port_scan: '正在准备启动...',
        sync_deps: '正在安装组件...',
        verify: '正在验证安装...',
        server_start: '正在启动引擎...',
        health_poll: '正在等待引擎启动...',
        connecting: '正在连接...'
      },
      startup: {
        begin: '正在初始化...',
        world_engine_manager: '正在准备世界引擎...',
        safety_checker: '正在设置内容过滤器...',
        safety_warmup: '正在预热内容过滤器...',
        safety_ready: '内容过滤器已就绪。',
        seed_storage: '正在整理场景...',
        seed_validation: '正在验证场景...',
        ready: '已准备好加载模型。'
      },
      session: {
        waiting_for_seed: '正在准备场景...',
        loading_model: {
          import: '正在导入模型框架...',
          load: '正在加载模型...',
          instantiate: '正在将模型载入内存...',
          done: '模型已加载！'
        },
        inpainting: {
          load: '正在加载场景编辑模型...',
          ready: '场景编辑模型已就绪。'
        },
        safety: {
          load: '正在加载内容过滤器...',
          ready: '内容过滤器已就绪。'
        },
        warmup: {
          reset: '正在准备预热...',
          seed: '正在用测试帧预热...',
          prompt: '正在用测试提示词预热...',
          compile: '正在为你的 GPU 做优化...'
        },
        init: {
          reset: '正在设置世界...',
          seed: '正在加载初始场景...',
          frame: '正在渲染第一帧...'
        },
        reset: '正在从 GPU 错误中恢复...',
        ready: '准备就绪！'
      }
    }
  }
} as const

export default zh
