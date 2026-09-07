(function(){
  "use strict";

  // Modules InvestScape is willing to display. Anything outside this list is
  // dropped, not rendered — a compromised/rogue producer response cannot name
  // an arbitrary internal screen.
  var KNOWN_MODULES = ['property_overview', 'financial_summary'];

  function escapeHtml(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }

  // Reads both values once, then immediately scrubs them from the address bar
  // — before any await — so a refresh lands on a clean state instead of
  // silently retrying with a code that may already be gone, and the code
  // never appears in history/referrer/bookmarks.
  function consumeParams(){
    var sessionId = null, code = null;
    try{
      var q = new URLSearchParams(location.search);
      sessionId = q.get('launch_session');
      code = q.get('code');
    }catch(e){ return { sessionId:null, code:null }; }
    try{
      history.replaceState(null, '', location.pathname);
    }catch(e){ /* non-fatal: older browser or restricted context */ }
    return { sessionId: sessionId, code: code };
  }

  // Real exchange: POSTs to the investscape-api endpoint at the same origin
  // this page is served from. The endpoint fails closed (503) if Stage 1
  // isn't enabled in this environment, and the JSON body always carries a
  // `state` field regardless of HTTP status — so branch on that, not on
  // res.ok.
  function exchangeLaunchCode(sessionId, code){
    return fetch('/v1/lighthouse/launch/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ launchSessionId: sessionId, code: code })
    }).then(function(res){
      return res.json().catch(function(){ return null; });
    }).then(function(data){
      if(!data || typeof data.state !== 'string'){
        return { status: 'error' };
      }
      return {
        status: data.state,
        message: data.message,
        retryable: data.retryable,
        session: data.state === 'success' ? data : null
      };
    });
  }

  function view(state, detail){
    var S = {
      loading:{ icon:'', title:'Opening secure session…',
        body:'Verifying your Relationship OS authorization with InvestScape.' },
      invalid:{ icon:'⚠', title:'Invalid launch link',
        body:(detail && detail.message) || 'This link is not valid. Start the analysis again from Relationship OS.' },
      expired:{ icon:'⏱', title:'This link has expired',
        body:(detail && detail.message) || 'Return to Relationship OS and choose “Open in InvestScape” again.' },
      consumed:{ icon:'✓', title:'This link has already been used',
        body:(detail && detail.message) || 'Start a new analysis from Relationship OS to continue.' },
      unavailable:{ icon:'⛔', title:'Integration not available',
        body:(detail && detail.message) || 'The Relationship OS connection is not enabled in this environment. No analysis session was opened.' },
      error:{ icon:'↻', title:'Could not open the session',
        body:(detail && detail.message) || 'Something went wrong verifying this link. No analysis was created.' },
      success:{ icon:'✓', title:'Session verified',
        body:'Relationship OS authorized this analysis. Scope shown below is provided by the server.' }
    }[state] || { icon:'↻', title:'Could not open the session', body:'Something went wrong verifying this link.' };

    var ctx = '';
    if(state === 'success' && detail && detail.session){
      var s = detail.session;
      var mods = (s.modules || []).filter(function(m){ return KNOWN_MODULES.indexOf(m) !== -1; });
      var dropped = (s.modules || []).length - mods.length;
      ctx = '<div class="ctx">'
        + '<div class="id">' + escapeHtml(s.analysisId || '') + '</div>'
        + '<div><strong>Analysis</strong> · ' + escapeHtml(s.analysisType || '—') + '</div>'
        + '<div><strong>Modules</strong> · ' + (mods.length ? mods.map(escapeHtml).join(', ') : 'none')
        + (dropped > 0 ? ' <span style="color:var(--text-3);">(' + dropped + ' unrecognized ignored)</span>' : '') + '</div>'
        + '<div><strong>Scopes</strong> · ' + ((s.permittedScopes || []).map(escapeHtml).join(', ') || '—') + '</div>'
        + '</div>';
    }

    var retry = (state === 'error' && detail && detail.retryable)
      ? '<button class="btn gold" onclick="location.reload()">Try again</button>' : '';
    var cont = (state === 'success')
      ? '<button class="btn gold" disabled title="Next step not yet wired up">Continue to analysis</button>' : '';
    var spin = (state === 'loading')
      ? '<div class="spin"></div>' : '';

    return '<div class="card">'
      + '<div class="brand"><span>Invest</span>Scape</div>'
      + (S.icon ? '<div class="icon">' + S.icon + '</div>' : '')
      + '<div class="title">' + escapeHtml(S.title) + '</div>'
      + '<div class="body">' + escapeHtml(S.body) + '</div>'
      + spin + ctx + retry + cont
      + '<div class="foot">Secure session exchange with Relationship OS. No analysis is created and no relationship data is shown until this exchange succeeds.</div>'
      + '</div>';
  }

  function paint(state, detail){
    document.getElementById('app').innerHTML = view(state, detail);
  }

  function run(){
    var parsed = consumeParams();
    if(!parsed.sessionId || !parsed.code){ return void paint('invalid'); }
    paint('loading');
    exchangeLaunchCode(parsed.sessionId, parsed.code).then(function(res){
      var known = ['invalid','expired','consumed','unavailable','error','success'];
      paint(known.indexOf(res.status) !== -1 ? res.status : 'error', res);
    }).catch(function(){
      // Never surface the raw error — it could echo the code back into the DOM.
      paint('error');
    });
  }

  run();
})();