import type { GlobalSettings } from '../../../../../shared/settings/global-settings-types'
import { useTranslate } from '@/i18n/use-translate'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import { Label } from '../../ui/label'
import { SettingsSegmentedControl } from '../form-controls/SettingsFormControls'

export function EditorGitBlameSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const t = useTranslate()
  const label = t('dorca.blame.setting', 'Git blame')
  return (
    <SearchableSetting
      id="editor-git-blame"
      title={label}
      keywords={['git', 'blame', 'author', 'history', 'annotations']}
      className="flex flex-wrap items-center justify-between gap-4 py-3"
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <Label>{label}</Label>
        <p className="text-xs text-muted-foreground">
          {t(
            'dorca.blame.settingDescription',
            'Show line authors and commit history. Hover or click an annotation for details.'
          )}
        </p>
      </div>
      <SettingsSegmentedControl<'off' | 'current-line' | 'file'>
        ariaLabel={label}
        value={settings.editorGitBlameMode ?? 'current-line'}
        onChange={(mode) => updateSettings({ editorGitBlameMode: mode })}
        options={[
          { value: 'off', label: t('dorca.blame.off', 'Off') },
          { value: 'current-line', label: t('dorca.blame.current', 'Current line') },
          { value: 'file', label: t('dorca.blame.file', 'Whole file') }
        ]}
      />
    </SearchableSetting>
  )
}
