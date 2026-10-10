export default {
  editor:{label:{en:'InvestScape Learning Library'},icon:'document'},staticRendering:true,
  properties:{
    enabled:{label:{en:'Enable Library'},type:'OnOff',section:'settings',bindable:true,defaultValue:false,
      /* wwEditor:start */
      bindingValidation:{type:'boolean',tooltip:'Enable on the reviewed member page'},propertyHelp:{tooltip:'Default off. This is a display switch, not server authorization.'},
      /* wwEditor:end */
    },
    locale:{label:{en:'Language'},type:'TextSelect',section:'settings',bindable:true,defaultValue:'en',options:{options:[{value:'en',label:'English'},{value:'fr-CA',label:'Français'},{value:'zh-Hant',label:'繁體中文'},{value:'zh-Hans',label:'简体中文'}]},
      /* wwEditor:start */
      bindingValidation:{type:'string',tooltip:'en, fr-CA, zh-Hant or zh-Hans'},propertyHelp:{tooltip:'Formula notation and module tags remain universal.'},
      /* wwEditor:end */
    },
    theme:{label:{en:'Theme'},type:'TextSelect',section:'settings',bindable:true,defaultValue:'auto',options:{options:[{value:'auto',label:'System'},{value:'light',label:'Light'},{value:'dark',label:'Dark'}]},
      /* wwEditor:start */
      bindingValidation:{type:'string',tooltip:'Bind the app theme or use system preference'},propertyHelp:{tooltip:'Uses the existing InvestScape warm light and dark palettes.'},
      /* wwEditor:end */
    },
  },triggerEvents:[{name:'localeChange',label:{en:'On language change'},event:{value:'en'}}],actions:[],
};
