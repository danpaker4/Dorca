import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { runProcess } from '@orca/process-host'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'

test('blame reviews uncommitted lines and their history while peek scrolls through the full file', async ({
  orcaPage,
  electronApp,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(180_000)
  await orcaPage.setViewportSize({ width: 1280, height: 900 })
  const fixture = createGoldenWorktree(testRepoPath, 'blame-editor')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const filePath = path.join(fixture.worktreePath, 'blame.ts')
  const context = Array.from(
    { length: 90 },
    (_, index) => `export const context${index} = ${index}\n`
  ).join('')
  const git = async (...args: string[]): Promise<void> => {
    const result = await runProcess({
      program: 'git',
      args: ['-c', 'commit.gpgsign=false', ...args],
      cwd: fixture.worktreePath
    })
    if (result.code) {
      throw new Error(result.stderr)
    }
  }
  await writeFile(
    filePath,
    `export const first = 1\nexport const second = 2\n${context}export const tail = 3\n`
  )
  await git('add', 'blame.ts')
  await git('commit', '--quiet', '-m', 'Blame baseline')
  await writeFile(
    filePath,
    `export const first = 10\nexport const second = 2\n${context}export const tail = 4\n`
  )
  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  await orcaPage.evaluate(async (filePath) => {
    const state = window.__store!.getState()
    await state.updateSettings({ editorGitBlameMode: 'file', editorAutoSave: false })
    state.openFile({
      filePath,
      relativePath: 'blame.ts',
      worktreeId: state.activeWorktreeId!,
      language: 'typescript',
      mode: 'edit'
    })
  }, filePath)
  await orcaPage.locator('.git-blame-annotation').first().hover({ timeout: 30000 })
  const card = orcaPage.getByRole('region', { name: 'Git blame details' })
  await expect(card).toBeVisible()
  await expect(card.getByLabel('Change preview')).toContainText('first = 1')
  await expect(card.getByLabel('Change preview')).toContainText('first = 10')
  await card.getByRole('button', { name: 'Previous line revision' }).click()
  await expect(card).toContainText('Blame baseline')
  await card.getByRole('button', { name: 'Next line revision' }).click()
  await expect(card).toContainText('Uncommitted changes')
  await orcaPage.screenshot({ path: testInfo.outputPath('blame-uncommitted.png') })
  await card.getByRole('button', { name: 'Compare with working tree' }).click()
  const comparison = orcaPage.getByRole('dialog')
  await expect(comparison).toBeVisible()
  await expect(comparison.locator('.monaco-diff-editor')).toBeVisible()
  await orcaPage.keyboard.press('Escape')
  await orcaPage.locator('.git-blame-annotation').first().hover()
  await card.getByRole('button', { name: 'Explain', exact: true }).click()
  await expect(orcaPage.getByRole('menu')).toBeVisible()
  await orcaPage.keyboard.press('Escape')
  await orcaPage.locator('.git-inline-marker:not(.git-inline-staged)').first().click()
  const peek = orcaPage.getByRole('region', { name: 'Inline Git change', exact: true })
  await expect(peek).toBeVisible()
  const opening = await peek.boundingBox()
  const modified = peek.locator('.monaco-editor').last()
  await modified.hover({ position: { x: 120, y: 60 } })
  await orcaPage.mouse.wheel(0, 4000)
  await expect(modified.locator('.view-lines').last()).toContainText('tail = 4')
  await peek.getByRole('button', { name: 'Next change' }).click()
  await expect(peek).toContainText('2 / 2')
  expect((await peek.boundingBox())?.y).toBeCloseTo(opening!.y, 0)
  await peek.getByRole('button', { name: 'Previous change' }).click()
  await expect(modified.locator('.view-lines').last()).toContainText('first = 10')
  await orcaPage.screenshot({ path: testInfo.outputPath('peek-full-file.png') })
  await peek.getByRole('button', { name: 'Close change' }).click()
  await orcaPage.evaluate(() => window.__store!.getState().updateSettings({ theme: 'dark' }))
  await orcaPage.locator('.git-blame-annotation').first().hover()
  await expect(card).toBeVisible()
  await card.screenshot({ path: testInfo.outputPath('blame-dark.png') })
  await card.getByRole('button', { name: 'Close', exact: true }).click()
  await orcaPage.evaluate(() => window.__store!.getState().setRightSidebarOpen(false))
  await orcaPage.setViewportSize({ width: 720, height: 800 })
  await orcaPage.locator('.monaco-editor').first().click()
  await orcaPage.keyboard.press('Alt+F8')
  await expect(card).toBeVisible()
  await expect(card.getByRole('button', { name: 'Compare with working tree' })).toBeEnabled()
  await expect(card).toBeInViewport()
  await card.getByRole('button', { name: 'Close', exact: true }).click({ trial: true })
  await orcaPage.screenshot({
    path: testInfo.outputPath('blame-narrow.png'),
    animations: 'disabled'
  })
  await card.getByRole('button', { name: 'Close', exact: true }).click()
  await orcaPage.evaluate(() =>
    window.__store!.getState().updateSettings({ editorGitBlameMode: 'off' })
  )
  await orcaPage.locator('.monaco-editor').first().click()
  await orcaPage.keyboard.press('Alt+F8')
  await expect(card.getByRole('button', { name: 'Compare with working tree' })).toBeEnabled()
  await expect(card).toBeInViewport()
  await card.getByRole('button', { name: 'Close', exact: true }).click()
  await orcaPage.locator('.monaco-editor .view-line').filter({ hasText: 'first = 10' }).click()
  await orcaPage.keyboard.press('Alt+F8')
  await expect(card).toContainText('Uncommitted changes')
  await git('add', 'blame.ts')
  await git('commit', '--quiet', '-m', 'Commit reviewed changes')
  await expect(orcaPage.locator('.git-blame-annotation').first()).toContainText(
    'Commit reviewed changes',
    { timeout: 60000 }
  )
  await expect(card.filter({ hasText: 'Uncommitted changes' })).not.toBeVisible()
  expect(
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((window) => window.isVisible())
    )
  ).toBe(false)
})

