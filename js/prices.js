// 결정론적 가격 생성기 — 종목별 seed + Geometric Brownian Motion
// 매 로드마다 동일한 5년치 일봉 데이터 생성 (서버 데이터 불필요)

(function(){
  // 시뮬레이션 시작·종료 (5년치)
  window.SSAMJI_SIM_START = new Date('2021-01-04');  // 월요일
  window.SSAMJI_SIM_END   = new Date('2025-12-31');

  // Mulberry32 결정적 PRNG
  function mulberry32(seed){
    return function(){
      var t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ t>>>15, t | 1);
      t ^= t + Math.imul(t ^ t>>>7, t | 61);
      return ((t ^ t>>>14) >>> 0) / 4294967296;
    };
  }
  // Box-Muller 표준정규 난수
  function normal(rng){
    var u=0, v=0;
    while(u===0) u = rng();
    while(v===0) v = rng();
    return Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v);
  }
  // ticker → seed (문자열 hash)
  function seedFor(ticker){
    var h = 2166136261;
    for(var i=0;i<ticker.length;i++){ h ^= ticker.charCodeAt(i); h = Math.imul(h,16777619); }
    return h >>> 0;
  }
  // 영업일(월~금)만 카운트해서 date 배열 생성
  function tradingDays(){
    var days = [];
    var d = new Date(SSAMJI_SIM_START);
    while(d <= SSAMJI_SIM_END){
      var w = d.getDay();
      if(w!==0 && w!==6) days.push(new Date(d));
      d.setDate(d.getDate()+1);
    }
    return days;
  }

  // 실제 시장의 굵직한 「년도별 국면」 반영 — 학생이 뉴스로 들어본 흐름
  // (semi: 반도체, battery: 배터리, tech: 카카오/네이버, ent: 엔터, game: 게임, ...)
  var YEAR_REGIME = {
    // 2021: 삼전·SK하이닉스 조정, 배터리·엔터 강세, 코스피 3000
    2021: { tech:-0.10, battery:0.30, bio:0.05, auto:0.10, chem:0.05, steel:0.15, finance:0.15,
            game:-0.20, ent:0.10, food:0.05, cosmetic:-0.10, retail:0.00, transport:0.10, telecom:0.05 },
    // 2022: 금리인상 → 성장주 대폭락, 삼전·카카오·네이버 반토막, 배터리는 버팀
    2022: { tech:-0.30, battery:-0.05, bio:-0.20, auto:-0.15, chem:-0.20, steel:-0.15, finance:-0.05,
            game:-0.40, ent:-0.30, food:0.00, cosmetic:-0.30, retail:-0.15, transport:0.20, telecom:0.00 },
    // 2023: AI붐 시작 → SK하이닉스·삼전 급등, 2차전지도 상반기 폭등, 게임/엔터 회복
    2023: { tech:0.40, battery:0.20, bio:0.00, auto:0.15, chem:0.05, steel:0.10, finance:0.05,
            game:0.10, ent:0.20, food:0.05, cosmetic:-0.10, retail:-0.10, transport:0.05, telecom:0.00 },
    // 2024: 반도체 강세 지속, 2차전지 급락(전기차 캐즘), 엔터 부진, 금융/식품 안정
    2024: { tech:0.30, battery:-0.35, bio:0.10, auto:-0.05, chem:-0.10, steel:-0.05, finance:0.20,
            game:-0.10, ent:-0.20, food:0.10, cosmetic:-0.15, retail:-0.10, transport:0.05, telecom:0.05 },
    // 2025: 광범위한 반등, AI 지속, 방산·조선·바이오 순환 상승
    2025: { tech:0.20, battery:0.10, bio:0.20, auto:0.15, chem:0.10, steel:0.10, finance:0.10,
            game:0.05, ent:0.10, food:0.05, cosmetic:0.05, retail:0.05, transport:0.05, telecom:0.05 }
  };

  // 한 종목 5년치 일봉 생성
  function generatePrices(stock){
    var days = tradingDays();
    var rng = mulberry32(seedFor(stock.ticker));
    var price = stock.initialPrice;
    var out = [];
    var dailyVol = stock.vol / Math.sqrt(252);  // 연간 → 일별
    for(var i=0;i<days.length;i++){
      var d = days[i];
      var year = d.getFullYear();
      var regime = YEAR_REGIME[year] || {};
      var yearlyAdd = regime[stock.category] || 0;
      var dailyDrift = (stock.drift + yearlyAdd) / 252;
      var z = normal(rng);
      var ret = dailyDrift + dailyVol * z;
      var openP = price;
      var closeP = price * (1 + ret);
      // 일중 변동성으로 high/low
      var intraday = Math.abs(normal(rng)) * dailyVol * 0.6;
      var highP = Math.max(openP, closeP) * (1 + intraday);
      var lowP = Math.min(openP, closeP) * (1 - intraday);
      // 거래량 (초기가 대비 대략)
      var volBase = 1000000 * (1 + Math.abs(z));
      out.push({
        date: fmtDate(d),
        open: Math.round(openP),
        high: Math.round(highP),
        low: Math.round(lowP),
        close: Math.round(closeP),
        volume: Math.round(volBase)
      });
      price = closeP;
      // 극단적 하락 방지 (초기가의 10% 아래로 안 감)
      if(price < stock.initialPrice * 0.10) price = stock.initialPrice * 0.10;
    }
    return out;
  }

  function fmtDate(d){
    var y = d.getFullYear();
    var m = String(d.getMonth()+1).padStart(2,'0');
    var day = String(d.getDate()).padStart(2,'0');
    return y+'-'+m+'-'+day;
  }

  // 전체 종목 가격 데이터 (앱 시작 시 한 번만 계산)
  window.SSAMJI_PRICES = {};
  window.SSAMJI_DATES = [];
  window.buildAllPrices = function(){
    var t0 = performance.now();
    SSAMJI_STOCKS.forEach(function(s){
      SSAMJI_PRICES[s.ticker] = generatePrices(s);
    });
    // 공통 날짜 축
    if(SSAMJI_STOCKS.length>0){
      SSAMJI_DATES = SSAMJI_PRICES[SSAMJI_STOCKS[0].ticker].map(function(b){return b.date;});
    }
    console.log('[SSAMJI] 가격 데이터 생성 완료:', SSAMJI_STOCKS.length, '종목 ×', SSAMJI_DATES.length, '일',
      '(' + Math.round(performance.now()-t0) + 'ms)');
  };

  // 특정 날짜의 가격 조회 (dateIdx 기반)
  window.priceAt = function(ticker, dateIdx){
    var arr = SSAMJI_PRICES[ticker];
    if(!arr) return null;
    var idx = Math.max(0, Math.min(dateIdx, arr.length-1));
    return arr[idx];
  };

  // 종목의 N일간 수익률
  window.returnBetween = function(ticker, fromIdx, toIdx){
    var a = priceAt(ticker, fromIdx);
    var b = priceAt(ticker, toIdx);
    if(!a || !b) return 0;
    return (b.close - a.close) / a.close;
  };
})();
