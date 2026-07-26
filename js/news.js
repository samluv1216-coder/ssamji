// 오늘의 뉴스 — 그 시대의 실제 시장 이슈 + 실제 뉴스 검색 + 이슈 기록지
// ⚠️ 쌈지 주가는 학습용 가상 데이터지만, 연도·업종별 흐름(prices.js YEAR_REGIME)이
//    실제 시장 국면을 본떠서 만들어졌다. 그래서 아래 실제 이슈들과 방향이 대체로 맞물린다.
(function(){

  // 업종 키 → 한글 라벨
  var SECTOR_LABEL = {
    tech:'반도체·IT', battery:'2차전지', bio:'제약·바이오', auto:'자동차', chem:'화학',
    steel:'철강', finance:'금융', game:'게임', ent:'엔터', food:'식품',
    cosmetic:'화장품', retail:'유통', transport:'항공·운송', telecom:'통신', index:'증시 전반'
  };

  // 그 시대의 굵직한 실제 이슈 (쉬운 말로) — prices.js 연도별 국면과 방향을 맞춤
  //  dir: 'up' 상승 요인 / 'down' 하락 요인 / 'mixed' 혼조
  var NEWS = [
    // ── 2021: 코스피 3000, 배터리·엔터 강세, 반도체 조정 ──
    { date:'2021-01-07', dir:'up',   sectors:['index'],
      title:'코스피, 사상 처음 3,000 돌파',
      body:'개인 투자자(‘동학개미’)가 대거 뛰어들고 저금리로 돈이 풀리면서 코스피가 역사상 처음 3,000을 넘었어요.',
      think:'돈이 시장에 많이 풀리면(저금리) 주가는 오르기 쉬워요. 왜 그럴까요?' },
    { date:'2021-03-09', dir:'down', sectors:['tech','game'],
      title:'미국 국채 금리 급등 → 성장주 흔들',
      body:'금리가 오르면 미래 이익이 큰 성장주(기술·게임)가 상대적으로 부담을 받아 조정을 받았어요.',
      think:'‘금리가 오르면 성장주가 약하다’는 말, 우리 종목 중 어디에 해당할까요?' },
    { date:'2021-05-12', dir:'mixed', sectors:['index'],
      title:'물가(인플레이션) 우려로 증시 출렁',
      body:'물가가 빠르게 오르자 “곧 금리를 올릴 것”이라는 걱정에 세계 증시가 크게 흔들렸어요.',
      think:'물가·금리·주가는 서로 어떻게 연결될까요?' },
    { date:'2021-08-11', dir:'down', sectors:['tech'],
      title:'“반도체 고점?” 삼성전자·SK하이닉스 하락',
      body:'반도체 경기가 정점을 지났다는(피크아웃) 걱정에 외국인이 반도체 대형주를 팔면서 주가가 내렸어요.',
      think:'반도체는 호황·불황이 반복돼요(반도체 사이클). 지금은 어느 국면일까요?' },
    { date:'2021-10-19', dir:'up', sectors:['battery'],
      title:'전기차 배터리(2차전지) 강세',
      body:'전기차가 빠르게 늘면서 배터리 회사들이 주목받아 강세를 보였어요. LG에너지솔루션 상장도 화제였죠.',
      think:'내가 아는 전기차·배터리 회사는? 그 제품이 잘 팔리면 주가는?' },
    { date:'2021-11-26', dir:'down', sectors:['transport','index'],
      title:'코로나 새 변이 ‘오미크론’ 등장',
      body:'새로운 변이가 나오자 여행·항공주가 급락하고 증시가 하루 크게 출렁였어요.',
      think:'전염병 뉴스는 어떤 업종에 특히 크게 영향을 줄까요?' },
    { date:'2021-12-16', dir:'down', sectors:['tech','game'],
      title:'미국 연준, 금리 인상 예고(테이퍼링 가속)',
      body:'미국 중앙은행이 “돈 푸는 걸 줄이고 금리를 올리겠다”고 밝히면서 성장주에 부담이 됐어요.',
      think:'‘연준’과 ‘금리’가 왜 우리나라 주가에도 영향을 줄까요?' },

    // ── 2022: 금리 인상 → 성장주 대폭락, 전쟁, 강달러 ──
    { date:'2022-01-27', dir:'down', sectors:['tech','game','ent'],
      title:'금리 인상 공포 → 카카오·네이버·게임주 급락',
      body:'미국이 3월부터 금리를 올린다고 하자 성장주가 크게 떨어졌어요. 코스닥도 많이 빠졌죠.',
      think:'왜 “금리 인상”이 성장주에게 특히 나쁜 소식일까요?' },
    { date:'2022-02-24', dir:'down', sectors:['index','chem','steel'],
      title:'러시아, 우크라이나 침공 → 유가·원자재 급등',
      body:'전쟁으로 기름·곡물·금속 값이 치솟고 세계 증시가 급락했어요. 원자재를 쓰는 기업엔 부담이 됐죠.',
      think:'전쟁은 왜 주가를 떨어뜨릴까요? 반대로 오르는 업종도 있을까요?' },
    { date:'2022-06-16', dir:'down', sectors:['index'],
      title:'미 연준 ‘자이언트 스텝’ → 코스피 2,400 붕괴',
      body:'금리를 한 번에 0.75%p나 올리자 전 세계 주가가 크게 떨어졌어요.',
      think:'금리를 크게 올리면 왜 주가가 내릴까요? 은행 예금과 비교해 생각해봐요.' },
    { date:'2022-09-28', dir:'mixed', sectors:['index','auto'],
      title:'원/달러 환율 1,400원 돌파(강달러)',
      body:'달러가 강해지자 외국인 투자금이 빠져나가 증시에 부담이 됐어요. 다만 수출 기업엔 유리한 면도 있어요.',
      think:'환율이 오르면(원화 약세) 수출 기업엔 왜 도움이 될 수 있을까요?' },

    // ── 2023: 챗GPT·AI 붐 → 반도체 급등, 2차전지 폭등 ──
    { date:'2023-02-08', dir:'up', sectors:['tech'],
      title:'챗GPT 열풍 → AI 반도체 관심 폭발',
      body:'생성형 AI가 화제가 되면서 AI에 필요한 반도체(특히 고성능 메모리) 회사들이 주목받기 시작했어요.',
      think:'AI가 발전하면 어떤 회사가 돈을 벌게 될까요? (칩을 만드는 회사?)' },
    { date:'2023-04-10', dir:'up', sectors:['battery'],
      title:'2차전지 열풍 → 배터리·소재주 폭등',
      body:'전기차·배터리 기대감으로 관련 종목이 크게 올랐어요. 짧은 기간 급등해 과열 논란도 있었죠.',
      think:'주가가 짧은 시간에 너무 빨리 오르면 어떤 위험이 있을까요?' },
    { date:'2023-05-25', dir:'up', sectors:['tech'],
      title:'엔비디아 어닝 서프라이즈 → 반도체 급등',
      body:'AI 대표 기업 엔비디아가 깜짝 실적을 내자, AI 메모리(HBM)를 만드는 국내 반도체주가 크게 올랐어요.',
      think:'외국 기업의 실적이 왜 우리 반도체 회사 주가를 올릴까요?' },

    // ── 2024: 반도체 강세, 전기차 캐즘(배터리 급락) ──
    { date:'2024-01-15', dir:'down', sectors:['battery'],
      title:'전기차 수요 둔화(캐즘) → 배터리 급락',
      body:'전기차 판매 증가세가 주춤하면서 지난해 급등했던 배터리주가 크게 떨어졌어요.',
      think:'작년에 오른 종목이 올해 내릴 수 있어요. ‘분산투자’가 왜 필요한지 연결해봐요.' },
    { date:'2024-03-06', dir:'up', sectors:['tech'],
      title:'AI 반도체 초강세 → 삼성전자·SK하이닉스 상승',
      body:'AI 열풍이 이어지며 반도체 대형주가 강세를 보였어요.',
      think:'같은 시기에 어떤 업종은 오르고 어떤 업종은 내려요. 왜 그럴까요?' },
    { date:'2024-08-05', dir:'down', sectors:['index'],
      title:'‘블랙 먼데이’ 코스피 하루 8% 급락',
      body:'일본 금리·경기 침체 우려가 겹쳐 전 세계 증시가 하루 동안 크게 폭락했어요.',
      think:'하루 만에 큰 손실이 날 수도 있어요. ‘손절선’과 ‘여윳돈 투자’가 왜 중요할까요?' },

    // ── 2025: AI 지속·광범위한 반등 ──
    { date:'2025-01-13', dir:'up', sectors:['tech','index'],
      title:'AI 강세 이어지며 증시 반등',
      body:'AI 투자 흐름이 계속되며 반도체를 중심으로 시장이 회복세를 보였어요.',
      think:'긴 흐름(추세)을 보는 것과 하루하루에 흔들리는 것, 어떤 차이가 있을까요?' },
    { date:'2025-05-19', dir:'mixed', sectors:['bio','steel','transport'],
      title:'방산·조선·바이오 순환 상승',
      body:'주도 업종이 돌아가며 오르는 ‘순환매’ 장세가 나타났어요.',
      think:'한 업종만 담기보다 여러 업종에 나눠 담으면 어떤 점이 좋을까요?' }
  ];

  function toDate(s){ var p=(s||'').split('-'); return new Date(+p[0], (+p[1]||1)-1, +p[2]||1); }
  function fmt(d){
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  function dayDiff(a,b){ return Math.round((toDate(a)-toDate(b))/86400000); }

  // 특정 날짜 기준 ±window일 이내 이슈를, 가까운 순으로 반환
  function newsForDate(dateStr, windowDays){
    var w = windowDays || 21;
    return NEWS
      .map(function(n){ return { n:n, gap:Math.abs(dayDiff(n.date, dateStr)) }; })
      .filter(function(x){ return x.gap <= w; })
      .sort(function(a,b){ return a.gap - b.gap; })
      .map(function(x){ return x.n; });
  }

  function sectorLabels(keys){
    return (keys||[]).map(function(k){ return SECTOR_LABEL[k] || k; });
  }

  // 실제 네이버 뉴스 검색 URL (해당 날짜로 기간 필터)
  function naverNewsUrl(query, dateStr){
    var ymd = (dateStr||'').replace(/-/g,'');
    var nso = 'so:r,p:from'+ymd+'to'+ymd;
    return 'https://search.naver.com/search.naver?where=news&query='
      + encodeURIComponent(query) + '&nso=' + encodeURIComponent(nso) + '&sm=tab_opt';
  }

  // ── 이슈 기록지 (localStorage) ──
  var NOTES_KEY = 'ssamji_news_notes_v1';
  function getNotes(){
    try{ return JSON.parse(localStorage.getItem(NOTES_KEY)) || []; }catch(e){ return []; }
  }
  function saveNotes(list){ try{ localStorage.setItem(NOTES_KEY, JSON.stringify(list)); }catch(e){} }
  function addNote(note){
    var list = getNotes();
    note.id = 'n'+Date.now()+Math.random().toString(36).slice(2,6);
    note.createdAt = note.date + ' 기록';   // 시각은 Date.now 사용 회피 위해 날짜만
    list.unshift(note);
    saveNotes(list);
    return note;
  }
  function deleteNote(id){ saveNotes(getNotes().filter(function(n){ return n.id!==id; })); }

  window.SSAMJI_NEWS = {
    all: NEWS,
    SECTOR_LABEL: SECTOR_LABEL,
    newsForDate: newsForDate,
    sectorLabels: sectorLabels,
    naverNewsUrl: naverNewsUrl,
    fmt: fmt, toDate: toDate,
    getNotes: getNotes, addNote: addNote, deleteNote: deleteNote
  };
})();
