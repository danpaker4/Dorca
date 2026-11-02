import { app, shell } from 'electron'
import { MAIN_RELEASE_REPO } from '../../shared/release-channel'
import { isValidAppVersion } from '../../shared/app-version'

export function usesDorcaMacManualUpdates(): boolean {
  return process.platform === 'darwin' && app.getName().toLowerCase() === 'dorca'
}

export async function openDorcaMacRelease(version: string): Promise<void> {
  if (!isValidAppVersion(version)) {
    throw new Error('Cannot open an invalid Dorca release version')
  }
  await shell.openExternal(
    `https://github.com/${MAIN_RELEASE_REPO}/releases/tag/v${encodeURIComponent(version)}`
  )
}
