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

页面右下角出现一个浮动小卡片（可收起成一个小胶囊，收起状态记在 `localStorage`）：

```
┌──────────────────────────────────────┐
│ 一键重启 DSH 服务              [–]   │
│ 结束当前实例并用原命令重新拉起         │
│                        [ 重启 DSH 服务 ]│
└──────────────────────────────────────┘
```

点击后的状态流转：

```
重启 DSH 服务 → 正在重启… → 等待新实例…（倒计时）→ 页面自动刷新
```

---

## 部署（使用者视角）

### 前置条件

| 项目 | 要求 |
| --- | --- |
| 操作系统 | **Windows**（依赖 `netstat`、`taskkill`、Windows PowerShell） |
| Node.js | ≥ 22 |
| pnpm | 在 PATH 中（`dsh plugin` 会调它；用 `npx` 装 dsh 的环境通常已具备） |
| dsh | 以 profile 方式运行，例如 `npx @deepseek-ai/dsh web`（profile 名默认 `web`） |

### 方式 A：直接从 GitHub 安装（推荐）

**不需要手动 clone**。`dsh plugin` 本质是「在 profile 目录里跑 pnpm，然后同步 `dsh.profile.bundles`」，所以给它一个 git 地址就够了：

```powershell
# 1) 装进 web profile
dsh plugin --profile web add github:<你的用户名>/dsh-restart

# 2) 重启 dsh —— 插件行只在进程启动时挂载，这一步不能省
npx @deepseek-ai/dsh web

# 3) 页面硬刷新：Ctrl + Shift + R
```

钉版本（可选）：

```powershell
dsh plugin --profile web add github:<你的用户名>/dsh-restart#v1.1.0
```

### 方式 B：clone 到本地再安装（适合要改代码 / 离线）

```powershell
git clone https://github.com/<你的用户名>/dsh-restart.git C:\Users\<你>\dsh-restart
dsh plugin --profile web add 'C:\Users\<你>\dsh-restart'
npx @deepseek-ai/dsh web
```

本地路径在 pnpm 里是**链接**而非拷贝：改完仓库里的文件，重启 dsh 即生效，无需重装。

### 怎么确认装好了

**① 看 profile 清单**（`dsh plugin add` 成功后应该出现两处改动）：

```powershell
type "$env:USERPROFILE\.dsh\profiles\web\package.json"
```

```json
{
  "dependencies": { "dsh-restart": "github:<你的用户名>/dsh-restart" },
  "dsh": { "profile": { "bundles": ["...", "dsh-restart"] } }
}
```

**② 看助手脚本是否被自动安装**：

```powershell
Test-Path "$env:USERPROFILE\.dsh\dsh-restart.ps1"   # 期望 True
```

**③ 看页面**：硬刷新后右下角出现浮动卡片。若已收起过，会显示成一个小胶囊「重启 DSH」。

> 如果你用的不是 `web` profile，把命令里的 `--profile web` 换成你的 profile 名。

### 升级

```powershell
dsh plugin --profile web update dsh-restart
npx @deepseek-ai/dsh web
```

用 git tag 安装的，改 `add` 的 tag 后重跑一次即可。

### 卸载

```powershell
dsh plugin --profile web remove dsh-restart
npx @deepseek-ai/dsh web
```

残留物（可选清理）：`~/.dsh/dsh-restart.ps1`（助手脚本）和浏览器 `localStorage` 里的 `dsh-restart.collapsed`（收起状态）。

---

## 配置（都是可选的）

在启动 dsh 前设置环境变量即可：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_WEB_PORT` | `3080` | 用于识别「要结束哪个进程」的监听端口 |
| `DSH_RESTART_COMMAND` | `npx @deepseek-ai/dsh web` | 重启时执行的启动命令 |
| `DSH_RESTART_SCRIPT` | `~/.dsh/dsh-restart.ps1` | 助手脚本位置；显式设置后不再自动安装 |

例如端口换成 4090：

```powershell
$env:DSH_WEB_PORT = '4090'
npx @deepseek-ai/dsh web
```

## 工作原理

只有一个 host 插件行（`index.mjs`），它做两件事：

1. **`POST /api/dsh-restart`** —— 用 dsh 的 `shell` 服务启动一个**独立进程树**的
   PowerShell 助手（`scripts/dsh-restart.ps1`）。助手会：
   - 先等 2.5 秒（让按钮这次请求的响应先回到浏览器，避免页面拿到断掉的路由）
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

## 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 装完按钮不出来 | **忘了重启 dsh**。插件行不会热加载；重启后再 `Ctrl + Shift + R` 硬刷新 |
| profile 里没有 `dsh-restart` | `dsh plugin add` 失败（看它的输出）。检查 pnpm 是否在 PATH、包内是否有 `dsh.bundle.patch` |
| pnpm 提示需要授权构建 | 本包没有 `prepare` 脚本、不需要构建，正常不会被拦；若 pnpm 打印了 key，把它加到 `<profile>/pnpm-workspace.yaml` 的 `allowBuilds` 下再重跑 `add` |
| 点了按钮报「启动失败」 | 看按钮旁的状态文字；同时助手会在自己的控制台窗口打印过程日志 |
| 重启后一直不自动刷新 | 60 秒后会提示手动刷新；检查 `DSH_WEB_PORT` 是否与实际端口一致 |
| 按钮位置挡住了别的控件 | 点卡片上的 `–` 收起成右下角小胶囊 |

## 注意事项

- **仅 Windows**：依赖 `netstat -ano`、`taskkill`、`powershell.exe`（不需要 pwsh）。
- **`POST /api/dsh-restart` 目前无鉴权**：任何能访问本机该端口的页面都能触发重启。
  仅建议在本机使用；需要收紧可以加同源校验或一次性 token。
- 端口释放失败时助手会打印警告并仍然尝试启动。
- 助手脚本按**端口**识别目标进程，并会校验该进程名以 `node` 开头；请勿把端口指向无关服务。

## License

MIT
