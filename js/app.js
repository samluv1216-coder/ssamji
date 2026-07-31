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
    setupNews();
    setupReflect();

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
          updateAdminUI();
          if(state.activeTab === 'reflect') refreshSubmitStatus();
        });
        // 로그인 상태 바뀌면(구글 연결 등) 제출 상태·교사탭 갱신
        document.addEventListener('ssamji:auth-changed', function(){
          updateAdminUI();
          if(state.activeTab === 'reflect') refreshSubmitStatus();
        });
      }
    }, 100);
    updateAdminUI();
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
        if(name === 'news') renderNews();
        if(name === 'learn') renderLearn();
        if(name === 'reflect') renderReflect();
        if(name === 'rank') renderRanking();
        if(name === 'grade') renderGrade();
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
  var conceptWired = false;
  function renderLearn(){
    renderMissions();
    if(!conceptWired){
      conceptWired = true;
      on($('conceptSearch'), 'input', function(){
        $('conceptClear').hidden = !this.value;
        renderConcepts(this.value);
      });
      on($('conceptClear'), 'click', function(){
        var inp = $('conceptSearch'); inp.value=''; this.hidden = true; renderConcepts(''); inp.focus();
      });
    }
    renderConcepts($('conceptSearch') ? $('conceptSearch').value : '');
  }
  // 검색어를 HTML-escape 후 안전하게 하이라이트
  function hlText(text, q){
    var esc = escapeHtml(text);
    if(!q) return esc;
    var eq = escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try{ return esc.replace(new RegExp(eq, 'gi'), function(m){ return '<mark>'+m+'</mark>'; }); }
    catch(e){ return esc; }
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
  function renderConcepts(q){
    var box = $('conceptGrid');
    var query = (q||'').trim().toLowerCase();
    var list = SSAMJI_CONCEPTS.filter(function(c){
      if(!query) return true;
      var hay = (c.title+' '+c.body+' '+(c.keywords||'')+' '+(c.cat||'')).toLowerCase();
      return hay.indexOf(query) !== -1;
    });
    var cnt = $('conceptCount');
    if(cnt) cnt.textContent = query ? ('검색 결과 '+list.length+'개') : ('총 '+SSAMJI_CONCEPTS.length+'개');
    if(list.length === 0){
      box.innerHTML = '<div class="cc-empty">‘'+escapeHtml(q)+'’에 대한 개념이 없어요.<br>다른 단어로 검색해 보세요. (예: 배당, 금리, 분산, 복리)</div>';
      return;
    }
    box.innerHTML = list.map(function(c){
      return '<div class="concept-card">' +
        '<div class="cc-top"><span class="cc-icon">'+c.icon+'</span>' +
        (c.cat?'<span class="cc-cat">'+escapeHtml(c.cat)+'</span>':'') + '</div>' +
        '<div class="cc-title">'+hlText(c.title, query)+'</div>' +
        '<div class="cc-body">'+hlText(c.body, query)+'</div>' +
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
        renderRanking(); updateAdminUI();
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
    // 교사(본인·admin)는 초기화 대상에서 제외
    var others = (members||[]).filter(function(m){ return m.uid !== SSAMJI_FB_UID && m.role !== 'admin'; });
    // 사라진 학생은 선택 목록에서 제거
    var present = {}; others.forEach(function(m){ present[m.uid]=1; });
    Object.keys(tpChecked).forEach(function(u){ if(!present[u]) delete tpChecked[u]; });

    var pinBtn = '<button class="btn-plain sm" id="btnSetPin">🔐 교사 PIN 설정·변경</button>';
    if(others.length === 0){
      box.innerHTML = '<div class="tp-head">🎓 교사 관리</div>' +
        '<div class="tp-hint">학생이 학급에 참가하면 여기에서 개별로 초기화할 수 있어요.</div>' +
        '<div class="tp-actions" style="justify-content:flex-end">' + pinBtn + '</div>';
      wirePinBtn(box);
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
      '<span style="display:flex;gap:8px">' + pinBtn +
      '<button class="btn-primary sm" id="btnTpReset">선택 학생 초기화</button></span>' +
      '</div>';

    wirePinBtn(box);
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
  function wirePinBtn(box){
    on($('btnSetPin'), 'click', function(){
      var pin = prompt('교사 PIN을 정하세요 (4자리 이상 숫자 권장).\n다른 기기에서 「교사 로그인」에 사용합니다.');
      if(pin === null) return;
      pin = String(pin).trim();
      if(pin.length < 4){ toast('PIN은 4자리 이상으로 정해 주세요.', 'warn'); return; }
      SSAMJI_GROUP.setTeacherPin(pin).then(function(){
        toast('🔐 교사 PIN이 설정되었어요.', 'ok');
      }).catch(function(e){ toast('PIN 설정 실패: ' + e.message, 'warn'); });
    });
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

  // ---------------- 오늘의 뉴스 ----------------
  var newsDate = null;   // 뉴스 탭에서 보고 있는 날짜 (YYYY-MM-DD)

  function clampNewsDate(s){
    var N = SSAMJI_NEWS, min = N.fmt(SSAMJI_SIM_START), max = N.fmt(SSAMJI_SIM_END);
    if(s < min) return min;
    if(s > max) return max;
    return s;
  }
  function shiftNewsDate(days){
    var d = SSAMJI_NEWS.toDate(newsDate); d.setDate(d.getDate()+days);
    newsDate = clampNewsDate(SSAMJI_NEWS.fmt(d));
    renderNews();
  }
  function setupNews(){
    // 관련 종목 드롭다운 채우기 (지수 + 30종목)
    var sel = $('nnStock');
    if(sel && sel.options.length <= 1){
      var opt = document.createElement('option'); opt.value='__index'; opt.textContent='증시 전반 (코스피/코스닥)'; sel.appendChild(opt);
      SSAMJI_STOCKS.forEach(function(s){
        var o = document.createElement('option'); o.value=s.ticker; o.textContent=s.name+' ('+s.sector+')'; sel.appendChild(o);
      });
    }
    on($('nwPrev'), 'click', function(){ shiftNewsDate(-1); });
    on($('nwNext'), 'click', function(){ shiftNewsDate(1); });
    on($('nwToday'), 'click', function(){ newsDate = SSAMJI_CLOCK.getDate(); renderNews(); });
    on($('nwDate'), 'change', function(){ if(this.value){ newsDate = clampNewsDate(this.value); renderNews(); } });
    on($('nwSearchBtn'), 'click', function(){ doNewsSearch($('nwQuery').value.trim()); });
    on($('nwQuery'), 'keydown', function(e){ if(e.key==='Enter') doNewsSearch(this.value.trim()); });
    on($('nnSave'), 'click', saveIssueNote);
    on($('nnPrint'), 'click', printNotes);
  }
  function doNewsSearch(q){
    if(!q){ toast('검색어를 입력하세요.', 'warn'); return; }
    window.open(SSAMJI_NEWS.naverNewsUrl(q, newsDate), '_blank', 'noopener');
  }
  function renderNews(){
    if(!newsDate) newsDate = SSAMJI_CLOCK.getDate() || SSAMJI_NEWS.fmt(SSAMJI_SIM_START);
    newsDate = clampNewsDate(newsDate);
    if($('nwDate')) $('nwDate').value = newsDate;

    // 주요 이슈 카드
    var list = $('nwList');
    var items = SSAMJI_NEWS.newsForDate(newsDate, 21);
    if(items.length === 0){
      list.innerHTML = '<div class="nw-empty">이 날짜 주변엔 등록된 주요 이슈가 없어요.<br>아래 <b>실제 뉴스 검색</b>으로 그날의 소식을 직접 찾아보세요!</div>';
    } else {
      list.innerHTML = items.map(function(n){
        var dirCls = n.dir==='up'?'up':(n.dir==='down'?'down':'mixed');
        var dirTxt = n.dir==='up'?'▲ 상승 요인':(n.dir==='down'?'▼ 하락 요인':'↕ 혼조');
        var secs = SSAMJI_NEWS.sectorLabels(n.sectors).map(function(s){ return '<span class="nw-sec-chip">'+escapeHtml(s)+'</span>'; }).join('');
        return '<article class="nw-card '+dirCls+'">' +
          '<div class="nw-card-top"><span class="nw-date-b">'+n.date+'</span>' +
          '<span class="nw-dir '+dirCls+'">'+dirTxt+'</span></div>' +
          '<h4>'+escapeHtml(n.title)+'</h4>' +
          '<p class="nw-body">'+escapeHtml(n.body)+'</p>' +
          '<div class="nw-secs">'+secs+'</div>' +
          '<p class="nw-think">💭 '+escapeHtml(n.think)+'</p>' +
          '<button class="btn-plain sm nw-usebtn" data-title="'+escapeHtml(n.title)+'">📝 이 이슈 기록하기</button>' +
        '</article>';
      }).join('');
      list.querySelectorAll('.nw-usebtn').forEach(function(b){
        on(b, 'click', function(){
          $('nnText').value = b.getAttribute('data-title');
          $('nnText').focus();
          $('nnText').scrollIntoView({behavior:'smooth', block:'center'});
        });
      });
    }

    // 빠른 검색 버튼
    var quick = $('nwQuick');
    if(quick){
      var qs = ['코스피','코스닥','반도체','금리','전기차 배터리','환율'];
      quick.innerHTML = qs.map(function(q){ return '<button class="nw-qbtn" data-q="'+escapeHtml(q)+'">'+escapeHtml(q)+'</button>'; }).join('');
      quick.querySelectorAll('.nw-qbtn').forEach(function(b){
        on(b, 'click', function(){ doNewsSearch(b.getAttribute('data-q')); });
      });
    }

    renderIssueNotes();
  }
  function saveIssueNote(){
    var text = $('nnText').value.trim();
    if(!text){ toast('이슈 내용을 적어주세요.', 'warn'); return; }
    var stockVal = $('nnStock').value;
    var stockName = '';
    if(stockVal === '__index') stockName = '증시 전반';
    else if(stockVal){ var s = SSAMJI_STOCKS.find(function(x){return x.ticker===stockVal;}); stockName = s?s.name:''; }
    SSAMJI_NEWS.addNote({ date:newsDate, text:text, ticker:stockVal, stockName:stockName, expect:$('nnExpect').value });
    $('nnText').value=''; $('nnStock').value=''; $('nnExpect').value='';
    toast('📝 기록지에 저장했어요.', 'ok');
    renderIssueNotes();
  }
  function expectBadge(e){
    if(e==='up') return '<span class="nn-exp up">▲ 오를듯</span>';
    if(e==='down') return '<span class="nn-exp down">▼ 내릴듯</span>';
    if(e==='none') return '<span class="nn-exp">모름</span>';
    return '';
  }
  function renderIssueNotes(){
    var notes = SSAMJI_NEWS.getNotes();
    var box = $('nnList');
    $('nnCount').textContent = notes.length ? ('총 '+notes.length+'개 기록') : '';
    if(!notes.length){ box.innerHTML = '<div class="nw-empty">아직 기록한 이슈가 없어요. 위에서 이슈를 찾아 적어보세요!</div>'; return; }
    box.innerHTML = notes.map(function(n){
      return '<div class="nn-item">' +
        '<div class="nn-item-main">' +
          '<span class="nn-date-b">'+n.date+'</span>' +
          (n.stockName?'<span class="nn-stock-b">'+escapeHtml(n.stockName)+'</span>':'') +
          expectBadge(n.expect) +
          '<p class="nn-item-text">'+escapeHtml(n.text)+'</p>' +
        '</div>' +
        '<button class="nn-del" data-id="'+n.id+'" title="삭제">🗑️</button>' +
      '</div>';
    }).join('');
    box.querySelectorAll('.nn-del').forEach(function(b){
      on(b, 'click', function(){
        if(confirm('이 기록을 삭제할까요?')){ SSAMJI_NEWS.deleteNote(b.getAttribute('data-id')); renderIssueNotes(); }
      });
    });
  }
  function printNotes(){
    var notes = SSAMJI_NEWS.getNotes();
    if(!notes.length){ toast('인쇄할 기록이 없어요.', 'warn'); return; }
    var g = SSAMJI_GROUP.getState();
    var who = (g && g.myNickname) ? g.myNickname : '';
    var rows = notes.slice().reverse().map(function(n, i){
      var exp = n.expect==='up'?'▲ 오를듯':(n.expect==='down'?'▼ 내릴듯':(n.expect==='none'?'모름':''));
      return '<tr><td>'+(i+1)+'</td><td>'+n.date+'</td><td>'+escapeHtml(n.stockName||'')+'</td>'+
             '<td>'+escapeHtml(exp)+'</td><td>'+escapeHtml(n.text)+'</td></tr>';
    }).join('');
    var html = '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>이슈 기록지</title>'+
      '<style>body{font-family:"Malgun Gothic",sans-serif;padding:24px;color:#111}'+
      'h1{font-size:20px;margin:0 0 4px}.sub{color:#666;font-size:13px;margin:0 0 16px}'+
      'table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:7px 9px;font-size:13px;text-align:left;vertical-align:top}'+
      'th{background:#eee}td:nth-child(1){width:34px;text-align:center}td:nth-child(2){width:92px}td:nth-child(3){width:110px}td:nth-child(4){width:70px;text-align:center}'+
      '@media print{@page{size:A4;margin:14mm}}</style></head><body>'+
      '<h1>📝 쌈지 이슈 기록지</h1><p class="sub">'+(who?('이름/별명: '+escapeHtml(who)+' · '):'')+'총 '+notes.length+'개</p>'+
      '<table><thead><tr><th>#</th><th>날짜</th><th>관련 종목</th><th>예상</th><th>이슈 내용</th></tr></thead>'+
      '<tbody>'+rows+'</tbody></table></body></html>';
    var w = window.open('', '_blank');
    if(!w){ toast('팝업이 차단되었어요. 팝업을 허용해 주세요.', 'warn'); return; }
    w.document.write(html); w.document.close();
    w.onload = function(){ w.focus(); w.print(); };
  }

  // ---------------- 수업 성찰지 ----------------
  var REFLECT_KEY = 'ssamji_reflect_v1';
  var reflectData = null;
  var RF_FIELDS = ['rfQ1','rfQ2','rfQ3','rfQ4','rfP1','rfP2','rfP3'];

  function loadReflect(){
    try{ reflectData = JSON.parse(localStorage.getItem(REFLECT_KEY)); }catch(e){}
    if(!reflectData || typeof reflectData !== 'object'){
      reflectData = { q1:'',q2:'',q3:'',q4:'', p1:'',p2:'',p3:'', files:[] };
    }
    if(!Array.isArray(reflectData.files)) reflectData.files = [];
    return reflectData;
  }
  function saveReflect(){
    try{ localStorage.setItem(REFLECT_KEY, JSON.stringify(reflectData)); return true; }
    catch(e){
      toast('저장 공간이 부족해요. 첨부파일을 줄여 주세요.', 'warn');
      return false;
    }
  }
  function setupReflect(){
    loadReflect();
    // 텍스트 입력 → 자동 저장
    RF_FIELDS.forEach(function(id){
      var key = id.slice(2).toLowerCase();   // rfQ1 → q1, rfP1 → p1
      on($(id), 'input', function(){ reflectData[key] = this.value; saveReflect(); });
    });
    on($('rfSave'), 'click', function(){
      RF_FIELDS.forEach(function(id){ reflectData[id.slice(2).toLowerCase()] = $(id).value; });
      if(saveReflect()) toast('💾 저장했어요.', 'ok');
    });
    on($('rfPrint'), 'click', printReflect);
    on($('rfFileBtn'), 'click', function(){ $('rfFile').click(); });
    on($('rfFile'), 'change', function(){ handleReflectFiles(this.files); this.value=''; });
    on($('rfSubmit'), 'click', submitToTeacher);
  }
  function renderReflect(){
    loadReflect();
    $('rfQ1').value = reflectData.q1||''; $('rfQ2').value = reflectData.q2||'';
    $('rfQ3').value = reflectData.q3||''; $('rfQ4').value = reflectData.q4||'';
    $('rfP1').value = reflectData.p1||''; $('rfP2').value = reflectData.p2||''; $('rfP3').value = reflectData.p3||'';
    renderReflectFiles();
    refreshSubmitStatus();
  }

  // ── 전체 과정 제출 ──
  function buildSubmissionBundle(){
    // 성찰 입력 최신값 반영
    RF_FIELDS.forEach(function(id){ if($(id)) reflectData[id.slice(2).toLowerCase()] = $(id).value; });
    var s = SSAMJI_PORT.summary();
    var nameOf = function(tk){ var st = SSAMJI_STOCKS.find(function(x){return x.ticker===tk;}); return st?st.name:tk; };
    var catOf = function(tk){ var st = SSAMJI_STOCKS.find(function(x){return x.ticker===tk;}); return st?st.category:''; };
    var trades = (s.trades||[]).map(function(t){
      return { type:t.type, ticker:t.ticker, name:nameOf(t.ticker), qty:t.qty, price:t.price,
               date:t.date, reason:t.reason||'', realizedPnl:t.realizedPnl||0 };
    });
    var holdings = Object.keys(s.holdings||{}).map(function(tk){
      var h=s.holdings[tk]; return { ticker:tk, name:nameOf(tk), qty:h.qty, avgPrice:h.avgPrice };
    }).filter(function(h){ return h.qty>0; });
    var reasoned = trades.filter(function(t){ return t.reason && t.reason.length>=5; }).length;
    var sectors = {}; holdings.forEach(function(h){ var c=catOf(h.ticker); if(c) sectors[c]=1; });
    var badges = SSAMJI_MISSIONS.filter(function(m){ try{ return m.check(s); }catch(e){ return false; } })
      .map(function(m){ return { title:m.title, reward:m.reward }; });
    var notes = SSAMJI_NEWS.getNotes();
    return {
      summary: {
        totalValue:s.totalValue, cash:s.cash, returnPct:s.returnPct, seedMoney:s.seedMoney,
        daysPassed:s.daysPassed, currentDate:s.currentDate,
        tradeCount:trades.length, reasonedCount:reasoned, sectorCount:Object.keys(sectors).length,
        buyCount:trades.filter(function(t){return t.type==='buy';}).length,
        sellCount:trades.filter(function(t){return t.type==='sell';}).length,
        noteCount:notes.length, badgeCount:badges.length
      },
      holdings: holdings,
      trades: trades.slice(0, 500),   // 안전상 최대 500건
      notes: notes,
      reflection: { q1:reflectData.q1||'', q2:reflectData.q2||'', q3:reflectData.q3||'', q4:reflectData.q4||'',
                    p1:reflectData.p1||'', p2:reflectData.p2||'', p3:reflectData.p3||'' },
      badges: badges
    };
  }
  async function submitToTeacher(){
    if(!SSAMJI_GROUP.getState().code){
      toast('먼저 학급에 참가해 주세요.', 'warn'); $('groupGate').hidden = false; return;
    }
    var btn = $('rfSubmit'); var old = btn.textContent;
    btn.disabled = true; btn.textContent = '제출 중…';
    try{
      var bundle = buildSubmissionBundle();
      var r = await SSAMJI_GROUP.submitWork(bundle, reflectData.files || []);
      toast('✅ 제출 완료! (' + r.name + ')', 'ok');
      refreshSubmitStatus();
    }catch(e){ toast('❌ ' + e.message, 'err'); }
    finally{ btn.disabled = false; btn.textContent = old; }
  }
  function refreshSubmitStatus(){
    var st = $('rfSubmitStatus'), ev = $('rfEvalBox');
    if(!st) return;
    if(!SSAMJI_GROUP.getState().code){ st.textContent = '학급에 참가하면 제출할 수 있어요.'; if(ev) ev.hidden = true; return; }
    st.textContent = '확인 중…';
    SSAMJI_GROUP.getMySubmission().then(function(sub){
      if(!sub){ st.textContent = '아직 제출하지 않았어요.'; if(ev) ev.hidden = true; return; }
      st.innerHTML = '✅ 제출됨' + (sub.name?(' · <b>'+escapeHtml(sub.name)+'</b>'):'');
      // 교사 평가가 있으면 학생에게도 보여줌
      if(ev){
        if(sub.eval && (typeof sub.eval.total==='number' || sub.eval.comment)){
          ev.hidden = false;
          ev.innerHTML = '<div class="rf-eval-h">🧑‍🏫 선생님 평가</div>' +
            (typeof sub.eval.total==='number' ? '<div class="rf-eval-score">'+sub.eval.total+'점</div>' : '') +
            (sub.eval.comment ? '<p class="rf-eval-cmt">'+escapeHtml(sub.eval.comment)+'</p>' : '');
        } else { ev.hidden = true; }
      }
    }).catch(function(){ st.textContent = ''; });
  }
  function handleReflectFiles(fileList){
    var files = Array.prototype.slice.call(fileList||[]);
    if(!files.length) return;
    if(reflectData.files.length + files.length > 5){ toast('첨부는 최대 5개까지예요.', 'warn'); return; }
    files.forEach(function(f){
      fileToDataUrl(f, function(res){
        if(res === '__TOOBIG__'){ toast('「'+f.name+'」은(는) 2MB를 넘어 첨부할 수 없어요.', 'warn'); return; }
        if(!res){ toast('「'+f.name+'」 첨부에 실패했어요.', 'warn'); return; }
        reflectData.files.push({ name:f.name, type:f.type, dataUrl:res });
        if(saveReflect()) renderReflectFiles();
      });
    });
  }
  function fileToDataUrl(file, cb){
    if(file.type && file.type.indexOf('image/')===0){
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function(){
        var max=1200, w=img.width, h=img.height;
        if(w>max || h>max){ var r=Math.min(max/w, max/h); w=Math.round(w*r); h=Math.round(h*r); }
        var cv=document.createElement('canvas'); cv.width=w; cv.height=h;
        cv.getContext('2d').drawImage(img,0,0,w,h);
        URL.revokeObjectURL(url);
        try{ cb(cv.toDataURL('image/jpeg', 0.8)); }catch(e){ cb(null); }
      };
      img.onerror = function(){ URL.revokeObjectURL(url); cb(null); };
      img.src = url;
    } else {
      if(file.size > 2*1024*1024){ cb('__TOOBIG__'); return; }
      var fr = new FileReader();
      fr.onload = function(){ cb(fr.result); };
      fr.onerror = function(){ cb(null); };
      fr.readAsDataURL(file);
    }
  }
  function renderReflectFiles(){
    var box = $('rfFiles');
    if(!box) return;
    var fs = reflectData.files || [];
    if(!fs.length){ box.innerHTML = ''; return; }
    box.innerHTML = fs.map(function(f, i){
      var isImg = (f.type||'').indexOf('image/')===0;
      var thumb = isImg
        ? '<img src="'+f.dataUrl+'" alt="">'
        : '<div class="rf-fileicon">📄</div>';
      return '<div class="rf-file">' + thumb +
        '<span class="rf-fname">'+escapeHtml(f.name)+'</span>' +
        '<button class="rf-fdel" data-i="'+i+'" title="삭제">✕</button>' +
      '</div>';
    }).join('');
    box.querySelectorAll('.rf-fdel').forEach(function(b){
      on(b, 'click', function(){
        var i = parseInt(b.getAttribute('data-i'),10);
        reflectData.files.splice(i,1);
        saveReflect(); renderReflectFiles();
      });
    });
  }
  function printReflect(){
    RF_FIELDS.forEach(function(id){ reflectData[id.slice(2).toLowerCase()] = $(id).value; });
    saveReflect();
    var g = SSAMJI_GROUP.getState();
    var who = (g && g.myNickname) ? g.myNickname : '';
    var qa = [
      ['이번 모의투자에서 가장 기억에 남는 순간(거래)은?', reflectData.q1],
      ['내가 잘한 점은?', reflectData.q2],
      ['아쉬웠던 점과 다음 다짐은?', reflectData.q3],
      ['감정 관리·새로 알게 된 경제 개념은?', reflectData.q4]
    ].map(function(x){
      return '<div class="qa"><div class="q">'+escapeHtml(x[0])+'</div><div class="a">'+escapeHtml(x[1]||'').replace(/\n/g,'<br>')+'</div></div>';
    }).join('');
    var prs = [reflectData.p1, reflectData.p2, reflectData.p3].map(function(p,i){
      return '<li>'+escapeHtml(p||'')+'</li>';
    }).join('');
    var imgs = (reflectData.files||[]).filter(function(f){ return (f.type||'').indexOf('image/')===0; })
      .map(function(f){ return '<img src="'+f.dataUrl+'" style="max-width:100%;margin:6px 0;border:1px solid #ccc">'; }).join('');
    var otherFiles = (reflectData.files||[]).filter(function(f){ return (f.type||'').indexOf('image/')!==0; })
      .map(function(f){ return '<li>'+escapeHtml(f.name)+'</li>'; }).join('');
    var html = '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>수업 성찰지</title>'+
      '<style>body{font-family:"Malgun Gothic",sans-serif;padding:24px;color:#111;line-height:1.6}'+
      'h1{font-size:21px;margin:0 0 4px}.sub{color:#666;font-size:13px;margin:0 0 18px}'+
      'h2{font-size:15px;margin:18px 0 8px;border-bottom:2px solid #333;padding-bottom:4px}'+
      '.qa{margin-bottom:12px}.q{font-weight:700;font-size:13px;margin-bottom:3px}'+
      '.a{font-size:13px;border:1px solid #ccc;border-radius:6px;padding:8px 10px;min-height:34px;white-space:pre-wrap}'+
      'ol{padding-left:22px}ol li{font-size:14px;margin-bottom:6px}'+
      '@media print{@page{size:A4;margin:14mm}}</style></head><body>'+
      '<h1>📔 쌈지 수업 성찰지</h1><p class="sub">'+(who?('이름/별명: '+escapeHtml(who)):'')+'</p>'+
      '<h2>✍️ 돌아보기</h2>'+qa+
      '<h2>💡 나만의 금융 원칙 3가지</h2><ol>'+prs+'</ol>'+
      (imgs?('<h2>📎 첨부</h2>'+imgs):'')+
      (otherFiles?('<h2>📎 첨부 파일</h2><ul>'+otherFiles+'</ul>'):'')+
      '</body></html>';
    var w = window.open('', '_blank');
    if(!w){ toast('팝업이 차단되었어요. 팝업을 허용해 주세요.', 'warn'); return; }
    w.document.write(html); w.document.close();
    w.onload = function(){ w.focus(); w.print(); };
  }

  // ---------------- 교사 채점 대시보드 ----------------
  var RUBRIC = [
    { key:'r1', label:'매매 근거의 질', desc:'왜 샀는지 근거를 충실·타당하게 기록했는가' },
    { key:'r2', label:'자원 배분·위험 관리', desc:'분산투자·위험 관리를 실천했는가' },
    { key:'r3', label:'이슈 탐구·기록', desc:'오늘의 뉴스 이슈를 성실히 찾아 기록했는가' },
    { key:'r4', label:'성찰의 깊이', desc:'성찰지·금융원칙에 배움과 태도가 드러나는가' }
  ];
  var GR_SUBS = [];        // 현재 제출 목록
  var grUnsub = null;      // 구독 해제 함수
  var grSelUid = null;     // 선택된 학생

  function updateAdminUI(){
    var admin = SSAMJI_GROUP.isAdmin();
    var tg = $('tabGrade'); if(tg) tg.hidden = !admin;
    if(!admin && state.activeTab === 'grade'){
      state.activeTab = 'market';
      document.querySelector('[data-tab="market"]').click();
    }
  }

  function renderGrade(){
    if(!SSAMJI_GROUP.isAdmin()){ toast('교사만 볼 수 있어요.', 'warn'); return; }
    if(!grUnsub && SSAMJI_FB_READY){
      grUnsub = SSAMJI_GROUP.subscribeSubmissions(function(list){
        GR_SUBS = list.slice().sort(function(a,b){ return (a.name||'').localeCompare(b.name||'', 'ko'); });
        renderGradeList();
        if(grSelUid){ var s = GR_SUBS.find(function(x){return x.uid===grSelUid;}); if(s) renderGradeDetail(s); }
      });
    }
    on($('grDomainBtn'), 'click', editSubmitDomain);
    on($('grPrintAll'), 'click', printAllScores);
    renderGradeList();
  }
  function renderGradeList(){
    var box = $('grList'); if(!box) return;
    $('grHint').textContent = GR_SUBS.length
      ? ('제출 '+GR_SUBS.length+'명 · 채점 완료 '+GR_SUBS.filter(function(s){return s.eval&&typeof s.eval.total==='number';}).length+'명')
      : '아직 제출한 학생이 없어요. 학생이 「제출」하면 실시간으로 올라옵니다.';
    if(!GR_SUBS.length){ box.innerHTML = '<div class="gr-empty">제출 대기 중…</div>'; return; }
    box.innerHTML = GR_SUBS.map(function(s){
      var graded = s.eval && typeof s.eval.total==='number';
      return '<button class="gr-item'+(s.uid===grSelUid?' on':'')+'" data-uid="'+s.uid+'">' +
        '<div class="gr-item-name">'+escapeHtml(s.name||'이름없음')+'</div>' +
        '<div class="gr-item-sub">'+escapeHtml(s.nickname||'')+' · 수익률 '+fmtPct(s.summary?s.summary.returnPct:0)+'</div>' +
        (graded?'<span class="gr-badge done">'+s.eval.total+'점</span>':'<span class="gr-badge">미채점</span>') +
      '</button>';
    }).join('');
    box.querySelectorAll('.gr-item').forEach(function(b){
      on(b, 'click', function(){
        grSelUid = b.getAttribute('data-uid');
        renderGradeList();
        var s = GR_SUBS.find(function(x){return x.uid===grSelUid;});
        if(s) renderGradeDetail(s);
      });
    });
  }
  function metricRow(sm){
    if(!sm) return '';
    var pct = sm.tradeCount ? Math.round(sm.reasonedCount/sm.tradeCount*100) : 0;
    return '<div class="gr-metrics">' +
      '<div class="gr-m"><span>수익률</span><b class="'+upDown(sm.returnPct)+'">'+fmtPct(sm.returnPct)+'</b></div>' +
      '<div class="gr-m"><span>총자산</span><b>'+fmt(sm.totalValue)+'원</b></div>' +
      '<div class="gr-m"><span>거래</span><b>'+sm.tradeCount+'회</b></div>' +
      '<div class="gr-m"><span>근거 작성</span><b>'+sm.reasonedCount+'/'+sm.tradeCount+' ('+pct+'%)</b></div>' +
      '<div class="gr-m"><span>분산 업종</span><b>'+sm.sectorCount+'개</b></div>' +
      '<div class="gr-m"><span>경과일</span><b>'+sm.daysPassed+'일</b></div>' +
      '<div class="gr-m"><span>기록지</span><b>'+(sm.noteCount||0)+'건</b></div>' +
      '<div class="gr-m"><span>배지</span><b>'+(sm.badgeCount||0)+'개</b></div>' +
    '</div>';
  }
  function renderGradeDetail(s){
    var box = $('grDetail'); if(!box) return;
    var ev = s.eval || {};
    var trades = (s.trades||[]).map(function(t){
      return '<tr><td>'+escapeHtml(t.date||'')+'</td><td>'+(t.type==='buy'?'매수':'매도')+'</td>' +
        '<td>'+escapeHtml(t.name||'')+'</td><td class="num">'+t.qty+'</td>' +
        '<td class="rsn">'+escapeHtml(t.reason||'—')+'</td></tr>';
    }).join('');
    var holds = (s.holdings||[]).map(function(h){ return '<span class="gr-chip">'+escapeHtml(h.name)+' '+h.qty+'주</span>'; }).join('') || '<span class="nw-sub">보유 없음</span>';
    var notes = (s.notes||[]).map(function(n){
      return '<li>['+escapeHtml(n.date||'')+'] '+escapeHtml(n.text||'')+(n.stockName?(' <b>('+escapeHtml(n.stockName)+')</b>'):'')+'</li>';
    }).join('') || '<li class="nw-sub">기록 없음</li>';
    var badges = (s.badges||[]).map(function(b){ return '<span class="gr-chip">'+escapeHtml(b.reward||b.title)+'</span>'; }).join('') || '<span class="nw-sub">없음</span>';
    var rf = s.reflection || {};
    var rfHtml = [
      ['가장 기억에 남는 순간', rf.q1], ['잘한 점', rf.q2], ['아쉬운 점·다짐', rf.q3], ['감정 관리·배운 개념', rf.q4]
    ].map(function(x){ return '<div class="gr-qa"><div class="gr-q">'+x[0]+'</div><div class="gr-a">'+escapeHtml(x[1]||'—')+'</div></div>'; }).join('');
    var prin = [rf.p1,rf.p2,rf.p3].filter(function(p){return p;}).map(function(p){ return '<li>'+escapeHtml(p)+'</li>'; }).join('') || '<li class="nw-sub">없음</li>';

    var rubricInputs = RUBRIC.map(function(r){
      var v = (ev.rubric && typeof ev.rubric[r.key]==='number') ? ev.rubric[r.key] : '';
      return '<div class="gr-rub"><div class="gr-rub-l"><b>'+r.label+'</b><span>'+r.desc+'</span></div>' +
        '<input type="number" min="0" max="25" class="gr-rub-in" data-key="'+r.key+'" value="'+v+'"><span class="gr-rub-max">/25</span></div>';
    }).join('');

    box.innerHTML =
      '<div class="gr-d-hdr"><div><h3>'+escapeHtml(s.name||'이름없음')+'</h3>' +
        '<div class="nw-sub">'+escapeHtml(s.email||'')+' · 별명 '+escapeHtml(s.nickname||'')+'</div></div>' +
        '<button class="btn-plain sm" id="grPrintOne">🖨️ 리포트</button></div>' +
      metricRow(s.summary) +
      '<div class="gr-sec"><h4>💼 보유 종목</h4><div class="gr-chips">'+holds+'</div></div>' +
      '<div class="gr-sec"><h4>🏅 획득 배지</h4><div class="gr-chips">'+badges+'</div></div>' +
      '<div class="gr-sec"><h4>📓 거래 내역·근거 ('+(s.trades?s.trades.length:0)+'건)</h4>' +
        (trades ? '<div class="gr-tablewrap"><table class="gr-table"><thead><tr><th>날짜</th><th>구분</th><th>종목</th><th>수량</th><th>근거</th></tr></thead><tbody>'+trades+'</tbody></table></div>' : '<p class="nw-sub">거래 없음</p>') + '</div>' +
      '<div class="gr-sec"><h4>📰 이슈 기록지</h4><ul class="gr-notes">'+notes+'</ul></div>' +
      '<div class="gr-sec"><h4>📔 성찰</h4>'+rfHtml+'<div class="gr-q" style="margin-top:8px">나만의 금융 원칙</div><ol class="gr-prin">'+prin+'</ol></div>' +
      '<div class="gr-sec gr-attach" id="grAttach"><h4>📎 첨부</h4><span class="nw-sub">불러오는 중…</span></div>' +
      '<div class="gr-grade">' +
        '<h4>✍️ 채점 (항목별 25점 · 합계 100점)</h4>' + rubricInputs +
        '<div class="gr-total">합계 <b id="grTotal">0</b> / 100</div>' +
        '<textarea id="grComment" class="gr-comment" rows="3" placeholder="학생에게 전할 코멘트를 적어주세요">'+escapeHtml(ev.comment||'')+'</textarea>' +
        '<button class="btn-primary" id="grSave">💾 채점 저장</button>' +
        (ev.gradedAt?'<span class="nw-sub gr-graded"> 채점됨</span>':'') +
      '</div>';

    // 합계 자동 계산
    function recalc(){
      var t=0; box.querySelectorAll('.gr-rub-in').forEach(function(i){ var v=parseInt(i.value,10); if(!isNaN(v)) t+=v; });
      $('grTotal').textContent = t;
    }
    box.querySelectorAll('.gr-rub-in').forEach(function(i){ on(i,'input',recalc); });
    recalc();
    on($('grSave'), 'click', function(){
      var rubric={}, total=0;
      box.querySelectorAll('.gr-rub-in').forEach(function(i){ var v=parseInt(i.value,10); if(isNaN(v))v=0; v=Math.max(0,Math.min(25,v)); rubric[i.getAttribute('data-key')]=v; total+=v; });
      var ev2 = { rubric:rubric, total:total, comment:$('grComment').value.trim(), gradedAt: new Date().toISOString().slice(0,10) };
      SSAMJI_GROUP.saveEval(s.uid, ev2).then(function(){
        s.eval = ev2; toast('💾 채점 저장 완료 ('+total+'점)', 'ok'); renderGradeList();
      }).catch(function(e){ toast('저장 실패: '+e.message, 'err'); });
    });
    on($('grPrintOne'), 'click', function(){ printStudentReport(s); });

    // 첨부 파일 로드
    if(s.fileCount){
      SSAMJI_GROUP.getSubmissionFiles(s.uid).then(function(files){
        var el = $('grAttach'); if(!el) return;
        var imgs = files.map(function(f){
          return (f.type||'').indexOf('image/')===0
            ? '<a href="'+f.dataUrl+'" target="_blank" rel="noopener"><img class="gr-thumb" src="'+f.dataUrl+'" alt=""></a>'
            : '<span class="gr-chip">📄 '+escapeHtml(f.name)+'</span>';
        }).join('');
        el.innerHTML = '<h4>📎 첨부 ('+files.length+')</h4><div class="gr-chips">'+(imgs||'<span class="nw-sub">없음</span>')+'</div>';
      });
    } else {
      var el=$('grAttach'); if(el) el.innerHTML = '<h4>📎 첨부</h4><span class="nw-sub">없음</span>';
    }
  }
  function editSubmitDomain(){
    SSAMJI_GROUP.getSubmitDomain().then(function(cur){
      var v = prompt('제출 허용 이메일 도메인을 입력하세요.\n예) moga.ms.kr — 이 도메인 계정만 제출 가능.\n비워두면 모든 구글 계정 허용.', cur||'');
      if(v===null) return;
      SSAMJI_GROUP.setSubmitDomain(v.trim()).then(function(){
        toast(v.trim()?('제출 도메인: @'+v.trim().replace(/^@/,'')):'도메인 제한 해제', 'ok');
      }).catch(function(e){ toast(e.message, 'err'); });
    });
  }
  function printStudentReport(s){
    var sm = s.summary||{}, ev = s.eval||{}, rf = s.reflection||{};
    var rubRows = RUBRIC.map(function(r){ var v=(ev.rubric&&typeof ev.rubric[r.key]==='number')?ev.rubric[r.key]:'—'; return '<tr><td>'+r.label+'</td><td>'+r.desc+'</td><td style="text-align:center">'+v+' / 25</td></tr>'; }).join('');
    var trades = (s.trades||[]).map(function(t){ return '<tr><td>'+escapeHtml(t.date||'')+'</td><td>'+(t.type==='buy'?'매수':'매도')+'</td><td>'+escapeHtml(t.name||'')+'</td><td style="text-align:center">'+t.qty+'</td><td>'+escapeHtml(t.reason||'—')+'</td></tr>'; }).join('');
    var notes = (s.notes||[]).map(function(n){ return '<li>['+escapeHtml(n.date||'')+'] '+escapeHtml(n.text||'')+(n.stockName?(' ('+escapeHtml(n.stockName)+')'):'')+'</li>'; }).join('');
    var prin = [rf.p1,rf.p2,rf.p3].filter(Boolean).map(function(p){return '<li>'+escapeHtml(p)+'</li>';}).join('');
    var qa = [['가장 기억에 남는 순간',rf.q1],['잘한 점',rf.q2],['아쉬운 점·다짐',rf.q3],['감정 관리·배운 개념',rf.q4]]
      .map(function(x){return '<div class="qa"><div class="q">'+x[0]+'</div><div class="a">'+escapeHtml(x[1]||'—')+'</div></div>';}).join('');
    var html = '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>'+escapeHtml(s.name||'')+' 과정평가 리포트</title>'+
      '<style>body{font-family:"Malgun Gothic",sans-serif;padding:22px;color:#111;line-height:1.6;font-size:12px}'+
      'h1{font-size:20px;margin:0 0 2px}.sub{color:#666;font-size:12px;margin:0 0 14px}'+
      'h2{font-size:14px;margin:16px 0 6px;border-bottom:2px solid #333;padding-bottom:3px}'+
      'table{width:100%;border-collapse:collapse;margin:4px 0}th,td{border:1px solid #999;padding:4px 6px;font-size:11px;vertical-align:top}th{background:#eee}'+
      '.score{font-size:26px;font-weight:800;color:#7c3aed}.qa{margin-bottom:8px}.q{font-weight:700}.a{border:1px solid #ccc;border-radius:5px;padding:6px 8px;white-space:pre-wrap}'+
      '.cmt{border:1px solid #7c3aed;border-radius:6px;padding:8px 10px;background:#f6f3ff}'+
      '@media print{@page{size:A4;margin:12mm}}</style></head><body>'+
      '<h1>🧑‍🏫 과정평가 리포트</h1><p class="sub">'+escapeHtml(s.name||'')+' ('+escapeHtml(s.email||'')+') · 별명 '+escapeHtml(s.nickname||'')+'</p>'+
      '<h2>📊 투자 성과·활동 요약</h2>'+
      '<table><tr><th>수익률</th><th>총자산</th><th>거래</th><th>근거작성</th><th>분산업종</th><th>기록지</th><th>배지</th></tr>'+
      '<tr><td>'+fmtPct(sm.returnPct)+'</td><td>'+fmt(sm.totalValue)+'원</td><td>'+(sm.tradeCount||0)+'회</td><td>'+(sm.reasonedCount||0)+'/'+(sm.tradeCount||0)+'</td><td>'+(sm.sectorCount||0)+'개</td><td>'+(sm.noteCount||0)+'건</td><td>'+(sm.badgeCount||0)+'개</td></tr></table>'+
      '<h2>📓 거래 내역·근거</h2>'+ (trades?('<table><tr><th>날짜</th><th>구분</th><th>종목</th><th>수량</th><th>근거</th></tr>'+trades+'</table>'):'<p>거래 없음</p>') +
      (notes?('<h2>📰 이슈 기록지</h2><ul>'+notes+'</ul>'):'')+
      '<h2>📔 성찰</h2>'+qa+ (prin?('<div class="q">나만의 금융 원칙</div><ol>'+prin+'</ol>'):'') +
      '<h2>✍️ 평가</h2>'+
      (typeof ev.total==='number' ? '<p class="score">'+ev.total+' / 100점</p><table><tr><th>항목</th><th>기준</th><th>점수</th></tr>'+rubRows+'</table>' : '<p>아직 채점하지 않았습니다.</p>')+
      (ev.comment?('<div class="q" style="margin-top:8px">코멘트</div><div class="cmt">'+escapeHtml(ev.comment)+'</div>'):'')+
      '</body></html>';
    var w = window.open('', '_blank'); if(!w){ toast('팝업을 허용해 주세요.', 'warn'); return; }
    w.document.write(html); w.document.close(); w.onload=function(){ w.focus(); w.print(); };
  }
  function printAllScores(){
    if(!GR_SUBS.length){ toast('제출물이 없어요.', 'warn'); return; }
    var g = SSAMJI_GROUP.getState();
    var rows = GR_SUBS.map(function(s,i){
      var ev=s.eval||{}, sm=s.summary||{};
      return '<tr><td>'+(i+1)+'</td><td>'+escapeHtml(s.name||'')+'</td><td>'+escapeHtml(s.nickname||'')+'</td>'+
        '<td style="text-align:center">'+fmtPct(sm.returnPct)+'</td><td style="text-align:center">'+(sm.tradeCount||0)+'</td>'+
        '<td style="text-align:center">'+(typeof ev.total==='number'?ev.total:'—')+'</td><td>'+escapeHtml(ev.comment||'')+'</td></tr>';
    }).join('');
    var html='<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>학급 점수표</title>'+
      '<style>body{font-family:"Malgun Gothic",sans-serif;padding:20px;color:#111}h1{font-size:18px}'+
      'table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #999;padding:5px 7px;font-size:12px}th{background:#eee}'+
      '@media print{@page{size:A4;margin:12mm}}</style></head><body>'+
      '<h1>🧑‍🏫 '+escapeHtml(g.name||'')+' 과정평가 점수표</h1>'+
      '<table><tr><th>#</th><th>이름</th><th>별명</th><th>수익률</th><th>거래수</th><th>점수</th><th>코멘트</th></tr>'+rows+'</table></body></html>';
    var w=window.open('','_blank'); if(!w){ toast('팝업을 허용해 주세요.','warn'); return; }
    w.document.write(html); w.document.close(); w.onload=function(){ w.focus(); w.print(); };
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

    // 그룹 게이트 이벤트 (참가 / 만들기 / 교사 로그인)
    document.querySelectorAll('.grp-tab').forEach(function(t){
      on(t, 'click', function(){
        document.querySelectorAll('.grp-tab').forEach(function(x){x.classList.remove('active');});
        t.classList.add('active');
        var g = t.dataset.grp;
        $('grpJoin').hidden = (g !== 'join');
        $('grpCreate').hidden = (g !== 'create');
        $('grpTeacher').hidden = (g !== 'teacher');
      });
    });
    on($('btnTeacherLogin'), 'click', async function(){
      var code = $('gtCode').value.trim().toUpperCase();
      var pin = $('gtPin').value.trim();
      if(code.length !== 6){ toast('학급 코드는 6자리예요', 'err'); return; }
      if(!pin){ toast('교사 PIN을 입력해 주세요', 'err'); return; }
      try{
        await SSAMJI_GROUP.teacherLogin(code, pin);
        toast('🔐 교사 로그인 완료', 'ok');
        $('groupGate').hidden = true;
        if(SSAMJI_FB_READY) SSAMJI_RANK.subscribe();
        updateAdminUI();
        state.activeTab = 'grade';
        document.querySelector('[data-tab="grade"]').click();
        renderGrade();
      }catch(e){ toast('❌ '+e.message, 'err'); }
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
        renderRanking(); updateAdminUI();
      }catch(e){ toast('❌ '+e.message, 'err'); }
    });
    on($('btnGrpCreate'), 'click', async function(){
      var name = $('gcName').value.trim();
      var nick = $('gcNick').value.trim();
      var pin = ($('gcPin') ? $('gcPin').value.trim() : '');
      var dom = ($('gcDomain') ? $('gcDomain').value.trim() : '');
      if(!name || !nick){ toast('학급명·별명을 입력해 주세요', 'err'); return; }
      if(pin && pin.length < 4){ toast('교사 PIN은 4자리 이상으로 정해 주세요', 'err'); return; }
      try{
        var code = await SSAMJI_GROUP.createGroup(name, nick, pin, dom);
        prompt('학급 코드가 발급됐어요. 학생들에게 이 코드를 알려주세요:', code);
        toast('학급 생성 완료: '+code, 'ok');
        $('groupGate').hidden = true;
        renderRanking(); updateAdminUI();
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
    // 「모든 데이터 초기화」는 교사(학급 생성자)에게만 노출 — 학생 실수 방지
    var rowReset = $('rowResetAll');
    if(rowReset) rowReset.hidden = !SSAMJI_GROUP.isAdmin();
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
