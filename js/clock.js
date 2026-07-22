// 시뮬레이션 클럭 — 1일 = N초 (기본 1초/일), ▶⏸⏩ 배속
(function(){
  var state = {
    dateIdx: 0,           // SSAMJI_DATES 배열 인덱스
    running: false,
    speed: 1,             // 배속 (1x, 2x, 5x, 10x)
    baseIntervalMs: 1000, // 1x일 때 하루 진행 시간
    timer: null,
    listeners: []
  };

  window.SSAMJI_CLOCK = {
    getIdx(){ return state.dateIdx; },
    getDate(){ return SSAMJI_DATES[state.dateIdx] || SSAMJI_DATES[0]; },
    isRunning(){ return state.running; },
    getSpeed(){ return state.speed; },
    setIdx(idx){
      state.dateIdx = Math.max(0, Math.min(idx, SSAMJI_DATES.length-1));
      _emit();
    },
    goToStart(){ this.setIdx(0); },
    goToEnd(){ this.setIdx(SSAMJI_DATES.length-1); },
    step(delta){
      var next = state.dateIdx + (delta||1);
      if(next >= SSAMJI_DATES.length){
        state.dateIdx = SSAMJI_DATES.length - 1;
        this.pause();
        _emit();
        return false;
      }
      state.dateIdx = Math.max(0, next);
      _emit();
      return true;
    },
    play(){
      if(state.running) return;
      state.running = true;
      _scheduleTick();
      _emit();
    },
    pause(){
      state.running = false;
      if(state.timer){ clearTimeout(state.timer); state.timer = null; }
      _emit();
    },
    toggle(){ if(state.running) this.pause(); else this.play(); },
    setSpeed(s){
      state.speed = s;
      if(state.running){ if(state.timer) clearTimeout(state.timer); _scheduleTick(); }
      _emit();
    },
    onChange(fn){ state.listeners.push(fn); return ()=>{ state.listeners = state.listeners.filter(f=>f!==fn); }; },
    save(){
      try{ localStorage.setItem('ssamji_clock_v1', JSON.stringify({ dateIdx: state.dateIdx })); }catch(e){}
    },
    restore(){
      try{
        var raw = localStorage.getItem('ssamji_clock_v1');
        if(raw){ var s = JSON.parse(raw); if(typeof s.dateIdx==='number') state.dateIdx = s.dateIdx; }
      }catch(e){}
    },
    reset(){ state.dateIdx = 0; this.pause(); _emit(); }
  };

  function _scheduleTick(){
    var interval = state.baseIntervalMs / state.speed;
    state.timer = setTimeout(function(){
      if(!state.running) return;
      var alive = SSAMJI_CLOCK.step(1);
      if(alive) _scheduleTick();
    }, interval);
  }
  function _emit(){
    var snap = { idx: state.dateIdx, date: SSAMJI_DATES[state.dateIdx], running: state.running, speed: state.speed };
    state.listeners.forEach(function(f){ try{ f(snap); }catch(e){ console.warn(e); } });
    SSAMJI_CLOCK.save();
  }
})();
