# dsh-restart

> 给 [DeepSeek Harness](https://github.com/deepseek-ai)（dsh）加一个一键重启：**点一下右下角按钮，自动结束当前实例并用原命令重新拉起，新实例上线后页面自动刷新**。再也不用为了插件改动去手动 Ctrl+C 再敲一遍启动命令。

English: a one-click restart button for the DSH web UI. It kills the DSH instance
listening on the web port through a detached PowerShell helper, relaunches it with
your original start command, and reloads the page once the new instance answers.

---

## 它解决什么问题

DSH 的插件改动需要重启进程才生效，而手动重启意味着：找到窗口 → Ctrl+C → 重新输入 `npx @deepseek-ai/dsh web` → 等启动 → 手动刷新页面。

装了这个插件以后，只需要点一次按钮。

## 效果

页面右下角出现一个浮动小卡片（可收起成一个小胶囊，状态记在 `localStorage`）：

```
┌──────────────────────────────────┐
│ 一键重启 DSH 服务          [–]   │
│ 结束当前实例并用原命令重新拉起     │
│                    [ 重启 DSH 服务 ]│
└──────────────────────────────────┘
```

点击后的状态流转：

```
重启 DSH 服务 → 正在重启… → 等待新实例…（倒计时）→ 页面自动刷新
```

## 安装

前提：Windows + PowerShell（用系统自带的 Windows PowerShell 5.1，不需要 pwsh）。

在 dsh 的 profile 里把它作为插件加入（`<path>` 指向本仓库目录）：

```sh
dsh plugin --profile web add <path-to-this-repo>
```

例如 Windows 绝对路径：

```powershell
dsh plugin --profile web add 'C:\Users\you\Desktop\dsh-restart'
```

`dsh plugin add` 会通过 pnpm 建立 `link:` 依赖，并因为本包声明了 `dsh.bundle.patch`
自动把 `dsh-restart` 加进该 profile 的 `dsh.profile.bundles`。**然后重启一次 dsh**
（插件行只在进程启动时挂载）：

```sh
npx @deepseek-ai/dsh web
```

页面硬刷新（`Ctrl + Shift + R`）后，右下角就会出现按钮。

## 配置（都是可选的）

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_WEB_PORT` | `3080` | 用于识别「要结束哪个进程」的监听端口 |
| `DSH_RESTART_COMMAND` | `npx @deepseek-ai/dsh web` | 重启时执行的启动命令 |
| `DSH_RESTART_SCRIPT` | `~/.dsh/dsh-restart.ps1` | 助手脚本位置；设置后不再自动安装 |

## 工作原理

只有一个 host 插件行（`index.mjs`），它做两件事：

1. **`POST /api/dsh-restart`** —— 用 dsh 的 `shell` 服务启动一个**独立进程树**的
   PowerShell 助手（`scripts/dsh-restart.ps1`）。助手会：
   - 先等 2.5 秒（让按钮这次请求的响应先回到浏览器）
   - 用 `netstat` 找出监听目标端口的 PID，确认它是 `node*` 进程（否则拒绝执行，避免误杀）
   - `taskkill /T /F` 结束它，等端口真正释放
   - 在新控制台窗口执行启动命令
2. **`webServer.tapIndex`** —— 往 `index.html` 注入一行
   `<script src="/api/dsh-restart/ui.js?v=…">`，由 `/api/dsh-restart/ui.js` 提供按钮脚本。
   脚本是普通页面 JS，用 `fetch` 触发重启、`setTimeout` 轮询本页，一旦新实例有响应就
   `location.reload()`。

刻意**不使用** dsh 的客户端模块图（`dsh.client` / `window.__ModuleLoader__`）：注入的
普通脚本不需要打包、不经过动态插件沙箱，代码更短、故障点更少。助手脚本随包提供，首次
启动会自动安装到 `~/.dsh/dsh-restart.ps1`，所以这个包是自包含的。

## 手动使用（不装插件也行）

助手脚本可以单独运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.dsh\dsh-restart.ps1"
```

参数：`-Port 3080`、`-WorkDir <目录>`、`-Command "<启动命令>"`、`-MaxWaitSeconds 120`。

## 卸载

```sh
dsh plugin --profile web remove dsh-restart
```

然后重启一次 dsh。

## 注意事项

- **仅 Windows**：依赖 `netstat -ano`、`taskkill`、`powershell.exe`。
- **`POST /api/dsh-restart` 目前无鉴权**：任何能访问本机该端口的页面都能触发重启。
  仅建议在本机使用；需要收紧可以加同源校验或一次性 token。
- 端口释放失败时助手会打印警告并仍然尝试启动，日志在它自己的控制台窗口里。

## License

MIT
