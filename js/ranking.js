// 학급 실시간 랭킹 — 수익률 내림차순
(function(){
  var unsub = null;
  var members = [];
  var listeners = [];

  function subscribe(){
    if(!SSAMJI_FB_READY) return;
    var g = SSAMJI_GROUP.getState();
    if(!g.code) return;
    if(unsub){ unsub(); unsub = null; }
    unsub = SSAMJI_FB_DB.collection('ssamji_groups').doc(g.code)
      .collection('members')
      .onSnapshot(function(snap){
        members = [];
        snap.forEach(function(doc){
          var d = doc.data();
          members.push({
            uid: doc.id,
            nickname: d.nickname || '익명',
            totalValue: d.totalValue || 0,
            returnPct: typeof d.returnPct === 'number' ? d.returnPct : 0,
            daysPassed: d.daysPassed || 0,
            role: d.role || 'member',
            updatedAt: d.updatedAt
          });
        });
        members.sort(function(a,b){ return b.returnPct - a.returnPct; });
        listeners.forEach(function(fn){ try{ fn(members); }catch(e){ console.warn(e); } });
      }, function(err){
        console.warn('[SSAMJI] 랭킹 구독 오류:', err.message);
      });
  }

  function unsubscribe(){
    if(unsub){ unsub(); unsub = null; }
    members = [];
    listeners.forEach(function(fn){ fn([]); });
  }

  window.SSAMJI_RANK = {
    subscribe: subscribe,
    unsubscribe: unsubscribe,
    getMembers: function(){ return members; },
    onChange: function(fn){ listeners.push(fn); return function(){ listeners = listeners.filter(f=>f!==fn); }; }
  };
})();
