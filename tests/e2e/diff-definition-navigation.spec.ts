import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Locator } from '@stablyai/playwright-test'
import { runProcess } from '@orca/process-host'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'

async function answerPosition(line: Locator): Promise<{ x: number; y: number }> {
  return line.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.textContent?.indexOf('answer') ?? -1
      if (index === -1) {
        continue
      }
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + 6)
      const box = range.getBoundingClientRect()
      const row = element.getBoundingClientRect()
      return { x: box.left - row.left + 3, y: box.top - row.top + 3 }
    }
    throw new Error('Rendered answer symbol is missing')
  })
}

test('Go to Definition opens imported symbols from inline peek and full diff', async ({
  orcaPage,
  electronApp,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  await orcaPage.setViewportSize({ width: 1280, height: 900 })
  const fixture = createGoldenWorktree(testRepoPath, 'diff-definition')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const filePath = path.join(fixture.worktreePath, 'use.ts')
  await writeFile(
    path.join(fixture.worktreePath, 'answer.ts'),
    'export function answer(value: number) { return value + 40 }\n'
  )
  await writeFile(filePath, "import { answer } from './answer'\nexport const result = answer(1)\n")
  for (const args of [
    ['add', 'answer.ts', 'use.ts'],
    ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'definition baseline']
  ]) {
    const result = await runProcess({ program: 'git', args, cwd: fixture.worktreePath })
    if (result.code) {
      throw new Error(result.stderr)
    }
  }
  await writeFile(filePath, "import { answer } from './answer'\nexport const result = answer(2)\n")
  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  const openSource = (): Promise<unknown> =>
    orcaPage.evaluate((filePath) => {
      const state = window.__store!.getState()
      state.openFile({
        filePath,
        relativePath: 'use.ts',
        worktreeId: state.activeWorktreeId!,
        language: 'typescript',
        mode: 'edit'
      })
    }, filePath)
  await openSource()
  await orcaPage
    .locator('.git-inline-marker:not(.git-inline-staged)')
    .first()
    .click({ timeout: 30000 })
  const peek = orcaPage.getByRole('region', { name: 'Inline Git change', exact: true })
  const modified = peek.locator('.monaco-editor').last()
  const peekLine = modified.locator('.view-line').filter({ hasText: 'answer(2)' })
  await peekLine.click({ position: await answerPosition(peekLine) })
  await orcaPage.keyboard.press('F12')
  await expect(orcaPage.locator('.monaco-editor[data-uri$="/answer.ts"]')).toContainText(
    'value + 40',
    { timeout: 15000 }
  )
  await orcaPage.screenshot({ path: testInfo.outputPath('peek-definition.png') })
  await openSource()
  await orcaPage.evaluate(
    ({ filePath }) => {
      const state = window.__store!.getState()
      state.openDiff(state.activeWorktreeId!, filePath, 'use.ts', 'typescript', false)
    },
    { filePath }
  )
  const full = orcaPage.locator('.monaco-diff-editor .monaco-editor').last()
  const fullLine = full.locator('.view-line').filter({ hasText: 'answer(2)' })
  await fullLine.click({ position: await answerPosition(fullLine) })
  await orcaPage.keyboard.press('F12')
  await expect(orcaPage.locator('.monaco-editor[data-uri$="/answer.ts"]')).toContainText(
    'value + 40',
    { timeout: 15000 }
  )
  for (const view of ['side-by-side', 'inline'] as const) {
    await orcaPage.evaluate(
      async ({ filePath, view }) => {
        const state = window.__store!.getState()
        await state.updateSettings({ diffDefaultView: view })
        state.openDiff(state.activeWorktreeId!, filePath, 'use.ts', 'typescript', false)
      },
      { filePath, view }
    )
    const line = full.locator('.view-line').filter({ hasText: 'answer(2)' })
    const position = await answerPosition(line)
    await line.click({ position, modifiers: ['ControlOrMeta'] })
    await expect(orcaPage.locator('.monaco-editor[data-uri$="/answer.ts"]')).toContainText(
      'value + 40'
    )
    await orcaPage.keyboard.press(process.platform === 'darwin' ? 'Control+-' : 'Alt+ArrowLeft')
    await expect(orcaPage.locator('.monaco-diff-editor')).toBeVisible()
    await line.click({ position, button: 'right' })
    await orcaPage
      .getByRole('menuitem', { name: /^Go to Definition/ })
      .first()
      .click()
    await expect(orcaPage.locator('.monaco-editor[data-uri$="/answer.ts"]')).toContainText(
      'value + 40'
    )
  }
  expect(
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((window) => window.isVisible())
    )
  ).toBe(false)
})
