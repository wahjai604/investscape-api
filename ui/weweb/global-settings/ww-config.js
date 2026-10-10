export default {
  editor: {label: {en: 'InvestScape Global Settings'}, icon: 'options'},
  staticRendering: true,
  properties: {
    locale: {label: {en: "Language"}, type: 'Text', section: 'settings', bindable: true, defaultValue: "en",
      /* wwEditor:start */
      bindingValidation: {type: 'string', tooltip: "Language"}, propertyHelp: {tooltip: 'Bind to the shared App Preferences. This component does not write account or project data.'},
      /* wwEditor:end */
    },
    theme: {label: {en: "Theme"}, type: 'Text', section: 'settings', bindable: true, defaultValue: "light",
      /* wwEditor:start */
      bindingValidation: {type: 'string', tooltip: "Theme"}, propertyHelp: {tooltip: 'Bind to the shared App Preferences. This component does not write account or project data.'},
      /* wwEditor:end */
    },
    homeCountry: {label: {en: "Home country"}, type: 'Text', section: 'settings', bindable: true, defaultValue: "CA",
      /* wwEditor:start */
      bindingValidation: {type: 'string', tooltip: "Home country"}, propertyHelp: {tooltip: 'Bind to the shared App Preferences. This component does not write account or project data.'},
      /* wwEditor:end */
    },
    baseCurrency: {label: {en: "Portfolio display currency"}, type: 'Text', section: 'settings', bindable: true, defaultValue: "CAD",
      /* wwEditor:start */
      bindingValidation: {type: 'string', tooltip: "Portfolio display currency"}, propertyHelp: {tooltip: 'Bind to the shared App Preferences. This component does not write account or project data.'},
      /* wwEditor:end */
    },
    baseCurrencyMode: {label: {en: "Currency selection mode"}, type: 'Text', section: 'settings', bindable: true, defaultValue: "country-default",
      /* wwEditor:start */
      bindingValidation: {type: 'string', tooltip: "Currency selection mode"}, propertyHelp: {tooltip: 'Bind to the shared App Preferences. This component does not write account or project data.'},
      /* wwEditor:end */
    },
    startingModule: {label: {en: 'Preferred starting module'}, type: 'Text', section: 'settings', bindable: true, defaultValue: 'library',
      /* wwEditor:start */
      bindingValidation: {type: 'string', tooltip: 'workspace, quick, full, portfolio, market-intel, research, library or community'}, propertyHelp: {tooltip: 'Opens the preferred internal panel on app entry. Login redirect and member-access verification remain a separate integration.'},
      /* wwEditor:end */
    },
    pageTitle: {label: {en: "Localized page title"}, type: 'Text', section: 'settings', bindable: true, defaultValue: "InvestScape",
      /* wwEditor:start */
      bindingValidation: {type: 'string', tooltip: "Localized page title"}, propertyHelp: {tooltip: 'Bind to the shared App Preferences. This component does not write account or project data.'},
      /* wwEditor:end */
    }
  },
  triggerEvents: [{name: 'preferenceChange', label: {en: 'On preference change'}, event: {field: 'locale', value: 'en'}}], actions: [],
};
