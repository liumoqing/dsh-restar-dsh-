/**
 * dsh-restart — host half (index-injection flavour)
 *
 * Deliberately does NOT use the client module graph. One host row does both jobs:
 *
 *  1. `POST /api/dsh-restart` — spawns a DETACHED PowerShell helper that waits a
 *     grace period, kills the node process listening on the web port, waits for
 *     the port to be released, then runs the launch command in a fresh console.
 *  2. `webServer.tapIndex` — injects a plain `<script>` into index.html that
 *     draws a floating 「重启 DSH 服务」 button and polls until the new instance
 *     answers, then reloads the page.
 *
 * The injected script is ordinary page JavaScript: no bundle, no module table,
 * no dynamic-package sandbox, so it may use fetch/localStorage/timers freely.
 *
 * @module dsh-restart
 */

import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const NAME = 'dsh-restart'

/** Route serving the injected UI script. */
const UI_ROUTE = '/api/dsh-restart/ui.js'

/** Bump to bust the browser cache for the injected UI. */
const UI_REVISION = '4'

/** The helper that ships inside this package. */
const BUNDLED_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'scripts', 'dsh-restart.ps1')

/** Where the helper is installed for the user (env override wins). */
const INSTALLED_SCRIPT = process.env.DSH_RESTART_SCRIPT ?? join(homedir(), '.dsh', 'dsh-restart.ps1')

/** Absolute PowerShell shipped with Windows. */
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'

/** The command the user starts DSH with. */
const DEFAULT_COMMAND = 'npx @deepseek-ai/dsh web'

/** Web port whose listener identifies the DSH instance to replace. */
const DEFAULT_PORT = 3080

/**
 * Make the package self-contained: install the bundled helper into ~/.dsh when
 * it is absent, so a fresh clone works with no manual copy step.
 * @returns the helper path to run.
 */
function resolveHelperScript() {
  if (process.env.DSH_RESTART_SCRIPT !== undefined) return INSTALLED_SCRIPT
  if (existsSync(INSTALLED_SCRIPT)) return INSTALLED_SCRIPT
  try {
    if (existsSync(BUNDLED_SCRIPT)) {
      mkdirSync(dirname(INSTALLED_SCRIPT), { recursive: true })
      copyFileSync(BUNDLED_SCRIPT, INSTALLED_SCRIPT)
      console.log(`[${NAME}] installed restart helper: ${INSTALLED_SCRIPT}`)
    }
  } catch (error) {
    console.error(`[${NAME}] could not install helper to ${INSTALLED_SCRIPT}: ${String(error?.message ?? error)}`)
  }
  return existsSync(INSTALLED_SCRIPT) ? INSTALLED_SCRIPT : BUNDLED_SCRIPT
}

function readPort() {
  const fromEnv = Number.parseInt(process.env.DSH_WEB_PORT ?? '', 10)
  if (Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv < 65_536) return fromEnv
  return DEFAULT_PORT
}

