import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { planDorcaRelease, resolvePackageVersionConflict } from './dorca-release-plan.mjs'
import { verifyDorcaReleaseAssets } from './dorca-release-assets.mjs'

const require = createRequire(import.meta.url)
const config = require('../electron-builder.config.cjs')
const release = require('../dorca-release.json')
const temporaryDirectories = []
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe('Dorca release integration', () => {
  const current = { version: '2.0.0', upstreamTag: 'v1.4.246' }
  it('does nothing on a scheduled check until Orca publishes a new stable release', () => {
    expect(planDorcaRelease(current, current.upstreamTag, undefined, true)).toBeNull()
    expect(planDorcaRelease(current, 'v1.4.247', undefined, true)).toEqual({
      version: '2.0.1',
      upstreamTag: 'v1.4.247'
    })
  })
  it('allows an explicit Dorca release without new Orca code, and rejects downgrades/unreleased refs', () => {
    expect(planDorcaRelease(current, current.upstreamTag, '2.1.0')).toEqual({
      version: '2.1.0',
      upstreamTag: current.upstreamTag
    })
    expect(() => planDorcaRelease(current, current.upstreamTag, '1.0.1')).toThrow('downgrade')
    expect(() => planDorcaRelease(current, 'main')).toThrow('stable')
    expect(() => planDorcaRelease(current, 'v1.4.245')).toThrow('older Orca')
    expect(() => planDorcaRelease(current, 'v1.4.247-rc.1')).toThrow('stable')
  })
  it('preserves Dorca branding and unrelated package scripts across a version conflict', () => {
    const source =
      '{\n"name": "orca",\n<<<<<<< HEAD\n  "productName": "Dorca",\n  "version": "1.4.246",\n=======\n  "version": "1.4.247",\n>>>>>>> FETCH_HEAD\n"scripts": {"build:mac": "custom"}\n}\n'
    expect(JSON.parse(resolvePackageVersionConflict(source))).toEqual({
      name: 'orca',
      productName: 'Dorca',
      version: '1.4.247',
      scripts: { 'build:mac': 'custom' }
    })
    expect(() =>
      resolvePackageVersionConflict(source.replace('"version": "1.4.246"', '"dependencies": {}'))
    ).toThrow('beyond')
  })
  it('packages a distinct Dorca app whose updater cannot select Orca installers', () => {
    expect(config.appId).toBe('com.stablyai.dorca')
    expect(config.productName).toBe('Dorca')
    expect(config.extraMetadata).toMatchObject({ name: 'dorca', version: release.version })
    expect(config.publish).toMatchObject({
      owner: 'danpaker4',
      repo: 'Dorca',
      releaseType: 'draft'
    })
    expect(config.nsis.artifactName).toBe('dorca-windows-setup.${ext}')
    expect(config.win.signtoolOptions.publisherName).toBeUndefined()
    expect(config.win.verifyUpdateCodeSignature).toBe(false)
  })
})

describe('release publication gate', () => {
  async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), 'dorca-release-'))
    temporaryDirectories.push(directory)
    const installer = Buffer.from('fixture installer payload')
    const sha512 = createHash('sha512').update(installer).digest('base64')
    const manifest = {
      version: '2.0.1',
      files: [{ url: 'dorca-windows-setup.exe', sha512, size: installer.length }],
      path: 'dorca-windows-setup.exe',
      sha512
    }
    await writeFile(join(directory, 'dorca-windows-setup.exe'), installer)
    await writeFile(join(directory, 'dorca-windows-setup.exe.blockmap'), 'blockmap')
    await writeFile(join(directory, 'latest.yml'), stringify(manifest))
    return { directory, manifest }
  }
  it('accepts a complete release and rejects corrupted installer bytes', async () => {
    const { directory } = await fixture()
    await expect(verifyDorcaReleaseAssets(directory, '2.0.1')).resolves.toBeUndefined()
    await writeFile(join(directory, 'dorca-windows-setup.exe'), 'corrupted')
    await expect(verifyDorcaReleaseAssets(directory, '2.0.1')).rejects.toThrow('checksum')
  })
  it('refuses incomplete releases, mismatched versions and upstream/remote asset URLs', async () => {
    const { directory, manifest } = await fixture()
    await expect(verifyDorcaReleaseAssets(directory, '2.0.2')).rejects.toThrow('version')
    manifest.files[0].url =
      'https://github.com/stablyai/orca/releases/download/v1.4.247/orca-windows-setup.exe'
    await writeFile(join(directory, 'latest.yml'), stringify(manifest))
    await expect(verifyDorcaReleaseAssets(directory, '2.0.1')).rejects.toThrow('only to the Dorca')
    await rm(join(directory, 'dorca-windows-setup.exe.blockmap'))
    await expect(verifyDorcaReleaseAssets(directory, '2.0.1')).rejects.toThrow()
  })
})
