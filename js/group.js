// 학급 그룹 시스템 — 초대 코드 6자리 (혼동 문자 제외)
(function(){
  var LS_KEY = 'ssamji_group_v1';
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function makeCode(len){
    len = len || 6;
    var s = '';
    for(var i=0;i<len;i++) s += CODE_CHARS[Math.floor(Math.random()*CODE_CHARS.length)];
    return s;
  }

  var state = {
    code: null,       // 소속 그룹 코드
    name: null,       // 학급명
    role: 'member',   // 'admin' | 'member'
    myNickname: null  // 랭킹에 표시할 이름 (별명·이름 등)
  };

  function load(){
    try{
      var raw = localStorage.getItem(LS_KEY);
      if(raw){ state = Object.assign(state, JSON.parse(raw)); }
    }catch(e){}
  }
  function save(){
    try{ localStorage.setItem(LS_KEY, JSON.stringify(state)); }catch(e){}
  }

  // 그룹 생성 — Firestore에 신규 문서 만들고 초대 코드 발급
  async function createGroup(className, nickname){
    if(!SSAMJI_FB_READY) throw new Error('Firebase 인증이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.');
    var db = SSAMJI_FB_DB;
    // 겹치지 않는 코드 만들기 (최대 5회 재시도)
    var code = null;
    for(var i=0;i<5;i++){
      var c = makeCode(6);
      var snap = await db.collection('ssamji_groups').doc(c).get();
      if(!snap.exists){ code = c; break; }
    }
    if(!code) throw new Error('코드 생성 실패. 다시 시도해 주세요.');
    await db.collection('ssamji_groups').doc(code).set({
      name: className,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: SSAMJI_FB_UID,
      memberCount: 1
    });
    // 본인 멤버 등록
    await db.collection('ssamji_groups').doc(code)
      .collection('members').doc(SSAMJI_FB_UID).set({
        nickname: nickname,
        joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
        role: 'admin',
        totalValue: SSAMJI_PORT.summary().totalValue,
        returnPct: SSAMJI_PORT.summary().returnPct,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    state.code = code; state.name = className; state.role = 'admin'; state.myNickname = nickname;
    save();
    return code;
  }

  async function joinGroup(code, nickname){
    if(!SSAMJI_FB_READY) throw new Error('Firebase 인증이 아직 준비되지 않았어요.');
    code = (code||'').toUpperCase().trim();
    var db = SSAMJI_FB_DB;
    var snap = await db.collection('ssamji_groups').doc(code).get();
    if(!snap.exists) throw new Error('존재하지 않는 학급 코드입니다.');
    await db.collection('ssamji_groups').doc(code)
      .collection('members').doc(SSAMJI_FB_UID).set({
        nickname: nickname,
        joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
        role: 'member',
        totalValue: SSAMJI_PORT.summary().totalValue,
        returnPct: SSAMJI_PORT.summary().returnPct,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    state.code = code; state.name = snap.data().name; state.role = 'member'; state.myNickname = nickname;
    save();
    return true;
  }

  function leaveGroup(){
    if(SSAMJI_FB_READY && state.code){
      SSAMJI_FB_DB.collection('ssamji_groups').doc(state.code)
        .collection('members').doc(SSAMJI_FB_UID).delete().catch(function(){});
    }
    state.code = null; state.name = null; state.myNickname = null; state.role = 'member';
    save();
  }

  // 내 순위·수익률 동기화 (portfolio 변경 시 호출)
  async function pushMyStanding(){
    if(!SSAMJI_FB_READY || !state.code || !state.myNickname) return;
    var s = SSAMJI_PORT.summary();
    try{
      await SSAMJI_FB_DB.collection('ssamji_groups').doc(state.code)
        .collection('members').doc(SSAMJI_FB_UID).set({
          nickname: state.myNickname,
          totalValue: s.totalValue,
          returnPct: s.returnPct,
          daysPassed: s.daysPassed,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge:true });
    }catch(e){ console.warn('[SSAMJI] pushMyStanding 실패:', e.message); }
  }

  window.SSAMJI_GROUP = {
    load: load,
    save: save,
    state: state,
    createGroup: createGroup,
    joinGroup: joinGroup,
    leaveGroup: leaveGroup,
    pushMyStanding: pushMyStanding,
    getState: function(){ return state; }
  };
})();