test('deletion gaps open the correct full-file peek at the start, middle and end', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  await orcaPage.setViewportSize({ width: 1280, height: 900 })
  const fixture = createGoldenWorktree(testRepoPath, 'deletion-gaps')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const filePath = path.join(fixture.worktreePath, 'deleted.txt')
  await writeFile(
    filePath,
    'removed at start\nkeep first\nremoved middle one\nremoved middle two\nkeep last\nremoved at end'
  )
  for (const args of [
    ['add', 'deleted.txt'],
    ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Deletion gaps']
  ]) {
    const result = await runProcess({ program: 'git', args, cwd: fixture.worktreePath })
    if (result.code) {
      throw new Error(result.stderr)
    }
  }
  await writeFile(filePath, 'keep first\nkeep last\n')
  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  await orcaPage.evaluate((filePath) => {
    const state = window.__store!.getState()
    state.openFile({
      filePath,
      relativePath: 'deleted.txt',
      worktreeId: state.activeWorktreeId!,
      language: 'plaintext',
      mode: 'edit'
    })
  }, filePath)
  const markers = orcaPage.locator('.git-inline-deleted')
  await expect(markers).toHaveCount(3)
  await orcaPage.screenshot({ path: testInfo.outputPath('deletion-triangles.png') })
  const peek = orcaPage.getByRole('region', { name: 'Inline Git change', exact: true })
  await markers.first().click()
  await expect(peek).toContainText('1 / 3')
  await peek.getByRole('button', { name: 'Next change' }).click()
  await expect(peek).toContainText('2 / 3')
  await expect(peek.locator('.monaco-editor').last()).toContainText('removed middle two')
  await peek.getByRole('button', { name: 'Close change' }).click()
  await markers.last().click({ position: { x: 2, y: 16 } })
  await expect(peek).toContainText('3 / 3')
  await expect(peek.locator('.monaco-editor').last()).toContainText('removed at end')
})

test('keyboard blame opens from Off with reachable actions in a narrow editor', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  await orcaPage.setViewportSize({ width: 720, height: 800 })
  const fixture = createGoldenWorktree(testRepoPath, 'narrow-blame')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const filePath = path.join(fixture.worktreePath, 'narrow.txt')
  await writeFile(
    filePath,
    Array.from({ length: 26 }, (_, index) => `uncommitted narrow editor ${index}\n`).join('')
  )
  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  await orcaPage.evaluate(async (filePath) => {
    const state = window.__store!.getState()
    state.setRightSidebarOpen(false)
    await state.updateSettings({ editorGitBlameMode: 'off' })
    state.openFile({
      filePath,
      relativePath: 'narrow.txt',
      worktreeId: state.activeWorktreeId!,
      language: 'plaintext',
      mode: 'edit'
    })
  }, filePath)
  await orcaPage
    .locator('.monaco-editor .view-line')
    .filter({ hasText: 'uncommitted narrow editor 19' })
    .click()
  await orcaPage.keyboard.press('Alt+F8')
  const card = orcaPage.getByRole('region', { name: 'Git blame details' })
  await expect(card.getByRole('button', { name: 'Compare with working tree' })).toBeEnabled()
  await card.getByRole('button', { name: 'Close', exact: true }).click({ trial: true })
  await orcaPage.screenshot({
    path: testInfo.outputPath('keyboard-blame-narrow.png'),
    animations: 'disabled'
  })
  await card.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(card).not.toBeVisible()
})
