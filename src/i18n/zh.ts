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
          showLogsPanel: '显示日志面板'
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
          resetScene: '重置场景'
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
      }
    },
    stage: {
      'setup.checking': '正在检查设置...',
      'setup.uv_check': '正在检查设置...',
      'setup.uv_download': '正在下载运行时...',
      'setup.engine': '正在准备引擎...',
      'setup.server_components': '正在准备引擎文件...',
      'setup.port_scan': '正在准备启动...',
      'setup.sync_deps': '正在安装组件...',
      'setup.verify': '正在验证安装...',
      'setup.server_start': '正在启动引擎...',
      'setup.health_poll': '正在等待引擎启动...',
      'setup.connecting': '正在连接...',
      'startup.begin': '正在初始化...',
      'startup.world_engine_manager': '正在准备世界引擎...',
      'startup.safety_checker': '正在设置内容过滤器...',
      'startup.safety_warmup': '正在预热内容过滤器...',
      'startup.safety_ready': '内容过滤器已就绪。',
      'startup.seed_storage': '正在整理场景...',
      'startup.seed_validation': '正在验证场景...',
      'startup.ready': '已准备好加载模型。',
      'session.waiting_for_seed': '正在准备场景...',
      'session.loading_model.import': '正在导入模型框架...',
      'session.loading_model.load': '正在加载模型...',
      'session.loading_model.instantiate': '正在将模型载入内存...',
      'session.loading_model.done': '模型已加载！',
      'session.warmup.reset': '正在准备预热...',
      'session.warmup.seed': '正在用测试帧预热...',
      'session.warmup.prompt': '正在用测试提示词预热...',
      'session.warmup.compile': '正在为你的 GPU 做优化...',
      'session.init.reset': '正在设置世界...',
      'session.init.seed': '正在加载初始场景...',
      'session.init.frame': '正在渲染第一帧...',
      'session.reset': '正在从 GPU 错误中恢复...',
      'session.ready': '准备就绪！'
    }
  }
} as const

export default zh
