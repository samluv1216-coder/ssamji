// AI 코치·애널리스트 (BYOK Claude/Gemini/OpenAI + 학교 공용 API)
(function(){
  // 학교 공용 Worker 프록시 호출 — 익명 Firebase ID Token 필요 (쑤에는 로그인 없음)
  // 개인 BYOK 모드 위주로 구현. 학교 모드는 Firebase Auth 로그인 시에만.
  async function callClaude(messages, cfg){
    var provider = 'claude';
    var key = SSAMJI_CFG.getKey(provider);
    if(!key) throw new Error('Claude API 키를 등록해주세요. (⚙️ 설정)');
    var res = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: messages
      })
    });
    if(!res.ok){ throw new Error('Claude ' + res.status + ': ' + (await res.text()).slice(0,200)); }
    var data = await res.json();
    return (data.content && data.content[0] && data.content[0].text) || '';
  }

  async function callGemini(messages){
    var key = SSAMJI_CFG.getKey('gemini');
    if(!key) throw new Error('Gemini API 키를 등록해주세요. (⚙️ 설정)');
    // messages → gemini contents 변환
    var contents = messages.map(function(m){
      return { role: m.role==='assistant'?'model':'user', parts:[{text:m.content}] };
    });
    var res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', {
      method:'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: contents })
    });
    if(!res.ok){ throw new Error('Gemini ' + res.status + ': ' + (await res.text()).slice(0,200)); }
    var data = await res.json();
    return (data.candidates && data.candidates[0] && data.candidates[0].content
      && data.candidates[0].content.parts && data.candidates[0].content.parts[0].text) || '';
  }

  async function callOpenAI(messages){
    var key = SSAMJI_CFG.getKey('openai');
    if(!key) throw new Error('OpenAI API 키를 등록해주세요. (⚙️ 설정)');
    var res = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers: { 'Authorization':'Bearer '+key, 'content-type':'application/json' },
      body: JSON.stringify({ model:'gpt-4o-mini', messages: messages, max_tokens: 2048 })
    });
    if(!res.ok){ throw new Error('OpenAI ' + res.status + ': ' + (await res.text()).slice(0,200)); }
    var data = await res.json();
    return (data.choices && data.choices[0] && data.choices[0].message.content) || '';
  }

  async function callAI(messages){
    var cfg = SSAMJI_CFG.get();
    if(cfg.aiMode === 'off') throw new Error('AI 기능이 꺼져 있어요. ⚙️ 설정에서 AI를 켜주세요.');
    switch(cfg.aiProvider){
      case 'gemini': return callGemini(messages);
      case 'openai': return callOpenAI(messages);
      case 'claude':
      default: return callClaude(messages);
    }
  }

  // 종목 애널리스트 — 회사 개요, 사업 분야, 최근 흐름 요약, 학생 눈높이
  async function analyzeStock(stock, bars){
    var lastBar = bars[bars.length-1];
    var firstBar = bars[0];
    var totalReturn = ((lastBar.close - firstBar.close)/firstBar.close*100).toFixed(1);
    var sys = "너는 중·고등학생 대상 경제교육용 AI 애널리스트야. 학생 눈높이(어려운 용어는 풀어서)로 3~4문단, 각 문단 2~3문장으로 대답해. 실제 투자권유가 아니라 학습용임을 잊지 말고, 「사라·팔아라」 대신 「이런 점에 주목해볼 수 있다」 표현을 써.";
    var prompt = [
      "【종목】 " + stock.name + " (" + stock.ticker + ")",
      "【업종】 " + stock.sector,
      "【주요 제품·사업】 " + stock.products.join(', '),
      "【회사 소개】 " + stock.description,
      "【기간 수익률】 " + firstBar.date + " ~ " + lastBar.date + " : " + totalReturn + "%",
      "【최근 종가】 " + lastBar.close.toLocaleString('ko-KR') + '원',
      "",
      "위 정보로 학생에게 다음을 설명해줘:",
      "1) 이 회사가 뭘 하는 회사인지 (기술가정 만들기 수업과 연결해 학생이 아는 제품 위주로)",
      "2) 왜 이 기간 동안 이런 흐름을 보였을지 (사업 특성·해당 기간의 큰 흐름)",
      "3) 앞으로 관심 있게 볼 만한 포인트 (신제품·경쟁상황·계절성 등)",
      "4) 이 회사에 투자할 때 어떤 「위험」을 생각해야 하는지"
    ].join('\n');
    return callAI([{role:'user', content: sys + '\n\n' + prompt}]);
  }

  // 매매 코치 — 학생이 근거를 적었을 때 피드백
  async function coachTrade(trade, stock, reason){
    var sys = "너는 중·고등학생 대상 투자 학습 코치야. 학생이 방금 매매를 하며 적은 「근거」를 읽고, 그 근거의 강한 점·약한 점을 짧고 친절하게 짚어줘. 3문단, 각 문단 1~2문장. 「좋아·나빠」 대신 「이런 관점에서 더 확인해보자」 톤. 답은 존댓말.";
    var prompt = [
      "【거래】 " + (trade.type==='buy'?'매수':'매도') + " " + stock.name + " " + trade.qty + "주 @" + trade.price.toLocaleString('ko-KR') + "원",
      "【학생이 적은 근거】 " + (reason || '(적지 않음)'),
      "",
      "이 매매의 근거를 다음 4가지 관점에서 짚어줘 (한 문단씩):",
      "1) 근거가 회사의 사업·제품과 연결되어 있는가?",
      "2) 감정(FOMO·공포)에 휩쓸린 흔적은 없는가?",
      "3) 분산·비중 관점에서 무리는 없는가?",
      "4) 실수했다면 다음번엔 어떻게 개선할 수 있는가?"
    ].join('\n');
    return callAI([{role:'user', content: sys + '\n\n' + prompt}]);
  }

  // 학습일지 자동 생성 — 시뮬 종료 시나 원할 때
  async function generateJournal(summary){
    var sys = "너는 중·고등학생 경제 수업 조교야. 학생의 시뮬레이션 결과를 학습일지로 정리해줘. A4 반 장 분량, 존댓말.";
    var top = summary.topGainers.map(function(x){return x.name+' '+x.pct+'%';}).join(', ');
    var worst = summary.topLosers.map(function(x){return x.name+' '+x.pct+'%';}).join(', ');
    var prompt = [
      "【기간】 " + summary.startDate + " ~ " + summary.endDate,
      "【시드머니】 " + summary.seedMoney.toLocaleString('ko-KR') + '원',
      "【최종 자산】 " + summary.totalValue.toLocaleString('ko-KR') + '원',
      "【총 수익률】 " + (summary.returnPct*100).toFixed(2) + '%',
      "【거래 횟수】 " + summary.tradeCount + '회',
      "【가장 잘한 종목】 " + (top || '없음'),
      "【가장 아쉬웠던 종목】 " + (worst || '없음'),
      "",
      "다음 순서로 학습일지를 작성해줘 (H3 제목 + 짧은 문단):",
      "1) 이 기간에 어떤 전략을 썼는지 (거래 패턴 유추)",
      "2) 잘한 점 (구체적인 종목 언급)",
      "3) 아쉬운 점 · 개선 방향",
      "4) 이번 시뮬에서 배운 「경제 개념 3가지」",
      "5) 다음번엔 이렇게 해보자 (한 문장)"
    ].join('\n');
    return callAI([{role:'user', content: sys + '\n\n' + prompt}]);
  }

  window.SSAMJI_AI = {
    analyzeStock: analyzeStock,
    coachTrade: coachTrade,
    generateJournal: generateJournal,
    isEnabled: function(){
      var c = SSAMJI_CFG.get();
      return c.aiMode !== 'off' && SSAMJI_CFG.getKey(c.aiProvider);
    }
  };
})();
