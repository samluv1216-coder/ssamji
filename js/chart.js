// 캔버스 라인 차트 — 종가 기준. 볼륨 서브 차트 옵션.
(function(){
  // canvas: HTMLCanvasElement, bars: [{date,open,high,low,close,volume}], opts:{ mode:'line'|'candle', highlight:idx }
  window.drawChart = function(canvas, bars, opts){
    opts = opts || {};
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth * dpr;
    var h = canvas.clientHeight * dpr;
    if(canvas.width !== w) canvas.width = w;
    if(canvas.height !== h) canvas.height = h;
    ctx.clearRect(0,0,w,h);
    if(!bars || bars.length === 0){
      ctx.fillStyle = '#94a3b8';
      ctx.font = (14*dpr) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('데이터 없음', w/2, h/2);
      return;
    }
    var pad = { l: 60*dpr, r: 16*dpr, t: 16*dpr, b: 36*dpr };
    var plotW = w - pad.l - pad.r;
    var plotH = h - pad.t - pad.b;

    var closes = bars.map(function(b){return b.close;});
    var min = Math.min.apply(null, bars.map(function(b){return b.low||b.close;}));
    var max = Math.max.apply(null, bars.map(function(b){return b.high||b.close;}));
    var range = max - min || 1;
    // 여유
    min -= range * 0.05; max += range * 0.05;
    range = max - min;

    // 격자·y축 라벨
    ctx.strokeStyle = 'rgba(148,163,184,0.15)';
    ctx.lineWidth = 1 * dpr;
    ctx.fillStyle = '#94a3b8';
    ctx.font = (11*dpr) + 'px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for(var i=0;i<=4;i++){
      var y = pad.t + plotH * (i/4);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + plotW, y);
      ctx.stroke();
      var val = Math.round(max - range * (i/4));
      ctx.fillText(val.toLocaleString('ko-KR'), pad.l - 6*dpr, y);
    }

    // x축 라벨 (첫·중간·끝)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    [0, Math.floor(bars.length/2), bars.length-1].forEach(function(idx){
      var x = pad.l + plotW * (idx/(bars.length-1||1));
      ctx.fillText(bars[idx].date, x, pad.t + plotH + 6*dpr);
    });

    // 라인 그래프
    var mode = opts.mode || 'line';
    if(mode === 'line' || bars.length > 200){
      ctx.strokeStyle = '#7c3aed';
      ctx.lineWidth = 1.8*dpr;
      ctx.beginPath();
      bars.forEach(function(b, i){
        var x = pad.l + plotW * (i/(bars.length-1||1));
        var y = pad.t + plotH * (1 - (b.close - min)/range);
        if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      });
      ctx.stroke();
      // 그라디언트 채움
      var grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + plotH);
      grad.addColorStop(0, 'rgba(124,58,237,0.25)');
      grad.addColorStop(1, 'rgba(124,58,237,0)');
      ctx.lineTo(pad.l + plotW, pad.t + plotH);
      ctx.lineTo(pad.l, pad.t + plotH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    } else {
      // 캔들
      var cw = plotW / bars.length * 0.75;
      bars.forEach(function(b, i){
        var x = pad.l + plotW * (i/(bars.length-1||1));
        var yHigh = pad.t + plotH * (1 - (b.high - min)/range);
        var yLow  = pad.t + plotH * (1 - (b.low  - min)/range);
        var yOpen = pad.t + plotH * (1 - (b.open - min)/range);
        var yClose= pad.t + plotH * (1 - (b.close- min)/range);
        var up = b.close >= b.open;
        ctx.strokeStyle = up ? '#ef4444' : '#3b82f6';
        ctx.fillStyle   = up ? '#ef4444' : '#3b82f6';
        ctx.beginPath();
        ctx.moveTo(x, yHigh); ctx.lineTo(x, yLow); ctx.stroke();
        ctx.fillRect(x - cw/2, Math.min(yOpen,yClose), cw, Math.abs(yClose-yOpen)||1*dpr);
      });
    }

    // 최근 종가 강조점
    if(bars.length){
      var last = bars[bars.length-1];
      var lx = pad.l + plotW;
      var ly = pad.t + plotH * (1 - (last.close - min)/range);
      ctx.fillStyle = '#7c3aed';
      ctx.beginPath();
      ctx.arc(lx, ly, 4*dpr, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#7c3aed';
      ctx.lineWidth = 1.5*dpr;
      ctx.font = 'bold ' + (12*dpr) + 'px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      var label = last.close.toLocaleString('ko-KR');
      var tw = ctx.measureText(label).width + 12*dpr;
      var tx = lx - 6*dpr;
      var ty = ly;
      ctx.fillStyle = '#7c3aed';
      ctx.fillRect(tx - tw, ty - 10*dpr, tw, 20*dpr);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, tx - 6*dpr, ty);
    }
  };

  // 스파크라인 (작은 미니 차트) — 종목 카드용
  window.drawSpark = function(canvas, closes){
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth * dpr;
    var h = canvas.clientHeight * dpr;
    if(canvas.width !== w) canvas.width = w;
    if(canvas.height !== h) canvas.height = h;
    ctx.clearRect(0,0,w,h);
    if(!closes || closes.length<2) return;
    var min = Math.min.apply(null, closes);
    var max = Math.max.apply(null, closes);
    var r = max - min || 1;
    var up = closes[closes.length-1] >= closes[0];
    ctx.strokeStyle = up ? '#ef4444' : '#3b82f6';
    ctx.lineWidth = 1.5*dpr;
    ctx.beginPath();
    closes.forEach(function(v, i){
      var x = (w) * (i/(closes.length-1));
      var y = (h) * (1 - (v-min)/r);
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();
  };
})();
