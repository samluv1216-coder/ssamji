// Firebase 설정 — 학급 랭킹·그룹 코드 (선택)
// ⚠️ 여기에 saenggibu-checker(또는 자신의 Firebase) 프로젝트 값을 넣으면
//    학급 랭킹 기능이 켜집니다. 빈 값이면 개인 로컬 모드로만 작동해요.
// Firebase Console → 프로젝트 설정 → 웹 앱 SDK 스니펫에서 복사하세요.
window.SSAMJI_FIREBASE_CONFIG = {
  // saenggibu-checker 프로젝트 재사용 (쑥·쌤·쓱과 동일)
  apiKey: "AIzaSyDmgi65q2MSyPzd2nT3uEgqV5OaVRFx1PA",
  authDomain: "saenggibu-checker.firebaseapp.com",
  projectId: "saenggibu-checker",
  storageBucket: "saenggibu-checker.firebasestorage.app",
  messagingSenderId: "788021237813",
  appId: "1:788021237813:web:54140ed65d597a9cd3b97c"
};

// Firebase SDK 로드 상태
window.SSAMJI_FB_READY = false;
window.SSAMJI_FB_DB = null;
window.SSAMJI_FB_UID = null;

window.SSAMJI_FB_USER = null;   // 현재 인증 사용자 (익명 또는 구글)

window.initFirebase = function(){
  if(!window.firebase || !SSAMJI_FIREBASE_CONFIG.apiKey) return false;
  try{
    if(!firebase.apps.length){
      firebase.initializeApp(SSAMJI_FIREBASE_CONFIG);
    }
    SSAMJI_FB_DB = firebase.firestore();
    var dispatched = false;
    // ⚠️ signInAnonymously를 무조건 호출하면 저장된 구글 로그인이 익명으로 덮여
    //    제출 신원이 사라짐. → 저장된 사용자가 있으면 유지, 없을 때만 익명 로그인.
    firebase.auth().onAuthStateChanged(function(user){
      if(user){
        SSAMJI_FB_UID = user.uid;
        SSAMJI_FB_USER = user;
        SSAMJI_FB_READY = true;
        console.log('[SSAMJI] 인증:', user.isAnonymous ? '익명' : ('구글 '+(user.email||'')), SSAMJI_FB_UID.slice(0,8));
        if(!dispatched){ dispatched = true; document.dispatchEvent(new CustomEvent('ssamji:firebase-ready')); }
        document.dispatchEvent(new CustomEvent('ssamji:auth-changed'));
      } else {
        firebase.auth().signInAnonymously().catch(function(e){
          console.warn('[SSAMJI] 익명 인증 실패:', e.message);
        });
      }
    });
    return true;
  }catch(e){
    console.warn('[SSAMJI] Firebase 초기화 실패:', e.message);
    return false;
  }
};
