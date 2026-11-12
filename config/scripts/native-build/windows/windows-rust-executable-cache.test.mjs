import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { compileWindowsRustExecutable } from './windows-rust-executable-build.mjs'

it.runIf(process.platform === 'win32')(
  'refuses to bless an installed executable without a source fingerprint',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'unverified rust executable '))
    const outputPath = join(root, 'orca.exe')
    copyFileSync(process.execPath, outputPath)
    vi.stubEnv('PATH', '')
    try {
      const repoRoot = resolve(import.meta.dirname, '../../../..')
      expect(() =>
        compileWindowsRustExecutable({
          repoRoot,
          crateRoot: join(repoRoot, 'native', 'windows-cli-launcher'),
          binName: 'orca',
          label: 'CLI launcher',
          fingerprintInputs: [],
          outputPath,
          buildEnv: () => ({})
        })
      ).toThrow(/Unable to run cargo/)
    } finally {
      vi.unstubAllEnvs()
      rmSync(root, { recursive: true, force: true })
    }
  }
)
