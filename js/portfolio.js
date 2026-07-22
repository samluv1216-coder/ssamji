// 포트폴리오·거래 시스템
// 시드머니 1천만원 지급, 매수/매도, 수수료(0.015%)+거래세(매도 0.18%)
(function(){
  var LS_KEY = 'ssamji_portfolio_v1';
  var FEE_BUY  = 0.00015;   // 증권사 수수료 (매수·매도 공통)
  var FEE_SELL = 0.00015;
  var TAX_SELL = 0.0018;    // 거래세 (매도만)
  var SEED_MONEY = 10000000;

  var state = null;
  var listeners = [];

  function newState(){
    return {
      seedMoney: SEED_MONEY,
      cash: SEED_MONEY,
      holdings: {},              // ticker → { qty, avgPrice }
      trades: [],                // 최근이 앞
      startDate: SSAMJI_DATES[0],
      lastTotalValue: SEED_MONEY,
      missionsCleared: {}        // missionId → true
    };
  }

  function load(){
    try{
      var raw = localStorage.getItem(LS_KEY);
      if(raw){ state = JSON.parse(raw); return; }
    }catch(e){}
    state = newState();
  }
  function save(){
    try{ localStorage.setItem(LS_KEY, JSON.stringify(state)); }catch(e){}
  }
  function emit(){
    var snap = summary();
    listeners.forEach(function(fn){ try{ fn(snap); }catch(e){ console.warn(e); } });
    save();
  }

  // 현재 총 자산 (현금 + 보유 종목 평가액)
  function totalValue(){
    var idx = SSAMJI_CLOCK.getIdx();
    var val = state.cash;
    Object.keys(state.holdings).forEach(function(t){
      var h = state.holdings[t];
      if(!h || h.qty<=0) return;
      var p = priceAt(t, idx);
      if(p) val += p.close * h.qty;
    });
    return Math.round(val);
  }

  function summary(){
    var idx = SSAMJI_CLOCK.getIdx();
    var total = totalValue();
    var startVal = state.seedMoney;
    var returnPct = (total - startVal) / startVal;
    // 시뮬레이션 경과일
    var daysPassed = idx;
    return {
      cash: state.cash,
      totalValue: total,
      returnPct: returnPct,
      seedMoney: state.seedMoney,
      holdings: state.holdings,
      trades: state.trades,
      daysPassed: daysPassed,
      missionsCleared: state.missionsCleared,
      currentDate: SSAMJI_DATES[idx]
    };
  }

  // 매수 — 시장가(당일 종가) 기준. reason(근거) 선택.
  function buy(ticker, qty, reason){
    if(!qty || qty<=0) throw new Error('수량을 1주 이상 입력해 주세요.');
    var idx = SSAMJI_CLOCK.getIdx();
    var p = priceAt(ticker, idx);
    if(!p) throw new Error('가격 정보 없음: ' + ticker);
    var price = p.close;
    var gross = price * qty;
    var fee = Math.round(gross * FEE_BUY);
    var cost = gross + fee;
    if(cost > state.cash) throw new Error('현금이 부족합니다. 필요 ' + fmt(cost) + '원, 보유 ' + fmt(state.cash) + '원.');
    state.cash -= cost;
    // 평균 단가 갱신
    var h = state.holdings[ticker] || { qty:0, avgPrice:0 };
    var newQty = h.qty + qty;
    h.avgPrice = Math.round((h.qty * h.avgPrice + gross) / newQty);
    h.qty = newQty;
    state.holdings[ticker] = h;
    state.trades.unshift({
      id: 't' + Date.now() + Math.random().toString(36).slice(2,6),
      type:'buy', ticker:ticker, qty:qty, price:price, fee:fee, tax:0,
      total: cost, date: SSAMJI_DATES[idx], reason: reason||''
    });
    emit();
    return { price:price, cost:cost, fee:fee };
  }

  // 매도 — 시장가(당일 종가) 기준
  function sell(ticker, qty, reason){
    var h = state.holdings[ticker];
    if(!h || h.qty < qty) throw new Error('보유 수량이 부족합니다. 보유 ' + (h?h.qty:0) + '주');
    if(!qty || qty<=0) throw new Error('수량을 1주 이상 입력해 주세요.');
    var idx = SSAMJI_CLOCK.getIdx();
    var p = priceAt(ticker, idx);
    if(!p) throw new Error('가격 정보 없음: ' + ticker);
    var price = p.close;
    var gross = price * qty;
    var fee = Math.round(gross * FEE_SELL);
    var tax = Math.round(gross * TAX_SELL);
    var proceeds = gross - fee - tax;
    // 실현손익
    var costBasis = h.avgPrice * qty;
    var realizedPnl = proceeds - costBasis;
    state.cash += proceeds;
    h.qty -= qty;
    if(h.qty === 0){ delete state.holdings[ticker]; }
    else { state.holdings[ticker] = h; }
    state.trades.unshift({
      id: 't' + Date.now() + Math.random().toString(36).slice(2,6),
      type:'sell', ticker:ticker, qty:qty, price:price, fee:fee, tax:tax,
      total: proceeds, realizedPnl: realizedPnl,
      date: SSAMJI_DATES[idx], reason: reason||''
    });
    emit();
    return { price:price, proceeds:proceeds, fee:fee, tax:tax, realizedPnl:realizedPnl };
  }

  function reset(){
    state = newState();
    emit();
  }

  function updateTradeReason(id, reason){
    var t = state.trades.find(function(x){return x.id===id;});
    if(t){ t.reason = reason; emit(); }
  }

  function fmt(n){ return Number(n||0).toLocaleString('ko-KR'); }

  window.SSAMJI_PORT = {
    load: load,
    save: save,
    summary: summary,
    totalValue: totalValue,
    buy: buy,
    sell: sell,
    reset: reset,
    updateTradeReason: updateTradeReason,
    onChange: function(fn){ listeners.push(fn); return function(){ listeners = listeners.filter(f=>f!==fn); }; },
    FEE_BUY: FEE_BUY, FEE_SELL: FEE_SELL, TAX_SELL: TAX_SELL, SEED_MONEY: SEED_MONEY
  };

  // 시뮬레이션 시간이 흐를 때마다 리스너에게도 알림 (평가액 갱신)
  document.addEventListener('DOMContentLoaded', function(){
    if(window.SSAMJI_CLOCK) SSAMJI_CLOCK.onChange(function(){ emit(); });
  });
})();
