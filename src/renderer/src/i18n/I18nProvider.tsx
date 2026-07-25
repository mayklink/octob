import { useEffect, type ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import i18n from './config'
import { useSettingsStore } from '@/stores/useSettingsStore'

function LocaleSync(): null {
  const uiLocale = useSettingsStore((s) => s.uiLocale)

  useEffect(() => {
    void i18n.changeLanguage(uiLocale)
    document.documentElement.lang = uiLocale === 'pt-BR' ? 'pt-BR' : 'en'
  }, [uiLocale])

  return null
}

export function AppI18nProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <I18nextProvider i18n={i18n}>
      <LocaleSync />
      {children}
    </I18nextProvider>
  )
}