/** The injected UI: plain browser JavaScript, no build step, no product internals. */
function uiScript() {
  return `(() => {
  'use strict'
  var ROUTE = '/api/dsh-restart'
  var STORAGE_KEY = 'dsh-restart.collapsed'
  var POLL_DELAYS = [3000, 6000, 9000, 12000, 16000, 20000, 25000, 30000, 40000, 50000, 60000]

  var pending = false
  var timers = []
  var collapsedState = false

  try { collapsedState = window.localStorage.getItem(STORAGE_KEY) === '1' } catch (error) { collapsedState = false }

  function el(tag, cls, text) {
    var node = document.createElement(tag)
    if (cls) node.className = cls
    if (text !== undefined) node.textContent = text
    return node
  }
  function clearTimers() {
    for (var i = 0; i < timers.length; i += 1) clearTimeout(timers[i])
    timers = []
  }
  function setStatus(node, text, kind) {
    node.textContent = text
    node.style.color = kind === 'error'
      ? 'var(--dsw-alias-state-error-primary, #d94a4a)'
      : kind === 'progress' ? 'var(--dsw-alias-state-success-primary, #2f9e6f)' : ''
  }
  function setCollapsed(value) {
    collapsedState = value
    try { window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0') } catch (error) { /* ignore */ }
  }
  function probe() {
    if (!pending) return
    fetch(window.location.pathname, { method: 'GET', cache: 'no-store' })
      .then(function (response) { if (pending && response && response.status > 0) window.location.reload() })
      .catch(function () { /* still down; a later probe decides */ })
  }
  function startPolling(status) {
    clearTimers()
    var elapsed = 0
    POLL_DELAYS.forEach(function (delay) { timers.push(setTimeout(probe, delay)) })
    function tick() {
      if (!pending) return
      elapsed += 5000
      if (elapsed >= 60000) {
        setStatus(status, '后端应已重启，自动刷新未生效，请手动刷新页面（F5）。', 'error')
        pending = false
        return
      }
      setStatus(status, '旧实例退出中，等待新实例…（' + Math.round(elapsed / 1000) + 's）', 'progress')
      timers.push(setTimeout(tick, 5000))
    }
    setStatus(status, '旧实例退出中，等待新实例…', 'progress')
    timers.push(setTimeout(tick, 5000))
  }
  function restart(button, status) {
    if (pending) return
    pending = true
    button.disabled = true
    button.textContent = '正在重启…'
    setStatus(status, '正在启动重启助手…', 'progress')
    fetch(ROUTE, { method: 'POST', cache: 'no-store' })
      .then(function (response) {
        return response.json().catch(function () { return { ok: false, error: 'HTTP ' + response.status } })
      })
      .then(function (result) {
        if (!result || result.ok !== true) {
          pending = false
          button.disabled = false
          button.textContent = '重启 DSH 服务'
          setStatus(status, '启动失败：' + String((result && result.error) || '未知错误'), 'error')
          return
        }
        button.textContent = '等待新实例…'
        startPolling(status)
      })
      .catch(function (error) {
        pending = false
        button.disabled = false
        button.textContent = '重启 DSH 服务'
        setStatus(status, '请求失败：' + String((error && error.message) || error), 'error')
      })
  }

  var ROOT_ID = 'dsh-restart-root'
  var CSS = [
    '#' + ROOT_ID + '{position:fixed;right:16px;bottom:16px;z-index:2147483000;font:13px/1.4 system-ui,"Segoe UI","Microsoft YaHei",sans-serif}',
    '#' + ROOT_ID + ' .dshr-card{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.35));background:var(--dsw-alias-bg-layer-2,rgba(30,30,30,.94));box-shadow:0 6px 24px rgba(0,0,0,.28);color:var(--dsw-alias-label-primary,#eee)}',
    '#' + ROOT_ID + ' .dshr-chip{padding:8px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.35));background:var(--dsw-alias-bg-layer-2,rgba(30,30,30,.94));box-shadow:0 4px 16px rgba(0,0,0,.24);color:var(--dsw-alias-label-primary,#eee);cursor:pointer}',
    '#' + ROOT_ID + ' .dshr-text{display:flex;flex-direction:column;gap:2px;max-width:280px}',
    '#' + ROOT_ID + ' .dshr-title{font-weight:500}',
    '#' + ROOT_ID + ' .dshr-status{font-size:12px;color:var(--dsw-alias-label-tertiary,#8a8a8a);line-height:16px}',
    '#' + ROOT_ID + ' .dshr-btn{height:30px;padding:0 14px;border:none;border-radius:15px;cursor:pointer;white-space:nowrap;background:var(--dsw-alias-button-primary-fill,#3b82f6);color:var(--dsw-alias-label-primary-foreground,#fff)}',
    '#' + ROOT_ID + ' .dshr-btn:disabled{opacity:.55;cursor:default}',
    '#' + ROOT_ID + ' .dshr-icon{width:26px;height:26px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.35));border-radius:8px;background:transparent;color:inherit;cursor:pointer;line-height:1}',
  ].join('')

  function mount() {
    if (document.getElementById(ROOT_ID)) return
    if (!document.body) return
    var root = el('div')
    root.id = ROOT_ID
    document.body.appendChild(root)

    function render() {
      while (root.firstChild) root.removeChild(root.firstChild)
      var style = el('style')
      style.textContent = CSS
      root.appendChild(style)

      if (collapsedState) {
        var chip = el('button', 'dshr-chip', '重启 DSH')
        chip.type = 'button'
        chip.title = '点击展开一键重启'
        chip.addEventListener('click', function () { setCollapsed(false); render() })
        root.appendChild(chip)
        return
      }

      var card = el('div', 'dshr-card')
      var text = el('div', 'dshr-text')
      text.appendChild(el('div', 'dshr-title', '一键重启 DSH 服务'))
      var status = el('div', 'dshr-status', '结束当前实例并用原命令重新拉起')
      text.appendChild(status)

      var button = el('button', 'dshr-btn', '重启 DSH 服务')
      button.type = 'button'
      button.addEventListener('click', function () { restart(button, status) })

      var collapse = el('button', 'dshr-icon', '–')
      collapse.type = 'button'
      collapse.title = '收起'
      collapse.addEventListener('click', function () { setCollapsed(true); render() })

      card.appendChild(text)
      card.appendChild(button)
      card.appendChild(collapse)
      root.appendChild(card)
    }

    render()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount)
  else mount()
})()`
}

