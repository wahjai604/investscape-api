export const SUPPORTED_LOCALES = Object.freeze(['en', 'fr-CA', 'zh-Hant', 'zh-Hans']);

// Normalize only display preferences. Never copy account or project data into this store.
export function normalizePreferences(input, legacyLocale = 'en', currentTheme = 'light') {
    const candidate = input && typeof input === 'object' && !Array.isArray(input) && input.schemaVersion === 1 ? input : {};
    const chosenLocale = candidate.locale === 'fr' ? 'fr-CA' : candidate.locale;
    const importedLocale = legacyLocale === 'fr' ? 'fr-CA' : legacyLocale;
    const locale = ['en', 'fr-CA', 'zh-Hant', 'zh-Hans'].includes(chosenLocale) ? chosenLocale :
        ['en', 'fr-CA', 'zh-Hant', 'zh-Hans'].includes(importedLocale) ? importedLocale : 'en';
    const theme = ['light', 'dark'].includes(candidate.theme) ? candidate.theme : currentTheme === 'dark' ? 'dark' : 'light';
    const homeCountry = candidate.homeCountry === 'US' ? 'US' : 'CA';
    const baseCurrencyMode = candidate.baseCurrencyMode === 'explicit' && ['CAD', 'USD'].includes(candidate.baseCurrency) ? 'explicit' : 'country-default';
    const baseCurrency = baseCurrencyMode === 'explicit' ? candidate.baseCurrency : homeCountry === 'CA' ? 'CAD' : 'USD';
    const startingModule = ['workspace', 'quick', 'full', 'portfolio', 'market-intel', 'research', 'library', 'community'].includes(candidate.startingModule) ? candidate.startingModule : 'library';
    return {schemaVersion: 1, locale, theme, homeCountry, baseCurrency, baseCurrencyMode, startingModule, shellPreset: 'original-horizontal', layoutOverrides: {}};
}

// A country default is a display preference, never a change to a property's jurisdiction or amounts.
export function changePreference(input, field, value, legacyLocale = 'en', currentTheme = 'light') {
    const previous = normalizePreferences(input, legacyLocale, currentTheme);
    const next = {...previous};
    if (field === 'locale' && ['en', 'fr-CA', 'zh-Hant', 'zh-Hans'].includes(value)) next.locale = value;
    else if (field === 'theme' && ['light', 'dark'].includes(value)) next.theme = value;
    else if (field === 'homeCountry' && ['CA', 'US'].includes(value)) next.homeCountry = value;
    else if (field === 'startingModule' && ['workspace', 'quick', 'full', 'portfolio', 'market-intel', 'research', 'library', 'community'].includes(value)) next.startingModule = value;
    else if (field === 'baseCurrency' && value === 'country-default') next.baseCurrencyMode = 'country-default';
    else if (field === 'baseCurrency' && ['CAD', 'USD'].includes(value)) { next.baseCurrencyMode = 'explicit'; next.baseCurrency = value; }
    const normalized = normalizePreferences(next, legacyLocale, currentTheme);
    return JSON.stringify(previous) === JSON.stringify(normalized) ? previous : normalized;
}
