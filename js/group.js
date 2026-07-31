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

  // PIN 해시 (SHA-256) — 원문 PIN은 저장하지 않음
  async function sha256(str){
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.prototype.map.call(new Uint8Array(buf), function(b){
      return ('0'+b.toString(16)).slice(-2);
    }).join('');
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
  async function createGroup(className, nickname, pin, submitDomain){
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
    var groupDoc = {
      name: className,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: SSAMJI_FB_UID,
      memberCount: 1
    };
    if(pin){ groupDoc.teacherPinHash = await sha256(String(pin)); }
    if(submitDomain){ groupDoc.submitDomain = String(submitDomain).toLowerCase().replace(/^@/,'').trim(); }
    await db.collection('ssamji_groups').doc(code).set(groupDoc);
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

  // 교사 — 학급 코드 + PIN으로 다른 기기에서도 교사 권한 잠금 해제
  // (member 문서는 만들지 않음 → 학생 랭킹에 안 뜸. pushMyStanding도 myNickname 없어 미전송)
  async function teacherLogin(code, pin){
    if(!SSAMJI_FB_READY) throw new Error('Firebase 연결이 필요해요.');
    code = (code||'').toUpperCase().trim();
    var snap = await SSAMJI_FB_DB.collection('ssamji_groups').doc(code).get();
    if(!snap.exists) throw new Error('존재하지 않는 학급 코드입니다.');
    var data = snap.data();
    if(!data.teacherPinHash) throw new Error('이 학급에는 교사 PIN이 설정되어 있지 않아요. 학급을 만든 기기에서 먼저 PIN을 설정해 주세요.');
    var h = await sha256(String(pin||''));
    if(h !== data.teacherPinHash) throw new Error('PIN이 올바르지 않습니다.');
    state.code = code; state.name = data.name; state.role = 'admin'; state.myNickname = null;
    save();
    return true;
  }

  // 교사 PIN 설정·변경 (학급 생성자·교사만)
  async function setTeacherPin(pin){
    if(!SSAMJI_FB_READY || !state.code) throw new Error('Firebase 연결이 필요해요.');
    if(state.role !== 'admin') throw new Error('교사만 PIN을 설정할 수 있어요.');
    if(!pin || String(pin).length < 4) throw new Error('PIN은 4자리 이상으로 정해 주세요.');
    var h = await sha256(String(pin));
    await SSAMJI_FB_DB.collection('ssamji_groups').doc(state.code).set({ teacherPinHash: h }, { merge:true });
    return true;
  }

  // 교사(그룹 생성자·PIN 로그인)만 true
  function isAdmin(){ return state.role === 'admin' && !!state.code; }

  // 선택한 학생들 포트폴리오 원격 초기화 요청
  // — 학생 기기의 localStorage는 교사가 직접 못 지우므로,
  //   member 문서에 resetAt 신호를 남기면 학생 앱이 이를 감지해 스스로 초기화한다.
  //   랭킹 수치도 즉시 시드머니로 낙관적 갱신(학생 재접속 전까지 표시용).
  async function requestReset(uids){
    if(!SSAMJI_FB_READY || !state.code) throw new Error('Firebase 연결이 필요해요.');
    if(!isAdmin()) throw new Error('교사(학급 생성자)만 초기화할 수 있어요.');
    if(!uids || !uids.length) return 0;
    var db = SSAMJI_FB_DB;
    var seed = (window.SSAMJI_PORT && SSAMJI_PORT.SEED_MONEY) || 10000000;
    var col = db.collection('ssamji_groups').doc(state.code).collection('members');
    var batch = db.batch();
    uids.forEach(function(uid){
      batch.set(col.doc(uid), {
        resetAt: firebase.firestore.FieldValue.serverTimestamp(),
        totalValue: seed,
        returnPct: 0,
        daysPassed: 0
      }, { merge:true });
    });
    await batch.commit();
    return uids.length;
  }

  // ──────────── 제출·채점 (과정평가) ────────────
  function emailDomain(email){ var i=(email||'').indexOf('@'); return i>=0 ? email.slice(i+1).toLowerCase() : ''; }

  // 익명 계정에 구글 신원 연결(linkWithPopup) — 같은 UID 유지해 그동안의 데이터 보존
  async function ensureGoogleIdentity(){
    if(!window.firebase) throw new Error('로그인 기능을 쓸 수 없어요.');
    var user = firebase.auth().currentUser;
    if(!user) throw new Error('로그인 준비 중이에요. 잠시 후 다시 시도해 주세요.');
    if(!user.isAnonymous && user.email) return user;   // 이미 구글 로그인됨
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt:'select_account' });
    try{
      var res = await user.linkWithPopup(provider);
      return res.user;
    }catch(e){
      // 이 구글 계정이 다른 익명계정에 이미 연결됨 → 그 계정으로 로그인 전환
      if(e.code==='auth/credential-already-in-use' || e.code==='auth/email-already-in-use'){
        var cred = e.credential ||
          (firebase.auth.GoogleAuthProvider.credentialFromError && firebase.auth.GoogleAuthProvider.credentialFromError(e));
        if(cred){ var r2 = await firebase.auth().signInWithCredential(cred); return r2.user; }
      }
      if(e.code==='auth/popup-blocked') throw new Error('팝업이 차단됐어요. 브라우저에서 팝업을 허용한 뒤 다시 시도해 주세요.');
      if(e.code==='auth/popup-closed-by-user' || e.code==='auth/cancelled-popup-request') throw new Error('로그인 창이 닫혔어요. 다시 시도해 주세요.');
      throw new Error('구글 로그인 실패: ' + (e.message || e.code));
    }
  }

  async function fetchGroupDoc(){
    var snap = await SSAMJI_FB_DB.collection('ssamji_groups').doc(state.code).get();
    return snap.exists ? snap.data() : null;
  }
  function subCol(){ return SSAMJI_FB_DB.collection('ssamji_groups').doc(state.code).collection('submissions'); }

  // 학생 제출 — 전체 과정 번들(bundle) + 첨부파일(files). 재제출 시 덮어씀(교사 평가는 보존)
  async function submitWork(bundle, files){
    if(!state.code) throw new Error('먼저 학급에 참가해 주세요.');
    var user = await ensureGoogleIdentity();
    // 학급 제출 도메인 제한 확인
    var g = await fetchGroupDoc();
    var dom = (g && g.submitDomain) ? String(g.submitDomain).toLowerCase() : '';
    if(dom && emailDomain(user.email) !== dom){
      try{ await user.unlink('google.com'); }catch(e){}   // 되돌려 다른 계정으로 재시도 가능하게
      throw new Error('이 학급은 «@'+dom+'» 계정만 제출할 수 있어요. 학교 계정으로 다시 시도해 주세요.');
    }
    var uid = user.uid;
    var doc = Object.assign({}, bundle, {
      name: user.displayName || bundle.nickname || '이름없음',
      email: user.email || '',
      nickname: state.myNickname || bundle.nickname || '',
      submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
      fileCount: (files||[]).length
    });
    try{
      await subCol().doc(uid).set(doc, { merge:true });   // merge → eval 보존
      // 첨부: 기존 파일 지우고 새로 저장 (각 문서 1MB 미만)
      var fcol = subCol().doc(uid).collection('files');
      try{
        var old = await fcol.get();
        await Promise.all(old.docs.map(function(d){ return d.ref.delete(); }));
      }catch(e){}
      for(var i=0;i<(files||[]).length;i++){
        await fcol.doc('f'+i).set({ name:files[i].name, type:files[i].type, dataUrl:files[i].dataUrl });
      }
    }catch(e){
      if(e.code === 'permission-denied'){
        throw new Error('아직 제출 기능이 열리지 않았어요. 선생님께 «제출 기능(Firestore 규칙)»을 켜달라고 알려주세요.');
      }
      throw e;
    }
    return { uid: uid, name: doc.name, email: doc.email };
  }

  async function getMySubmission(){
    if(!SSAMJI_FB_READY || !state.code || !SSAMJI_FB_UID) return null;
    var snap = await subCol().doc(SSAMJI_FB_UID).get();
    return snap.exists ? snap.data() : null;
  }

  // ── 교사용 ──
  function subscribeSubmissions(cb){
    if(!SSAMJI_FB_READY || !state.code) return function(){};
    return subCol().onSnapshot(function(snap){
      var arr = [];
      snap.forEach(function(d){ arr.push(Object.assign({ uid:d.id }, d.data())); });
      cb(arr);
    }, function(e){ console.warn('[SSAMJI] 제출 구독 오류:', e.message); });
  }
  async function getSubmissionFiles(uid){
    try{
      var snap = await subCol().doc(uid).collection('files').get();
      return snap.docs.map(function(d){ return d.data(); });
    }catch(e){ return []; }
  }
  async function saveEval(uid, ev){
    if(!isAdmin()) throw new Error('교사만 채점할 수 있어요.');
    await subCol().doc(uid).set({ eval: ev }, { merge:true });
  }
  async function setSubmitDomain(dom){
    if(!isAdmin()) throw new Error('교사만 설정할 수 있어요.');
    await SSAMJI_FB_DB.collection('ssamji_groups').doc(state.code)
      .set({ submitDomain: (dom||'').toLowerCase().replace(/^@/,'').trim() }, { merge:true });
  }
  async function getSubmitDomain(){ var g = await fetchGroupDoc(); return (g && g.submitDomain) || ''; }

  window.SSAMJI_GROUP = {
    load: load,
    save: save,
    state: state,
    createGroup: createGroup,
    joinGroup: joinGroup,
    leaveGroup: leaveGroup,
    pushMyStanding: pushMyStanding,
    isAdmin: isAdmin,
    requestReset: requestReset,
    teacherLogin: teacherLogin,
    setTeacherPin: setTeacherPin,
    ensureGoogleIdentity: ensureGoogleIdentity,
    submitWork: submitWork,
    getMySubmission: getMySubmission,
    subscribeSubmissions: subscribeSubmissions,
    getSubmissionFiles: getSubmissionFiles,
    saveEval: saveEval,
    setSubmitDomain: setSubmitDomain,
    getSubmitDomain: getSubmitDomain,
    getState: function(){ return state; }
  };
})();
