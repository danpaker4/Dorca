import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'

export const DORCA_RELEASE_ASSETS = [
  'dorca-windows-setup.exe',
  'dorca-windows-setup.exe.blockmap',
  'latest.yml'
]

export async function verifyDorcaReleaseAssets(directory, version) {
  for (const filename of DORCA_RELEASE_ASSETS) {
    const info = await stat(join(directory, filename))
    if (!info.isFile() || info.size === 0) {
      throw new Error(`Missing release asset: ${filename}`)
    }
  }
  const manifest = parse(await readFile(join(directory, 'latest.yml'), 'utf8'))
  if (manifest?.version !== version) {
    throw new Error('Updater manifest version does not match the release')
  }
  if (!Array.isArray(manifest.files) || manifest.files.length !== 1) {
    throw new Error('Expected exactly one Windows installer in the updater manifest')
  }
  const file = manifest.files[0]
  if (file.url !== DORCA_RELEASE_ASSETS[0] || manifest.path !== DORCA_RELEASE_ASSETS[0]) {
    throw new Error('The updater manifest must point only to the Dorca installer')
  }
  const installer = join(directory, file.url)
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(installer)) {
    hash.update(chunk)
  }
  const digest = hash.digest('base64')
  if (file.sha512 !== digest || manifest.sha512 !== digest) {
    throw new Error('The updater manifest checksum does not match the installer')
  }
  if (file.size !== (await stat(installer)).size) {
    throw new Error('Installer size does not match')
  }
}
