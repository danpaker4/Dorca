import { app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const DORCA_FORK_OWNER_REPO = 'danpaker4/Dorca'
export const DORCA_FORK_GIT_URL = `https://github.com/${DORCA_FORK_OWNER_REPO}.git`
export const ORCA_UPSTREAM_GIT_URL = 'https://github.com/stablyai/orca.git'
export const DORCA_FORK_LATEST_RELEASE_API = `https://api.github.com/repos/${DORCA_FORK_OWNER_REPO}/releases/latest`

export const DORCA_REPO_ROOT =
  process.env.DORCA_REPO_ROOT?.trim() || join(homedir(), 'dorca')

const DORCA_SETUP_EXE_PATH = join(DORCA_REPO_ROOT, 'dist', 'dorca-windows-setup.exe')
const DORCA_WIN_UNPACKED_DIR = join(DORCA_REPO_ROOT, 'dist', 'win-unpacked')
const DORCA_WIN_UNPACKED_EXE_PATH = join(DORCA_WIN_UNPACKED_DIR, 'Dorca.exe')

const DORCA_MAC_ARM64_APP_PATH = join(DORCA_REPO_ROOT, 'dist', 'mac-arm64', 'Dorca.app')
const DORCA_MAC_X64_APP_PATH = join(DORCA_REPO_ROOT, 'dist', 'mac', 'Dorca.app')
const DORCA_MAC_UNIVERSAL_APP_PATH = join(DORCA_REPO_ROOT, 'dist', 'mac-universal', 'Dorca.app')

let updateReady = false
let pendingDorcaReleaseTag: string | null = null

type DorcaReleaseState = {
  installedTag?: string
  updatedAt?: number
}

function getDorcaReleaseStateFilePath(): string {
  return join(app.getPath('userData'), 'dorca-release-state.json')
}

function readDorcaReleaseState(): DorcaReleaseState {
  try {
    const filePath = getDorcaReleaseStateFilePath()
    if (!existsSync(filePath)) {
      return {}
    }
    return JSON.parse(readFileSync(filePath, 'utf8')) as DorcaReleaseState
  } catch {
    return {}
  }
}

function writeDorcaReleaseState(state: DorcaReleaseState): void {
  try {
    const filePath = getDorcaReleaseStateFilePath()
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8')
  } catch {
    // Ignore persistence errors
  }
}

function getExecutableMtimeMs(): number {
  try {
    return statSync(process.execPath).mtimeMs
  } catch {
    return 0
  }
}

export async function checkForDorcaForkReleaseUpdate(): Promise<{
  version: string
  releaseUrl: string
} | null> {
  if (!canUseDorcaLocalRebuild()) {
    return null
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const response = await fetch(DORCA_FORK_LATEST_RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Dorca-Updater'
      },
      signal: controller.signal
    })
    if (!response.ok) {
      return null
    }
    const data = (await response.json()) as {
      tag_name?: string
      html_url?: string
      draft?: boolean
      published_at?: string
    }
    const tagName = data.tag_name?.trim()
    if (!tagName || data.draft) {
      return null
    }

    const state = readDorcaReleaseState()
    if (state.installedTag === tagName) {
      return null
    }

    const publishedAtMs = data.published_at ? Date.parse(data.published_at) : Number.NaN
    const exeMtimeMs = getExecutableMtimeMs()
    if (!state.installedTag && Number.isFinite(publishedAtMs) && exeMtimeMs > 0 && publishedAtMs <= exeMtimeMs) {
      writeDorcaReleaseState({ installedTag: tagName, updatedAt: Date.now() })
      return null
    }

    pendingDorcaReleaseTag = tagName
    return {
      version: tagName,
      releaseUrl: data.html_url || `https://github.com/${DORCA_FORK_OWNER_REPO}/releases/tag/${tagName}`
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function findBuiltMacAppPath(): string | null {
  for (const candidate of [
    DORCA_MAC_ARM64_APP_PATH,
    DORCA_MAC_X64_APP_PATH,
    DORCA_MAC_UNIVERSAL_APP_PATH
  ]) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

function runCommandInDir(
  cwd: string,
  command: string,
  args: string[],
  extraEnv?: Record<string, string>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: true,
      windowsHide: true,
      env: {
        ...process.env,
        COREPACK_ENABLE_STRICT: '0',
        ...extraEnv
      }
    })
    let stderrTail = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-800)
    })
    child.on('error', (err) => reject(err))
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(
          new Error(
            `${command} ${args.join(' ')} exited with code ${code}${
              stderrTail.trim() ? `: ${stderrTail.trim()}` : ''
            }`
          )
        )
      }
    })
  })
}

function runRepoCommand(
  command: string,
  args: string[],
  extraEnv?: Record<string, string>
): Promise<void> {
  return runCommandInDir(DORCA_REPO_ROOT, command, args, extraEnv)
}

export function canUseDorcaLocalRebuild(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin'
}

export function hasDorcaLocalRebuildInstaller(): boolean {
  if (!updateReady) {
    return false
  }
  if (process.platform === 'win32') {
    return existsSync(DORCA_WIN_UNPACKED_EXE_PATH) || existsSync(DORCA_SETUP_EXE_PATH)
  }
  if (process.platform === 'darwin') {
    return findBuiltMacAppPath() !== null
  }
  return false
}