export default {
  name: NAME,
  inject: ['shell', 'webServer'],
  apply(ctx) {
    const shell = ctx.shell
    const webServer = ctx.webServer

    const scriptPath = resolveHelperScript()
    const command = process.env.DSH_RESTART_COMMAND ?? DEFAULT_COMMAND
    const port = readPort()
    const cwd = process.cwd()

    if (!existsSync(scriptPath)) console.error(`[${NAME}] restart helper missing: ${scriptPath}`)

    const helperLine = (workdir) =>
      `"${POWERSHELL}" -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"` +
      ` -Port ${port} -WorkDir "${workdir}" -Command "${command}"`

    const launchHelper = () => {
      let lastError = null
      for (const workdir of [cwd, homedir()]) {
        try {
          const spec = shell.resolve({ command: helperLine(workdir), workdir: cwd })
          const proc = shell.start(spec)
          console.log(`[${NAME}] restart helper started (port ${port}, pid ${String(proc?.pid ?? '?')})`)
          return { ok: true, port, script: scriptPath, command }
        } catch (error) {
          lastError = error
          console.error(`[${NAME}] helper launch failed: ${String(error?.message ?? error)}`)
        }
      }
      return {
        ok: false,
        error: lastError === null ? 'unknown launch failure' : String(lastError?.message ?? lastError),
      }
    }

    const json = (res, code, payload) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
      res.end(JSON.stringify(payload))
    }

    const offRestart = webServer.register({
      kind: 'exact',
      path: '/api/dsh-restart',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'use POST' })
          return
        }
        try {
          json(res, 200, launchHelper())
        } catch (error) {
          json(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })

    const offUi = webServer.register({
      kind: 'exact',
      path: UI_ROUTE,
      handler: async (req, res) => {
        res.writeHead(200, {
          'content-type': 'application/javascript; charset=utf-8',
          'cache-control': 'no-cache',
        })
        res.end(uiScript())
      },
    })

    const tag = `<script data-dsh-plugin="${NAME}" src="${UI_ROUTE}?v=${UI_REVISION}"></script>`
    const offTap = webServer.tapIndex((html) =>
      html.includes('</body>') ? html.replace('</body>', `${tag}</body>`) : html + tag,
    )

    ctx.effect(() => () => {
      for (const disposer of [offRestart, offUi, offTap]) {
        try {
          if (typeof disposer === 'function') disposer()
        } catch (error) {
          console.error(`[${NAME}] disposal failed: ${String(error?.message ?? error)}`)
        }
      }
    })

    console.log(`[${NAME}] ready: POST /api/dsh-restart -> ${command} (port ${port})`)
    console.log(`[${NAME}] floating UI injected into index; script at ${UI_ROUTE}?v=${UI_REVISION}`)
  },
}

/** Exposed for a smoke test: render the injected UI script. */
export function uiSource() {
  return uiScript()
}
