// 설정 (BYOK + 학교 공용 API + 개인 별명)
(function(){
  var LS_KEY = 'ssamji_settings_v1';
  var DEFAULT = {
    aiMode: 'off',              // 'off' | 'school' | 'personal'
    aiProvider: 'claude',       // 'claude' | 'gemini' | 'openai'
    keys: { claude:'', gemini:'', openai:'' },
    schoolWorkerUrl: 'https://ssuk-api-proxy.samluv.workers.dev',
    firebaseEnabled: true
  };
  var state = JSON.parse(JSON.stringify(DEFAULT));

  function load(){
    try{
      var raw = localStorage.getItem(LS_KEY);
      if(raw){ state = Object.assign(JSON.parse(JSON.stringify(DEFAULT)), JSON.parse(raw)); }
    }catch(e){}
  }
  function save(){
    try{ localStorage.setItem(LS_KEY, JSON.stringify(state)); }catch(e){}
  }
  function getKey(provider){ return (state.keys||{})[provider||state.aiProvider] || ''; }
  function setKey(provider, key){ state.keys[provider] = key; save(); }

  window.SSAMJI_CFG = {
    load: load,
    save: save,
    get: function(){ return state; },
    set: function(patch){ Object.assign(state, patch); save(); },
    getKey: getKey,
    setKey: setKey
  };
})();