export async function runDorcaLocalRebuildUpdate(
  onProgress: (percent: number) => void
): Promise<void> {
  updateReady = false
  onProgress(5)

  // If the user/friend doesn't have ~/dorca cloned yet, clone it automatically from the Dorca fork.
  if (!existsSync(join(DORCA_REPO_ROOT, '.git'))) {
    const parentDir = dirname(DORCA_REPO_ROOT)
    mkdirSync(parentDir, { recursive: true })
    await runCommandInDir(parentDir, 'git', ['clone', DORCA_FORK_GIT_URL, DORCA_REPO_ROOT])
  }

  onProgress(15)

  // 1. Pull latest Dorca changes from the Dorca fork (danpaker4/dorca)
  try {
    await runRepoCommand('git', ['pull', '--rebase', DORCA_FORK_GIT_URL, 'main'])
  } catch {
    await runRepoCommand('git', ['rebase', '--abort']).catch(() => {})
  }

  onProgress(25)

  // 2. Pull latest official Orca changes from stablyai/orca and rebase Dorca commits on top
  try {
    await runRepoCommand('git', ['pull', '--rebase', ORCA_UPSTREAM_GIT_URL, 'main'])
  } catch (pullError) {
    await runRepoCommand('git', ['rebase', '--abort']).catch(() => {})
    throw pullError
  }

  onProgress(40)
  await runRepoCommand('pnpm', ['install'])
  await runRepoCommand('pnpm', ['-C', 'mobile', 'install', '--frozen-lockfile'])

  onProgress(60)
  await runRepoCommand('pnpm', ['run', 'build:native'])

  onProgress(75)
  await runRepoCommand('pnpm', ['run', 'build:electron-vite'])
  await runRepoCommand('pnpm', ['run', 'build:web-from-renderer'])

  onProgress(90)
  if (process.platform === 'win32') {
    try {
      await runRepoCommand('pnpm', [
        'exec',
        'electron-builder',
        '--config',
        'config/electron-builder.config.cjs',
        '--win',
        '--dir'
      ])
    } catch (err) {
      if (!existsSync(DORCA_WIN_UNPACKED_EXE_PATH)) {
        throw err
      }
    }

    if (!existsSync(DORCA_WIN_UNPACKED_EXE_PATH)) {
      throw new Error(`Expected built Dorca at ${DORCA_WIN_UNPACKED_EXE_PATH} was not found.`)
    }
  } else if (process.platform === 'darwin') {
    await runRepoCommand('pnpm', ['run', 'build:desktop'])
    await runRepoCommand('pnpm', ['run', 'build:computer-macos'])
    await runRepoCommand('pnpm', ['run', 'build:keyboard-layout-macos'])
    await runRepoCommand('pnpm', ['run', 'build:process-footprint-macos'])
    await runRepoCommand('pnpm', ['run', 'build:notification-status-macos'])
    await runRepoCommand('pnpm', ['run', 'ensure:electron-runtime'])
    try {
      await runRepoCommand('pnpm', [
        'exec',
        'electron-builder',
        '--config',
        'config/electron-builder.config.cjs',
        '--mac',
        '--dir'
      ])
    } catch (err) {
      if (!findBuiltMacAppPath()) {
        throw err
      }
    }

    if (!findBuiltMacAppPath()) {
      throw new Error(`Expected built Dorca.app in ${join(DORCA_REPO_ROOT, 'dist')} was not found.`)
    }
  }

  if (pendingDorcaReleaseTag) {
    writeDorcaReleaseState({ installedTag: pendingDorcaReleaseTag, updatedAt: Date.now() })
    pendingDorcaReleaseTag = null
  } else {
    const latest = await checkForDorcaForkReleaseUpdate().catch(() => null)
    if (latest?.version) {
      writeDorcaReleaseState({ installedTag: latest.version, updatedAt: Date.now() })
    }
  }

  updateReady = true
  onProgress(100)
}

function resolveMacTargetAppBundlePath(): string {
  const execPath = process.execPath
  const appMarkerIdx = execPath.indexOf('.app/Contents/MacOS/')
  if (app.isPackaged && appMarkerIdx !== -1) {
    return execPath.slice(0, appMarkerIdx + 4)
  }
  return '/Applications/Dorca.app'
}

export function launchDorcaLocalRebuildInstallerAndQuit(): void {
  if (process.platform === 'win32') {
    if (!existsSync(DORCA_WIN_UNPACKED_EXE_PATH) && !existsSync(DORCA_SETUP_EXE_PATH)) {
      throw new Error(`Built Dorca update not found at ${DORCA_WIN_UNPACKED_DIR}`)
    }

    const defaultWinInstallDir = join(
      process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'),
      'Programs',
      'dorca'
    )
    const targetInstallDir = app.isPackaged ? dirname(process.execPath) : defaultWinInstallDir
    const targetExePath = join(targetInstallDir, 'Dorca.exe')

    const psScript = [
      'Start-Sleep -Seconds 2;',
      `New-Item -ItemType Directory -Force -Path '${targetInstallDir}' | Out-Null;`,
      `Copy-Item -Path '${DORCA_WIN_UNPACKED_DIR}\\*' -Destination '${targetInstallDir}' -Recurse -Force -ErrorAction SilentlyContinue;`,
      `Start-Process -FilePath '${targetExePath}'`
    ].join(' ')

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psScript],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      }
    )
    child.unref()
    setImmediate(() => {
      app.quit()
    })
    return
  }

  if (process.platform === 'darwin') {
    const builtMacAppPath = findBuiltMacAppPath()
    if (!builtMacAppPath) {
      throw new Error(`Built Dorca.app not found in ${join(DORCA_REPO_ROOT, 'dist')}`)
    }
    const targetAppPath = resolveMacTargetAppBundlePath()
    const shScript = [
      'sleep 2',
      `rm -rf "${targetAppPath}"`,
      `ditto "${builtMacAppPath}" "${targetAppPath}"`,
      `open "${targetAppPath}"`
    ].join(' && ')

    const child = spawn('/bin/sh', ['-c', shScript], {
      detached: true,
      stdio: 'ignore'
    })
    child.unref()
    setImmediate(() => {
      app.quit()
    })
  }
}
