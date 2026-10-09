export default {
  editor:{label:{en:'InvestScape map access administration'},icon:'user-group'},
  staticRendering:true,
  properties:{
    enabled:{label:{en:'Connect approval service'},type:'OnOff',section:'settings',bindable:true,defaultValue:false,
      /* wwEditor:start */
      bindingValidation:{type:'boolean',tooltip:'Enable only with the reviewed Dev host installed.'},
      propertyHelp:{tooltip:'Defaults off. Editing mode never connects or permits changes.'},
      /* wwEditor:end */
    },
    apiOrigin:{label:{en:'Dev API origin'},type:'Text',section:'settings',bindable:true,defaultValue:'',
      /* wwEditor:start */
      bindingValidation:{type:'string',tooltip:'Exact HTTPS origin, without paths or credentials.'},
      propertyHelp:{tooltip:'No default endpoint. The existing session host must be explicitly installed.'},
      /* wwEditor:end */
    }
  },
  triggerEvents:[],actions:[]
};
