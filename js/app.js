// 메인 SPA — 뷰 라우팅, 시장·포트폴리오·거래일지·학습·랭킹, 모달 관리
(function(){
  var state = {
    activeTab: 'market',
    activeCategory: 'all',
    activeSearch: '',
    activeSort: 'name',
    selectedTicker: null,
    smRange: 'all',
    aiCache: {}   // ticker → AI 분석 결과 캐시
  };

  // ---------------- 유틸 ----------------
  function fmt(n){ return Number(n||0).toLocaleString('ko-KR'); }
  function fmtPct(p){ var s = (p>=0?'+':''); return s + (p*100).toFixed(2) + '%'; }
  function upDown(v){ return v>0?'up':(v<0?'down':''); }
  function $(id){ return document.getElementById(id); }
  function on(el, evt, fn){ if(el) el.addEventListener(evt, fn); }
  function toast(msg, type){
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast' + (type?' '+type:'');
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function(){ el.hidden = true; }, 3200);
  }

  // ---------------- 초기화 ----------------
  function init(){
    SSAMJI_CFG.load();
    SSAMJI_STOCKS; // ensure loaded
    buildAllPrices();
    SSAMJI_CLOCK.restore();
    SSAMJI_PORT.load();
    SSAMJI_GROUP.load();

    setupTabs();
    setupClockControls();
    setupSearch();
    setupSort();
    renderCategories();
    renderStocks();
    renderPortfolio();
    renderJournal();
    renderLearn();
    renderRanking();
    renderWallet();
    setupSettings();
    setupModals();

    // 반응: 클럭·포트 변경 → 화면 갱신
    SSAMJI_CLOCK.onChange(function(snap){
      $('clockDate').textContent = snap.date || '-';
      $('btnPlay').textContent = snap.running ? '⏸' : '▶';
      $('btnPlay').classList.toggle('playing', snap.running);
      $('speedSel').value = String(snap.speed);
      if(state.activeTab === 'market') renderStocks();
      if(state.activeTab === 'portfolio') renderPortfolio();
    });
    SSAMJI_PORT.onChange(function(snap){
      renderWallet();
      if(state.activeTab === 'portfolio') renderPortfolio();
      if(state.activeTab === 'learn') renderMissions();
      // Firebase 랭킹 자동 push (스로틀)
      throttleRankPush();
    });

    // Firebase 초기화 (선택 기능)
    setTimeout(function(){
      if(SSAMJI_CFG.get().firebaseEnabled && window.firebase){
        window.initFirebase && initFirebase();
        // 랭킹 준비되면 자동 구독 + 교사 초기화 신호 감시
        document.addEventListener('ssamji:firebase-ready', function(){
          // 교사가 보낸 초기화 신호(member.resetAt)를 감시 — 탭과 무관하게 항상 동작
          SSAMJI_RANK.onChange(handleResetSignal);
          if(SSAMJI_GROUP.getState().code){
            SSAMJI_RANK.subscribe();
          }
        });
      }
    }, 100);
  }
  document.addEventListener('DOMContentLoaded', init);

  // ---------------- 탭 ----------------
  function setupTabs(){
    document.querySelectorAll('.tab').forEach(function(t){
      on(t, 'click', function(){
        var name = t.dataset.tab;
        state.activeTab = name;
        document.querySelectorAll('.tab').forEach(function(x){ x.classList.toggle('active', x.dataset.tab===name); });
        document.querySelectorAll('.view').forEach(function(x){ x.classList.toggle('active', x.id === 'view-'+name); });
        if(name === 'market') renderStocks();
        if(name === 'portfolio') renderPortfolio();
        if(name === 'journal') renderJournal();
        if(name === 'learn') renderLearn();
        if(name === 'rank') renderRanking();
      });
    });
  }

  // ---------------- 클럭 ----------------
  function setupClockControls(){
    on($('btnPlay'), 'click', function(){ SSAMJI_CLOCK.toggle(); });
    on($('btnStep'), 'click', function(){ SSAMJI_CLOCK.step(1); });
    on($('btnRewind'), 'click', function(){
      if(confirm('처음 날짜로 되돌리시겠어요? 포트폴리오는 그대로 유지됩니다.')){
        SSAMJI_CLOCK.goToStart();
      }
    });
    on($('speedSel'), 'change', function(){ SSAMJI_CLOCK.setSpeed(Number(this.value)); });
    // 초기 상태 반영
    $('clockDate').textContent = SSAMJI_CLOCK.getDate() || '-';
    $('speedSel').value = '5';
    SSAMJI_CLOCK.setSpeed(5);
  }

  // ---------------- 검색·정렬·카테고리 ----------------
  function setupSearch(){
    on($('searchInput'), 'input', function(){
      state.activeSearch = this.value.trim();
      renderStocks();
    });
  }
  function setupSort(){
    on($('sortSel'), 'change', function(){
      state.activeSort = this.value;
      renderStocks();
    });
  }
  function renderCategories(){
    var box = $('catChips');
    var html = '<div class="cat-chip ' + (state.activeCategory==='all'?'on':'') + '" data-cat="all">전체</div>';
    Object.keys(SSAMJI_CATEGORIES).forEach(function(k){
      html += '<div class="cat-chip ' + (state.activeCategory===k?'on':'') + '" data-cat="'+k+'">' + SSAMJI_CATEGORIES[k] + '</div>';
    });
    box.innerHTML = html;
    box.querySelectorAll('.cat-chip').forEach(function(chip){
      on(chip, 'click', function(){
        state.activeCategory = chip.dataset.cat;
        renderCategories();
        renderStocks();
      });
    });
  }

  // ---------------- 시장 종목 그리드 ----------------
  function renderStocks(){
    var grid = $('stockGrid');
    var idx = SSAMJI_CLOCK.getIdx();
    var pf = SSAMJI_PORT.summary();
    var list = SSAMJI_STOCKS.slice();

    // 필터
    if(state.activeCategory !== 'all'){
      list = list.filter(function(s){ return s.category === state.activeCategory; });
    }
    if(state.activeSearch){
      var q = state.activeSearch.toLowerCase();
      list = list.filter(function(s){
        return s.name.toLowerCase().indexOf(q)>=0 || s.ticker.indexOf(q)>=0 || (s.products||[]).join(' ').toLowerCase().indexOf(q)>=0;
      });
    }

    // 각 종목의 오늘·전일 가격, 20일 스파크
    var enriched = list.map(function(s){
      var arr = SSAMJI_PRICES[s.ticker];
      var cur = arr[idx];
      var prev = idx>0 ? arr[idx-1] : cur;
      var change = (cur.close - prev.close) / prev.close;
      var start = Math.max(0, idx-19);
      var spark = arr.slice(start, idx+1).map(function(b){return b.close;});
      return { s:s, cur:cur, change:change, spark:spark, volume: cur.volume * cur.close };
    });

    // 정렬
    if(state.activeSort === 'up') enriched.sort(function(a,b){return b.change - a.change;});
    else if(state.activeSort === 'down') enriched.sort(function(a,b){return a.change - b.change;});
    else if(state.activeSort === 'vol') enriched.sort(function(a,b){return b.volume - a.volume;});
    else enriched.sort(function(a,b){return a.s.name.localeCompare(b.s.name, 'ko');});

    grid.innerHTML = enriched.map(function(e){
      var hold = pf.holdings[e.s.ticker];
      var holdBadge = hold && hold.qty>0 ? '<div class="sc-hold">'+hold.qty+'주</div>' : '';
      var cls = upDown(e.change);
      var sign = e.change>=0?'+':'';
      return '<div class="stock-card" data-ticker="'+e.s.ticker+'">' +
        holdBadge +
        '<div class="sc-top">' +
          '<div>' +
            '<div class="sc-logo">'+e.s.logo+'</div>' +
            '<div class="sc-name">'+e.s.name+'</div>' +
            '<div class="sc-sect">'+e.s.sector+'</div>' +
          '</div>' +
          '<div class="sc-tick">'+e.s.ticker+'</div>' +
        '</div>' +
        '<div class="sc-spark"><canvas></canvas></div>' +
        '<div class="sc-price-row">' +
          '<div class="sc-price">'+fmt(e.cur.close)+'원</div>' +
          '<div class="sc-change '+cls+'">'+sign+(e.change*100).toFixed(2)+'%</div>' +
        '</div>' +
      '</div>';
    }).join('') || '<p style="grid-column:1/-1;text-align:center;color:var(--muted);padding:40px 0;">해당하는 종목이 없어요.</p>';

    // 스파크라인 그리기 + 클릭
    grid.querySelectorAll('.stock-card').forEach(function(card, i){
      var canvas = card.querySelector('.sc-spark canvas');
      if(canvas && enriched[i]) drawSpark(canvas, enriched[i].spark);
      on(card, 'click', function(){ openStockModal(card.dataset.ticker); });
    });
  }

  // ---------------- 종목 상세 모달 ----------------
  function openStockModal(ticker){
    state.selectedTicker = ticker;
    state.smRange = 'all';
    var stock = SSAMJI_STOCKS.find(function(s){return s.ticker===ticker;});
    if(!stock) return;
    renderStockModal();
    $('stockModal').hidden = false;
  }
  function renderStockModal(){
    var ticker = state.selectedTicker;
    var stock = SSAMJI_STOCKS.find(function(s){return s.ticker===ticker;});
    var idx = SSAMJI_CLOCK.getIdx();
    var arr = SSAMJI_PRICES[ticker];
    var cur = arr[idx];
    var prev = idx>0?arr[idx-1]:cur;
    var change = (cur.close - prev.close) / prev.close;
    var pf = SSAMJI_PORT.summary();
    var hold = pf.holdings[ticker];

    // 범위별 데이터
    var rangeBars;
    if(state.smRange === '1m') rangeBars = arr.slice(Math.max(0,idx-20), idx+1);
    else if(state.smRange === '3m') rangeBars = arr.slice(Math.max(0,idx-63), idx+1);
    else if(state.smRange === '6m') rangeBars = arr.slice(Math.max(0,idx-126), idx+1);
    else if(state.smRange === '1y') rangeBars = arr.slice(Math.max(0,idx-252), idx+1);
    else rangeBars = arr.slice(0, idx+1);

    var firstBar = rangeBars[0];
    var rangeReturn = firstBar ? (cur.close - firstBar.close) / firstBar.close : 0;

    var maxAff = Math.floor(pf.cash / cur.close);

    $('smBody').innerHTML =
      '<div class="sm-hdr">' +
        '<div class="sm-logo">'+stock.logo+'</div>' +
        '<div class="sm-title">' +
          '<div class="sm-name">'+stock.name+'</div>' +
          '<div class="sm-sect">'+stock.sector+' · '+stock.ticker+'</div>' +
        '</div>' +
      '</div>' +
      '<div class="sm-price-row">' +
        '<div class="sm-price">'+fmt(cur.close)+'원</div>' +
        '<div class="sm-change '+upDown(change)+'">'+(change>=0?'+':'')+(change*100).toFixed(2)+'% (전일 대비)</div>' +
      '</div>' +
      '<div class="sm-range-tabs">' +
        ['1m','3m','6m','1y','all'].map(function(r){
          var lbl = r==='1m'?'1개월':(r==='3m'?'3개월':(r==='6m'?'6개월':(r==='1y'?'1년':'전체')));
          return '<button class="sm-range-tab '+(state.smRange===r?'active':'')+'" data-range="'+r+'">'+lbl+'</button>';
        }).join('') +
        '<span style="margin-left:12px;font-size:12px;color:var(--muted);">기간 수익률 <b class="'+upDown(rangeReturn)+'" style="color:'+(rangeReturn>=0?'var(--up)':'var(--down)')+';">'+(rangeReturn>=0?'+':'')+(rangeReturn*100).toFixed(2)+'%</b></span>' +
      '</div>' +
      '<div class="sm-chart"><canvas id="smChart"></canvas></div>' +
      '<div class="sm-company">' +
        '<h4>💡 이 회사는 뭘 만드나요?</h4>' +
        '<div class="sm-desc">'+stock.description+'</div>' +
        '<div class="sm-products">' + stock.products.map(function(p){return '<span class="sm-product-chip">'+p+'</span>';}).join('') + '</div>' +
      '</div>' +
      (SSAMJI_AI.isEnabled() ? '<button class="sm-ai-btn" id="btnAiAnalyze">✨ AI 애널리스트에게 설명 듣기</button>' : '') +
      '<div class="sm-ai-box" id="smAiBox" hidden></div>' +
      '<div class="sm-trade">' +
        '<div class="sm-trade-box buy">' +
          '<h4>🔴 매수 (사기)</h4>' +
          '<div class="sm-trade-row">주식 수 <input type="number" id="buyQty" min="1" value="1"> 주</div>' +
          '<div class="sm-trade-row">현재가 '+fmt(cur.close)+'원</div>' +
          '<div class="sm-trade-row">보유 현금 '+fmt(pf.cash)+'원 (최대 '+maxAff+'주)</div>' +
          '<div class="sm-trade-row total">총 비용 <span id="buyTotal">'+fmt(cur.close)+'</span>원</div>' +
          '<textarea class="sm-reason" id="buyReason" placeholder="왜 사려고 하나요? (선택) — 예) 신제품 갤럭시가 잘 팔릴 것 같아서"></textarea>' +
          '<button class="btn-primary up" id="btnBuy">매수하기</button>' +
        '</div>' +
        '<div class="sm-trade-box sell">' +
          '<h4>🔵 매도 (팔기)</h4>' +
          (hold && hold.qty>0 ?
            '<div class="sm-trade-row">보유 '+hold.qty+'주 (평균 '+fmt(hold.avgPrice)+'원)</div>' +
            '<div class="sm-trade-row">주식 수 <input type="number" id="sellQty" min="1" max="'+hold.qty+'" value="'+Math.min(1,hold.qty)+'"> 주</div>' +
            '<div class="sm-trade-row">평가손익 <b class="'+upDown(cur.close-hold.avgPrice)+'" style="color:'+((cur.close-hold.avgPrice)>=0?'var(--up)':'var(--down)')+';">'+fmt((cur.close-hold.avgPrice)*hold.qty)+'원</b></div>' +
            '<div class="sm-trade-row total">예상 수령 <span id="sellTotal">'+fmt(cur.close)+'</span>원</div>' +
            '<textarea class="sm-reason" id="sellReason" placeholder="왜 팔려고 하나요? (선택)"></textarea>' +
            '<button class="btn-primary down" id="btnSell">매도하기</button>'
            :
            '<p style="text-align:center;color:var(--muted);padding:20px 0;">보유하고 있지 않은 종목입니다.</p>'
          ) +
        '</div>' +
      '</div>';

    // 차트 그리기
    setTimeout(function(){
      var c = $('smChart');
      if(c) drawChart(c, rangeBars, { mode:'line' });
    }, 10);

    // 이벤트 바인딩
    document.querySelectorAll('.sm-range-tab').forEach(function(btn){
      on(btn, 'click', function(){ state.smRange = btn.dataset.range; renderStockModal(); });
    });
    var bq = $('buyQty'); if(bq) on(bq, 'input', function(){ $('buyTotal').textContent = fmt(cur.close * (Number(bq.value)||0)); });
    var sq = $('sellQty'); if(sq) on(sq, 'input', function(){ $('sellTotal').textContent = fmt(cur.close * (Number(sq.value)||0)); });
    on($('btnBuy'), 'click', function(){
      try{
        var q = Number($('buyQty').value)||0;
        var r = ($('buyReason').value||'').trim();
        var res = SSAMJI_PORT.buy(ticker, q, r);
        toast(stock.name+' '+q+'주 매수 완료 (수수료 '+fmt(res.fee)+'원)', 'ok');
        // AI 코치
        if(SSAMJI_AI.isEnabled() && r){ runAiCoach(stock, {type:'buy',qty:q,price:res.price}, r); }
        renderStockModal();
      }catch(e){ toast('❌ '+e.message, 'err'); }
    });
    on($('btnSell'), 'click', function(){
      try{
        var q = Number($('sellQty').value)||0;
        var r = ($('sellReason').value||'').trim();
        var res = SSAMJI_PORT.sell(ticker, q, r);
        var pnlMsg = res.realizedPnl>=0 ? ('+' + fmt(res.realizedPnl) + '원 이익') : (fmt(res.realizedPnl) + '원 손실');
        toast(stock.name+' '+q+'주 매도 완료 ('+pnlMsg+')', res.realizedPnl>=0?'ok':'err');
        if(SSAMJI_AI.isEnabled() && r){ runAiCoach(stock, {type:'sell',qty:q,price:res.price}, r); }
        renderStockModal();
      }catch(e){ toast('❌ '+e.message, 'err'); }
    });
    on($('btnAiAnalyze'), 'click', function(){
      var box = $('smAiBox');
      box.hidden = false;
      box.classList.add('loading');
      box.textContent = '🤖 AI가 분석 중...';
      if(state.aiCache[ticker]){ box.classList.remove('loading'); box.textContent = state.aiCache[ticker]; return; }
      var idx = SSAMJI_CLOCK.getIdx();
      var barsToUse = arr.slice(0, idx+1);
      SSAMJI_AI.analyzeStock(stock, barsToUse).then(function(txt){
        state.aiCache[ticker] = txt;
        box.classList.remove('loading');
        box.textContent = txt;
      }).catch(function(e){
        box.classList.remove('loading');
        box.textContent = '❌ ' + e.message;
      });
    });
  }

  function runAiCoach(stock, trade, reason){
    var box = $('smAiBox');
    box.hidden = false;
    box.classList.add('loading');
    box.textContent = '💬 AI 코치가 근거를 검토 중...';
    SSAMJI_AI.coachTrade(trade, stock, reason).then(function(txt){
      box.classList.remove('loading');
      box.textContent = '[AI 코치 피드백]\n\n' + txt;
    }).catch(function(e){
      box.classList.remove('loading');
      box.textContent = '❌ AI 코치 오류: ' + e.message;
    });
  }

  // ---------------- 포트폴리오 뷰 ----------------
  function renderPortfolio(){
    var pf = SSAMJI_PORT.summary();
    var idx = SSAMJI_CLOCK.getIdx();
    var tickers = Object.keys(pf.holdings).filter(function(t){return pf.holdings[t].qty>0;});
    var box = $('pfHoldings');
    if(tickers.length === 0){
      box.innerHTML =
        '<div class="pf-empty">' +
          '<h4>보유한 종목이 없어요</h4>' +
          '<p>「📊 시장」 탭에서 종목을 골라 매수해 보세요.</p>' +
        '</div>';
      return;
    }
    var rows = tickers.map(function(t){
      var stock = SSAMJI_STOCKS.find(function(s){return s.ticker===t;});
      var h = pf.holdings[t];
      var cur = priceAt(t, idx);
      var evalVal = cur.close * h.qty;
      var costVal = h.avgPrice * h.qty;
      var pnl = evalVal - costVal;
      var pnlPct = pnl / costVal;
      return { stock:stock, h:h, cur:cur, evalVal:evalVal, costVal:costVal, pnl:pnl, pnlPct:pnlPct };
    }).sort(function(a,b){return b.evalVal - a.evalVal;});

    box.innerHTML = rows.map(function(r){
      var cls = upDown(r.pnl);
      var color = r.pnl>=0?'var(--up)':'var(--down)';
      return '<div class="pf-row" data-ticker="'+r.stock.ticker+'">' +
        '<div class="pf-logo">'+r.stock.logo+'</div>' +
        '<div class="pf-info">' +
          '<div class="pf-name">'+r.stock.name+' <span style="font-size:11px;color:var(--muted)">'+r.stock.ticker+'</span></div>' +
          '<div class="pf-sect">'+r.stock.sector+'</div>' +
        '</div>' +
        '<div class="pf-col"><div class="pf-col-lbl">수량</div><div class="pf-col-val">'+r.h.qty+'주</div></div>' +
        '<div class="pf-col"><div class="pf-col-lbl">평단</div><div class="pf-col-val">'+fmt(r.h.avgPrice)+'원</div></div>' +
        '<div class="pf-col"><div class="pf-col-lbl">현재가</div><div class="pf-col-val">'+fmt(r.cur.close)+'원</div></div>' +
        '<div class="pf-col pf-col-eval">' +
          '<div class="pf-col-lbl">평가금액 · 손익</div>' +
          '<div class="pf-col-val">'+fmt(r.evalVal)+'원</div>' +
          '<div class="pf-col-val '+cls+'" style="color:'+color+'">'+(r.pnl>=0?'+':'')+fmt(r.pnl)+'원 ('+(r.pnlPct*100).toFixed(2)+'%)</div>' +
        '</div>' +
      '</div>';
    }).join('');
    box.querySelectorAll('.pf-row').forEach(function(row){
      on(row, 'click', function(){ openStockModal(row.dataset.ticker); });
    });
  }

  // ---------------- 거래일지 ----------------
  function renderJournal(){
    var pf = SSAMJI_PORT.summary();
    var box = $('jnList');
    if(!pf.trades || pf.trades.length===0){
      box.innerHTML = '<div class="pf-empty"><h4>아직 거래가 없어요</h4><p>매수·매도를 하면 여기에 기록이 남아요.</p></div>';
      return;
    }
    box.innerHTML = pf.trades.map(function(t){
      var stock = SSAMJI_STOCKS.find(function(s){return s.ticker===t.ticker;});
      var isBuy = t.type==='buy';
      var pnlHtml = '';
      if(!isBuy && typeof t.realizedPnl === 'number'){
        var cls = t.realizedPnl>=0?'up':'down';
        pnlHtml = '<div class="jn-pnl '+cls+'">' + (t.realizedPnl>=0?'+':'') + fmt(t.realizedPnl) + '원</div>';
      }
      return '<div class="jn-row '+(isBuy?'buy':'sell')+'">' +
        '<div>' +
          '<div class="jn-type '+(isBuy?'buy':'sell')+'">'+(isBuy?'🔴 매수':'🔵 매도')+'</div>' +
          '<div style="font-size:11px;color:var(--muted)">'+t.date+'</div>' +
        '</div>' +
        '<div class="jn-main">' +
          '<div class="jn-name">'+(stock?stock.logo+' '+stock.name:t.ticker)+'</div>' +
          '<div class="jn-detail">'+t.qty+'주 × '+fmt(t.price)+'원 (수수료 '+fmt(t.fee||0)+(t.tax?' · 세금 '+fmt(t.tax):'')+'원)</div>' +
          (t.reason ? '<div class="jn-reason">💬 '+escapeHtml(t.reason)+'</div>' : '') +
        '</div>' +
        '<div>' +
          '<div class="jn-total">'+(isBuy?'-':'+')+fmt(t.total)+'원</div>' +
          pnlHtml +
        '</div>' +
      '</div>';
    }).join('');
  }
  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  // ---------------- 학습 ----------------
  function renderLearn(){
    renderMissions();
    renderConcepts();
  }
  function renderMissions(){
    var s = SSAMJI_PORT.summary();
    var box = $('missionGrid');
    box.innerHTML = SSAMJI_MISSIONS.map(function(m){
      var done = m.check(s);
      return '<div class="mission-card '+(done?'done':'')+'">' +
        '<div class="mc-icon">'+(done?'✅':'⭕')+'</div>' +
        '<div class="mc-title">'+m.title+'</div>' +
        '<div class="mc-desc">'+m.desc+'</div>' +
        '<div class="mc-reward">'+m.reward+'</div>' +
      '</div>';
    }).join('');
  }
  function renderConcepts(){
    var box = $('conceptGrid');
    box.innerHTML = SSAMJI_CONCEPTS.map(function(c){
      return '<div class="concept-card">' +
        '<div class="cc-icon">'+c.icon+'</div>' +
        '<div class="cc-title">'+c.title+'</div>' +
        '<div class="cc-body">'+c.body+'</div>' +
      '</div>';
    }).join('');
  }

  // ---------------- 지갑 요약 ----------------
  function renderWallet(){
    var s = SSAMJI_PORT.summary();
    $('wTotal').textContent = fmt(s.totalValue) + '원';
    $('wCash').textContent = fmt(s.cash) + '원';
    var ret = $('wReturn');
    ret.textContent = (s.returnPct>=0?'+':'') + (s.returnPct*100).toFixed(2) + '%';
    ret.className = 'wl-val ' + upDown(s.returnPct);
    $('wDays').textContent = s.daysPassed + '일';
  }

  // ---------------- 학급 랭킹 ----------------
  function renderRanking(){
    var g = SSAMJI_GROUP.getState();
    var actions = $('rkActions');
    var status = $('rkStatus');
    var list = $('rkList');
    if(!g.code){
      actions.innerHTML = '<button class="btn-plain" id="btnJoinGroup">🏫 학급 참가하기</button>';
      status.textContent = '학급에 참가하지 않았어요. 선생님께 학급 코드를 받아 참가하면 반 친구들과 수익률 랭킹을 겨룰 수 있어요.';
      list.innerHTML = '<div class="rk-empty">📊 개인 모드에서는 랭킹이 표시되지 않아요.</div>';
      on($('btnJoinGroup'), 'click', function(){ $('groupGate').hidden = false; });
      return;
    }
    actions.innerHTML =
      '<span style="color:var(--muted);font-size:13px;">학급: <b style="color:var(--brand)">'+escapeHtml(g.name||'')+'</b> (' + g.code + ') · 별명 '+escapeHtml(g.myNickname||'')+'</span>' +
      '<button class="btn-plain sm" id="btnLeaveGroup">나가기</button>';
    on($('btnLeaveGroup'), 'click', function(){
      if(confirm('학급을 나가시겠어요? 랭킹에서 삭제됩니다.')){
        SSAMJI_GROUP.leaveGroup();
        SSAMJI_RANK.unsubscribe();
        renderRanking();
      }
    });
    if(!SSAMJI_FB_READY){
      status.textContent = '🔄 Firebase에 연결 중...';
      list.innerHTML = '';
      return;
    }
    SSAMJI_RANK.subscribe();
    var members = SSAMJI_RANK.getMembers();
    if(members.length === 0){
      status.textContent = '👥 아직 다른 참가자가 없어요.';
    } else {
      status.textContent = '👥 총 ' + members.length + '명이 참여 중이에요. 수익률 순으로 정렬됩니다.';
    }
    renderRankList(members);
    SSAMJI_RANK.onChange(function(list){
      var g = SSAMJI_GROUP.getState();
      if(!g.code) return;
      renderRankList(list);
      status.textContent = '👥 총 ' + list.length + '명이 참여 중이에요.';
    });
  }
  function renderRankList(members){
    var list = $('rkList');
    renderTeacherPanel(members);
    if(!members || members.length===0){
      list.innerHTML = '<div class="rk-empty">아직 참가자가 없어요. 학급 코드를 친구들에게 공유해 보세요!</div>';
      return;
    }
    list.innerHTML = members.map(function(m, i){
      var me = m.uid === SSAMJI_FB_UID;
      var cls = upDown(m.returnPct);
      return '<div class="rk-row '+(me?'me':'')+'">' +
        '<div class="rk-num">'+(i===0?'🥇':i===1?'🥈':i===2?'🥉':(i+1))+'</div>' +
        '<div class="rk-nick">'+escapeHtml(m.nickname||'익명')+(me?' <span style="color:var(--gold);font-size:11px">(나)</span>':'')+'</div>' +
        '<div class="rk-val">'+fmt(m.totalValue)+'원</div>' +
        '<div class="rk-ret '+cls+'">'+(m.returnPct>=0?'+':'')+(m.returnPct*100).toFixed(2)+'%</div>' +
      '</div>';
    }).join('');
  }

  // ---------------- 교사용 원격 초기화 ----------------
  var tpChecked = {};   // uid → 체크 여부 (잦은 랭킹 갱신에도 선택 유지)

  function renderTeacherPanel(members){
    var box = $('rkTeacher');
    if(!box) return;
    if(!SSAMJI_GROUP.isAdmin()){ box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    var others = (members||[]).filter(function(m){ return m.uid !== SSAMJI_FB_UID; });
    // 사라진 학생은 선택 목록에서 제거
    var present = {}; others.forEach(function(m){ present[m.uid]=1; });
    Object.keys(tpChecked).forEach(function(u){ if(!present[u]) delete tpChecked[u]; });

    if(others.length === 0){
      box.innerHTML = '<div class="tp-head">🎓 교사 관리</div>' +
        '<div class="tp-hint">학생이 학급에 참가하면 여기에서 개별로 초기화할 수 있어요.</div>';
      return;
    }
    box.innerHTML =
      '<div class="tp-head">🎓 교사 관리 · 학생 포트폴리오 초기화</div>' +
      '<div class="tp-hint">초기화할 학생을 선택하세요. 선택한 학생 기기에서 시드머니 1천만원으로 자동 초기화됩니다.</div>' +
      '<div class="tp-list">' +
      others.map(function(m){
        return '<label class="tp-item">' +
          '<input type="checkbox" class="tp-ck" value="'+m.uid+'"'+(tpChecked[m.uid]?' checked':'')+'>' +
          '<span class="tp-nick">'+escapeHtml(m.nickname||'익명')+'</span>' +
          '<span class="tp-val">'+fmt(m.totalValue)+'원 · '+(m.returnPct>=0?'+':'')+(m.returnPct*100).toFixed(1)+'%</span>' +
        '</label>';
      }).join('') +
      '</div>' +
      '<div class="tp-actions">' +
      '<label class="tp-all"><input type="checkbox" id="tpAll"> 전체 선택</label>' +
      '<button class="btn-primary sm" id="btnTpReset">선택 학생 초기화</button>' +
      '</div>';

    box.querySelectorAll('.tp-ck').forEach(function(c){
      on(c, 'change', function(){ tpChecked[this.value] = this.checked; syncTpAll(box); });
    });
    on($('tpAll'), 'change', function(){
      var v = this.checked;
      box.querySelectorAll('.tp-ck').forEach(function(c){ c.checked = v; tpChecked[c.value] = v; });
    });
    syncTpAll(box);
    on($('btnTpReset'), 'click', function(){
      var uids = Array.prototype.slice.call(box.querySelectorAll('.tp-ck:checked')).map(function(c){ return c.value; });
      if(uids.length === 0){ toast('초기화할 학생을 먼저 선택하세요.', 'warn'); return; }
      if(!confirm('선택한 ' + uids.length + '명의 포트폴리오를 초기화할까요?\n학생 기기에서 시드머니 1천만원으로 되돌아갑니다. 되돌릴 수 없어요.')) return;
      SSAMJI_GROUP.requestReset(uids).then(function(n){
        uids.forEach(function(u){ delete tpChecked[u]; });
        toast('✅ ' + n + '명 초기화 요청 완료. 학생 화면에 곧 반영됩니다.', 'ok');
      }).catch(function(e){ toast('초기화 실패: ' + e.message, 'warn'); });
    });
  }
  function syncTpAll(box){
    var all = box.querySelectorAll('.tp-ck');
    var checked = box.querySelectorAll('.tp-ck:checked');
    var el = $('tpAll');
    if(el && all.length){ el.checked = (all.length === checked.length); }
  }

  // 학생 측: 교사가 보낸 초기화 신호 감지 → 스스로 초기화
  function handleResetSignal(members){
    if(!SSAMJI_FB_UID) return;
    var me = null;
    for(var i=0;i<members.length;i++){ if(members[i].uid === SSAMJI_FB_UID){ me = members[i]; break; } }
    if(!me || !me.resetAt) return;
    var ack = parseInt(localStorage.getItem('ssamji_reset_ack_v1') || '0', 10);
    if(me.resetAt <= ack) return;
    localStorage.setItem('ssamji_reset_ack_v1', String(me.resetAt));
    // 교사가 나(학급 생성자) 자신을 초기화하는 경우는 드물지만, 신호가 오면 동일 처리
    SSAMJI_PORT.reset();
    SSAMJI_CLOCK.reset();
    renderWallet();
    renderPortfolio();
    renderStocks();
    renderJournal();
    if(state.activeTab === 'learn') renderMissions();
    toast('👩‍🏫 선생님이 포트폴리오를 초기화했어요. 시드머니 1천만원으로 다시 시작해요!', 'ok');
    SSAMJI_GROUP.pushMyStanding();
  }

  // 랭킹 push 스로틀 (3초에 한 번)
  var pushTimer = null;
  function throttleRankPush(){
    if(!SSAMJI_FB_READY || !SSAMJI_GROUP.getState().code) return;
    if(pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function(){
      SSAMJI_GROUP.pushMyStanding();
    }, 3000);
  }

  // ---------------- 설정 모달 ----------------
  function setupSettings(){
    on($('btnSettings'), 'click', function(){ openSettings(); });
    on($('btnSaveKey'), 'click', function(){
      var provider = $('aiProvider').value;
      var key = $('aiKey').value.trim();
      SSAMJI_CFG.setKey(provider, key);
      SSAMJI_CFG.set({ aiProvider: provider });
      toast('저장 완료', 'ok');
    });
    on($('btnResetAll'), 'click', function(){
      if(confirm('정말 모든 데이터를 초기화하시겠어요? (시드머니 1천만원부터 다시)')){
        SSAMJI_PORT.reset();
        SSAMJI_CLOCK.reset();
        toast('초기화 완료', 'ok');
        closeSettings();
      }
    });
    document.querySelectorAll('input[name=aiMode]').forEach(function(r){
      on(r, 'change', function(){ SSAMJI_CFG.set({aiMode: this.value}); });
    });
    on($('aiProvider'), 'change', function(){
      SSAMJI_CFG.set({aiProvider: this.value});
      $('aiKey').value = SSAMJI_CFG.getKey(this.value);
    });
    on($('btnAiJournal'), 'click', function(){
      runAiJournal();
    });

    // 그룹 게이트 이벤트
    document.querySelectorAll('.grp-tab').forEach(function(t){
      on(t, 'click', function(){
        document.querySelectorAll('.grp-tab').forEach(function(x){x.classList.remove('active');});
        t.classList.add('active');
        var isJoin = t.dataset.grp === 'join';
        $('grpJoin').hidden = !isJoin;
        $('grpCreate').hidden = isJoin;
      });
    });
    on($('btnGrpJoin'), 'click', async function(){
      var nick = $('gjNick').value.trim();
      var code = $('gjCode').value.trim().toUpperCase();
      if(!nick){ toast('별명을 입력해 주세요', 'err'); return; }
      if(code.length !== 6){ toast('학급 코드는 6자리예요', 'err'); return; }
      try{
        await SSAMJI_GROUP.joinGroup(code, nick);
        toast('학급에 참가했어요!', 'ok');
        $('groupGate').hidden = true;
        renderRanking();
      }catch(e){ toast('❌ '+e.message, 'err'); }
    });
    on($('btnGrpCreate'), 'click', async function(){
      var name = $('gcName').value.trim();
      var nick = $('gcNick').value.trim();
      if(!name || !nick){ toast('학급명·별명을 입력해 주세요', 'err'); return; }
      try{
        var code = await SSAMJI_GROUP.createGroup(name, nick);
        prompt('학급 코드가 발급됐어요. 학생들에게 이 코드를 알려주세요:', code);
        toast('학급 생성 완료: '+code, 'ok');
        $('groupGate').hidden = true;
        renderRanking();
      }catch(e){ toast('❌ '+e.message, 'err'); }
    });
    on($('btnGrpSkip'), 'click', function(){ $('groupGate').hidden = true; });
  }
  function openSettings(){
    var c = SSAMJI_CFG.get();
    document.querySelectorAll('input[name=aiMode]').forEach(function(r){ r.checked = (r.value === c.aiMode); });
    $('aiProvider').value = c.aiProvider;
    $('aiKey').value = c.keys[c.aiProvider] || '';
    // 그룹 박스
    var g = SSAMJI_GROUP.getState();
    if(g.code){
      $('grpBox').innerHTML =
        '<p>참가 중: <b>'+escapeHtml(g.name||'')+'</b> ('+g.code+') · 별명 '+escapeHtml(g.myNickname||'')+'</p>' +
        '<button class="btn-plain sm" id="stgLeave">학급 나가기</button>';
      on($('stgLeave'), 'click', function(){
        if(confirm('학급에서 나가시겠어요?')){ SSAMJI_GROUP.leaveGroup(); SSAMJI_RANK.unsubscribe(); openSettings(); }
      });
    } else {
      $('grpBox').innerHTML =
        '<p>아직 학급에 참가하지 않았어요.</p>' +
        '<button class="btn-plain sm" id="stgJoin">🏫 학급 참가·만들기</button>';
      on($('stgJoin'), 'click', function(){ $('settingsModal').hidden = true; $('groupGate').hidden = false; });
    }
    $('settingsModal').hidden = false;
  }
  function closeSettings(){ $('settingsModal').hidden = true; }

  function setupModals(){
    document.querySelectorAll('[data-close-modal]').forEach(function(btn){
      on(btn, 'click', function(){
        var mb = btn.closest('.modal-back');
        if(mb) mb.hidden = true;
      });
    });
    document.querySelectorAll('.modal-back').forEach(function(mb){
      on(mb, 'click', function(e){
        if(e.target === mb) mb.hidden = true;
      });
    });
  }

  // AI 학습일지 생성
  function runAiJournal(){
    var box = $('jnAiBox');
    box.hidden = false;
    box.classList.add('loading');
    box.textContent = '🤖 AI가 학습일지 작성 중...';
    if(!SSAMJI_AI.isEnabled()){
      box.classList.remove('loading');
      box.textContent = '⚠️ AI 기능이 꺼져 있어요. ⚙️ 설정에서 켜주세요.';
      return;
    }
    var s = SSAMJI_PORT.summary();
    var idx = SSAMJI_CLOCK.getIdx();
    // 종목별 성과 계산
    var perf = [];
    Object.keys(s.holdings).forEach(function(t){
      var h = s.holdings[t]; if(!h||h.qty<=0) return;
      var stock = SSAMJI_STOCKS.find(function(x){return x.ticker===t;});
      var cur = priceAt(t, idx);
      var pct = ((cur.close - h.avgPrice)/h.avgPrice*100).toFixed(1);
      perf.push({name: stock.name, pct: pct, val: (cur.close-h.avgPrice)*h.qty});
    });
    // 실현 손익도 함께
    s.trades.filter(function(t){return t.type==='sell';}).forEach(function(t){
      var stock = SSAMJI_STOCKS.find(function(x){return x.ticker===t.ticker;});
      var pct = ((t.realizedPnl||0)/((t.price*t.qty)||1)*100).toFixed(1);
      perf.push({name: (stock?stock.name:t.ticker)+' (매도)', pct: pct, val: t.realizedPnl||0});
    });
    perf.sort(function(a,b){return b.val - a.val;});
    var summary = {
      startDate: SSAMJI_DATES[0],
      endDate: SSAMJI_DATES[idx],
      seedMoney: s.seedMoney,
      totalValue: s.totalValue,
      returnPct: s.returnPct,
      tradeCount: s.trades.length,
      topGainers: perf.slice(0, 3),
      topLosers: perf.slice(-3).reverse()
    };
    SSAMJI_AI.generateJournal(summary).then(function(txt){
      box.classList.remove('loading');
      box.textContent = txt;
    }).catch(function(e){
      box.classList.remove('loading');
      box.textContent = '❌ ' + e.message;
    });
  }
})();
