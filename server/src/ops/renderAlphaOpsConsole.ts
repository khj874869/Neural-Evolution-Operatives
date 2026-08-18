export function renderAlphaOpsConsole(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>NEO Alpha Operations</title>
  <style>
    :root{color-scheme:dark;--bg:#070b0d;--panel:#10181b;--line:#26363b;--text:#e8f2ee;--muted:#8ca29b;--mint:#73f5b5;--amber:#ffca6a;--red:#ff7979}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 15% 0,#173129 0,transparent 31%),var(--bg);color:var(--text);font:14px/1.5 Inter,system-ui,sans-serif}
    main{width:min(1180px,calc(100% - 32px));margin:32px auto 72px}.top{display:flex;justify-content:space-between;gap:24px;align-items:flex-end;margin-bottom:24px}
    .eyebrow{color:var(--mint);letter-spacing:.14em;font-size:11px;font-weight:800}h1{margin:6px 0 0;font-size:clamp(25px,4vw,42px);line-height:1.05}p{color:var(--muted)}
    .auth{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}input,select,button{border:1px solid var(--line);border-radius:8px;background:#0b1214;color:var(--text);padding:10px 12px}
    input{width:min(320px,62vw)}button{background:var(--mint);color:#07120d;font-weight:800;cursor:pointer}button:disabled{opacity:.5;cursor:wait}
    #status{min-height:24px;color:var(--muted);margin:0 0 16px}.error{color:var(--red)!important}
    .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card,.panel{border:1px solid var(--line);border-radius:12px;background:linear-gradient(155deg,#142024,#0c1214);box-shadow:0 18px 60px #0004}
    .card{padding:18px}.card span{display:block;color:var(--muted);font-size:11px;letter-spacing:.08em}.card b{display:block;margin-top:7px;font-size:29px}
    .grid{display:grid;grid-template-columns:1.1fr .9fr;gap:14px;margin-top:14px}.panel{padding:20px;overflow:hidden}.panel h2{font-size:15px;margin:0 0 16px}
    .retention{display:grid;grid-template-columns:1fr 1fr;gap:12px}.retention article{border:1px solid var(--line);padding:15px;border-radius:10px}.retention b{font-size:28px}.retention small{display:block;color:var(--muted)}
    .bar{height:7px;background:#263035;border-radius:8px;overflow:hidden;margin-top:12px}.bar i{display:block;height:100%;background:var(--mint)}
    table{border-collapse:collapse;width:100%}th,td{padding:9px 8px;text-align:left;border-bottom:1px solid var(--line)}th{color:var(--muted);font-size:11px}td:nth-child(n+2),th:nth-child(n+2){text-align:right}
    .feedback{list-style:none;margin:0;padding:0;display:grid;gap:9px}.feedback li{border-left:2px solid var(--mint);padding:5px 0 5px 12px}.feedback b{color:var(--amber)}.feedback p{margin:4px 0;color:var(--text);white-space:pre-wrap;overflow-wrap:anywhere}.feedback small{color:var(--muted)}
    .empty{color:var(--muted)}footer{margin-top:18px;color:var(--muted);font-size:12px}
    @media(max-width:820px){.top{align-items:flex-start;flex-direction:column}.auth{justify-content:flex-start}.cards{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}}
    @media(max-width:480px){main{width:min(100% - 20px,1180px);margin-top:20px}.cards,.retention{grid-template-columns:1fr}.auth input{width:100%}}
  </style>
</head>
<body>
<main>
  <header class="top">
    <div><div class="eyebrow">NEURAL EVOLUTION // PRIVATE ALPHA</div><h1>Operations Console</h1></div>
    <div class="auth"><input id="token" type="password" autocomplete="current-password" placeholder="OPS_ADMIN_TOKEN" /><select id="days"><option value="7">7일</option><option value="14">14일</option><option value="30">30일</option></select><button id="load">새로고침</button></div>
  </header>
  <p id="status">토큰은 이 탭의 세션 저장소에만 보관되며 URL로 전송되지 않습니다.</p>
  <section class="cards">
    <article class="card"><span>등록 계정</span><b id="registered">—</b></article>
    <article class="card"><span>텔레메트리 활성</span><b id="active">—</b></article>
    <article class="card"><span>오늘 활성</span><b id="dau">—</b></article>
    <article class="card"><span>평균 피드백</span><b id="rating">—</b></article>
  </section>
  <section class="grid">
    <article class="panel">
      <h2>리텐션 · 최초 관측 세션 코호트</h2>
      <div class="retention">
        <article><span>D1</span><b id="d1">—</b><small id="d1detail">—</small><div class="bar"><i id="d1bar"></i></div></article>
        <article><span>D7</span><b id="d7">—</b><small id="d7detail">—</small><div class="bar"><i id="d7bar"></i></div></article>
      </div>
    </article>
    <article class="panel">
      <h2>최근 피드백</h2>
      <ul class="feedback" id="feedback"><li class="empty">데이터를 불러오십시오.</li></ul>
    </article>
    <article class="panel">
      <h2>행동 퍼널</h2>
      <table><thead><tr><th>이벤트</th><th>유저</th><th>횟수</th></tr></thead><tbody id="funnel"></tbody></table>
    </article>
    <article class="panel">
      <h2>피드백 분류</h2>
      <table><thead><tr><th>분류</th><th>건수</th></tr></thead><tbody id="categories"></tbody></table>
    </article>
  </section>
  <footer>선택 분석에 동의한 계정의 텔레메트리만 리텐션과 퍼널에 포함됩니다. 등록 계정과 자발적 피드백은 별도 집계입니다.</footer>
</main>
<script>
  const byId=(id)=>document.getElementById(id);
  const token=byId('token');
  token.value=sessionStorage.getItem('neo-ops-token')||'';
  const labels={session_start:'세션 시작',tutorial_complete:'튜토리얼 완료',operation_complete:'작전 완료',contract_view:'계약 열람',contract_claim:'계약 수령',store_view:'상점 열람',checkout_intent:'결제 시도',purchase_complete:'구매 완료',client_error:'클라이언트 오류',controls:'조작',performance:'성능',connection:'연결',progression:'성장',ai:'AI',other:'기타'};
  const setText=(id,value)=>{byId(id).textContent=String(value)};
  const rate=(metric)=>metric.rate===null?'표본 없음':Math.round(metric.rate*1000)/10+'%';
  function fillRows(target,rows){
    const body=byId(target);body.replaceChildren();
    rows.forEach((row)=>{const tr=document.createElement('tr');row.forEach((value)=>{const td=document.createElement('td');td.textContent=String(value);tr.appendChild(td)});body.appendChild(tr)});
  }
  function render(data){
    setText('registered',data.audience.registeredPlayers);
    setText('active',data.audience.telemetryActivePlayers);
    setText('dau',data.audience.dailyActivePlayers);
    setText('rating',data.feedback.averageRating===null?'—':data.feedback.averageRating.toFixed(1)+' / 5');
    ['d1','d7'].forEach((key)=>{const metric=data.retention[key];setText(key,rate(metric));setText(key+'detail',metric.returned+' / '+metric.eligible+'명');byId(key+'bar').style.width=(metric.rate===null?0:metric.rate*100)+'%'});
    fillRows('funnel',data.funnel.map((item)=>[labels[item.event]||item.event,item.uniquePlayers,item.events]));
    fillRows('categories',Object.entries(data.feedback.byCategory).map(([key,value])=>[labels[key]||key,value]));
    const list=byId('feedback');list.replaceChildren();
    if(!data.feedback.recent.length){const li=document.createElement('li');li.className='empty';li.textContent='이 기간에 제출된 피드백이 없습니다.';list.appendChild(li)}
    data.feedback.recent.forEach((item)=>{const li=document.createElement('li');const title=document.createElement('b');title.textContent=(labels[item.category]||item.category)+' · '+item.rating+'/5';const message=document.createElement('p');message.textContent=item.message;const time=document.createElement('small');time.textContent=new Date(item.createdAt).toLocaleString('ko-KR');li.append(title,message,time);list.appendChild(li)});
    const generated=new Date(data.generatedAt).toLocaleString('ko-KR');byId('status').className='';setText('status',data.windowDays+'일 관측창 · '+generated+' 갱신');
  }
  async function load(){
    const secret=token.value.trim();if(!secret){byId('status').className='error';setText('status','운영 토큰을 입력하십시오.');return}
    sessionStorage.setItem('neo-ops-token',secret);byId('load').disabled=true;setText('status','운영 데이터를 불러오는 중…');
    try{const response=await fetch('/api/ops/alpha?days='+byId('days').value,{headers:{'x-ops-token':secret}});if(!response.ok)throw new Error(String(response.status));render(await response.json())}
    catch(error){byId('status').className='error';setText('status',error.message==='401'?'토큰이 올바르지 않습니다.':'운영 데이터를 불러오지 못했습니다. ('+error.message+')')}
    finally{byId('load').disabled=false}
  }
  byId('load').addEventListener('click',load);
  token.addEventListener('keydown',(event)=>{if(event.key==='Enter')load()});
</script>
</body>
</html>`;
}
