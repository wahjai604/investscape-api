export default {
  editor:{label:{en:'InvestScape Research library'},icon:'document'},staticRendering:true,
  properties:{
    heading:{label:{en:'Heading'},type:'Text',section:'settings',bindable:true,defaultValue:'Research',
      /* wwEditor:start */
      bindingValidation:{type:'string',tooltip:'Research heading'},propertyHelp:{tooltip:'Section title'},
      /* wwEditor:end */
    },
    enabled:{label:{en:'Enable reviewed runtime'},type:'OnOff',section:'settings',bindable:true,defaultValue:false,
      /* wwEditor:start */
      bindingValidation:{type:'boolean',tooltip:'False until live bindings are accepted'},propertyHelp:{tooltip:'Requires reviewed session host, API origins and access authority'},
      /* wwEditor:end */
    },
    apiOrigin:{label:{en:'Reviewed API origin'},type:'Text',section:'settings',bindable:true,defaultValue:'',
      /* wwEditor:start */
      bindingValidation:{type:'string',tooltip:'Exact HTTPS origin'},propertyHelp:{tooltip:'No keys, connection strings or tokens'},
      /* wwEditor:end */
    },
  },triggerEvents:[],actions:[],
};
