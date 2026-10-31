#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')
const defaultLocalAppData = join(homedir(), 'AppData', 'Local')

const CANDIDATE_RESOURCE_ROOTS = [
  join(process.env.LOCALAPPDATA ?? defaultLocalAppData, 'Programs', 'orca', 'resources'),
  join(process.env.LOCALAPPDATA ?? defaultLocalAppData, 'Programs', 'dorca', 'resources'),
  join(process.env.LOCALAPPDATA ?? defaultLocalAppData, 'Programs', 'Dorca', 'resources')
]

export function seedPrebuiltWindowsNatives() {
  if (process.platform !== 'win32') {
    return false
  }
  const sourceResources = CANDIDATE_RESOURCE_ROOTS.find((dir) => existsSync(dir))
  if (!sourceResources) {
    return false
  }

  // 1. Workspace addons: @orca/windows-registry and @orca/windows-security
  const workspaceAddons = [
    [
      join(sourceResources, 'node_modules', '@orca', 'windows-registry', 'build', 'Release', 'orca_windows_registry.node'),
      join(repoRoot, 'native', 'windows-registry', 'build', 'Release', 'orca_windows_registry.node')
    ],
    [
      join(sourceResources, 'node_modules', '@orca', 'windows-security', 'build', 'Release', 'orca_windows_security.node'),
      join(repoRoot, 'native', 'windows-security', 'build', 'Release', 'orca_windows_security.node')
    ]
  ]
  for (const [src, dest] of workspaceAddons) {
    if (existsSync(src) && !existsSync(dest)) {
      mkdirSync(dirname(dest), { recursive: true })
      cpSync(src, dest)
    }
  }

  // 2. Shared store addons: @vscode/windows-process-tree and node-pty
  const wptPkg = join(repoRoot, 'node_modules', '@vscode', 'windows-process-tree')
  const wptSrc = join(
    sourceResources,
    'node_modules',
    '@vscode',
    'windows-process-tree',
    'build',
    'Release',
    'windows_process_tree.node'
  )
  if (existsSync(wptPkg) && existsSync(wptSrc)) {
    const physicalWpt = realpathSync(wptPkg)
    for (const sub of ['Release', 'orca-napi-win32-x64']) {
      const dest = join(physicalWpt, 'build', sub, 'windows_process_tree.node')
      if (!existsSync(dest)) {
        mkdirSync(dirname(dest), { recursive: true })
        cpSync(wptSrc, dest)
      }
    }
  }

  const nodePtyPkg = join(repoRoot, 'node_modules', 'node-pty')
  const nodePtySrcRelease = join(sourceResources, 'node_modules', 'node-pty', 'build', 'Release')
  if (existsSync(nodePtyPkg) && existsSync(nodePtySrcRelease)) {
    const physicalNodePty = realpathSync(nodePtyPkg)
    for (const sub of ['Release', 'orca-napi-win32-x64']) {
      const destDir = join(physicalNodePty, 'build', sub)
      if (!existsSync(join(destDir, 'conpty.node'))) {
        mkdirSync(destDir, { recursive: true })
        cpSync(nodePtySrcRelease, destDir, { recursive: true })
      }
    }
  }

  // 3. Windows Rust helper executables
  const rustBins = [
    [
      join(sourceResources, 'bin', 'orca.exe'),
      join(repoRoot, 'native', 'windows-cli-launcher', '.build', 'orca.exe')
    ],
    [
      join(sourceResources, 'bin', 'orca-administrator-restart.exe'),
      join(repoRoot, 'native', 'windows-cli-launcher', '.build', 'orca-administrator-restart.exe')
    ],
    [
      join(sourceResources, 'bin', 'orca-agent-hook.exe'),
      join(repoRoot, 'native', 'windows-agent-hook', '.build', 'orca-agent-hook.exe')
    ]
  ]
  for (const [src, dest] of rustBins) {
    if (existsSync(src) && !existsSync(dest)) {
      mkdirSync(dirname(dest), { recursive: true })
      cpSync(src, dest)
    }
  }

  return true
}

seedPrebuiltWindowsNatives()
