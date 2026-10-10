export default {editor: {label: {en: 'InvestScape App Ribbon'}, icon: 'menu'}, staticRendering: true, properties: {locale: {label: {en: "locale"}, type: 'Text', section: 'settings', bindable: true, defaultValue: "en",
/* wwEditor:start */
bindingValidation: {type: 'string', tooltip: "Shared language: en, fr-CA, zh-Hant or zh-Hans."}, propertyHelp: {tooltip: "Shared language: en, fr-CA, zh-Hant or zh-Hans."},
/* wwEditor:end */
},theme: {label: {en: "theme"}, type: 'Text', section: 'settings', bindable: true, defaultValue: "light",
/* wwEditor:start */
bindingValidation: {type: 'string', tooltip: "Shared light or dark theme."}, propertyHelp: {tooltip: "Shared light or dark theme."},
/* wwEditor:end */
},activeModule: {label: {en: "activeModule"}, type: 'Text', section: 'settings', bindable: true, defaultValue: "library",
/* wwEditor:start */
bindingValidation: {type: 'string', tooltip: "Active internal panel: workspace, quick, full, portfolio, market-intel, research, library or community."}, propertyHelp: {tooltip: "Active internal panel: workspace, quick, full, portfolio, market-intel, research, library or community."},
/* wwEditor:end */
}}, triggerEvents: [{name: 'moduleChange', label: {en: 'Change app module'}, event: {value: 'library'}}], actions: []};
