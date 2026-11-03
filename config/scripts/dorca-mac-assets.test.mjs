import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { createDorcaMacManifest, describeDorcaMacInstaller } from './dorca-mac-assets.mjs'

const require = createRequire(import.meta.url)
const directories = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('unsigned Dorca Mac releases', () => {
  it('keeps the release identity with ad-hoc bundle signing and no Apple credentials', () => {
    const config = require('../electron-builder.dorca-mac.config.cjs')
    expect(config.appId).toBe('com.stablyai.dorca')
    expect(config.extraMetadata.version).toBe(require('../dorca-release.json').version)
    expect(config.forceCodeSigning).toBe(false)
    expect(config.mac).toMatchObject({
      identity: '-',
      hardenedRuntime: false,
      notarize: false,
      target: ['dmg']
    })
    expect(config.publish).toMatchObject({
      owner: 'danpaker4',
      repo: 'Dorca',
      publishAutoUpdate: false
    })
  })

  it('uses the Dorca filename at the DMG target level where electron-builder gives it priority', () => {
    const config = require('../electron-builder.dorca-mac.config.cjs')
    require('app-builder-lib')
    const { PlatformPackager } = require('app-builder-lib/out/platformPackager')
    const { pattern } = PlatformPackager.prototype.artifactPatternConfig.call(
      { config, platformSpecificBuildOptions: config.mac },
      config.dmg
    )
    expect(pattern).toBe('dorca-macos-${arch}.${ext}')
  })

  it('publishes notification metadata only when both uploaded DMGs match the verified builds', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dorca-mac-release-'))
    directories.push(directory)
    const descriptions = []
    for (const arch of ['x64', 'arm64']) {
      const filename = join(directory, `dorca-macos-${arch}.dmg`)
      await writeFile(filename, `fixture DMG ${arch}`)
      descriptions.push(await describeDorcaMacInstaller(filename, '2.0.1', arch))
    }
    const assets = descriptions.map((entry) => ({
      name: entry.url,
      size: entry.size,
      digest: `sha256:${entry.sha256}`
    }))
    const manifest = parse(createDorcaMacManifest('2.0.1', descriptions, assets))
    expect(manifest.version).toBe('2.0.1')
    expect(manifest.files.map((entry) => entry.url)).toEqual([
      'dorca-macos-x64.dmg',
      'dorca-macos-arm64.dmg'
    ])
    expect(() => createDorcaMacManifest('2.0.1', descriptions, assets.slice(1))).toThrow(
      'Published x64'
    )
    expect(() => createDorcaMacManifest('2.0.2', descriptions, assets)).toThrow(
      'Missing installer evidence'
    )
    expect(() =>
      createDorcaMacManifest(
        '2.0.1',
        descriptions,
        assets.map((entry) => ({ ...entry, digest: 'sha256:corrupted' }))
      )
    ).toThrow('does not match')
  })
})
