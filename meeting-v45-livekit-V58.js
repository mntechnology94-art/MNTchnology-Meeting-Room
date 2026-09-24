/* MNTchnology v45 — LiveKit SFU meeting core.
   Keeps the V44 UI, Join, Schedule and chat flow, but replaces WebRTC mesh
   with LiveKit SFU for stable multi-participant video/audio/screen sharing. */
document.addEventListener('DOMContentLoaded', () => {
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeClone=el=>{if(!el)return null;const c=el.cloneNode(true);el.replaceWith(c);return c};
  const showPage=id=>{$$('.page').forEach(p=>p.classList.toggle('active-page',p.id===id));$$('.nav-link').forEach(b=>b.classList.toggle('active',b.dataset.page===id));window.scrollTo(0,0)};
  const getMeetings=()=>{try{return JSON.parse(localStorage.getItem('mnt_scheduled_meetings')||'[]')}catch{return[]}};
  const saveMeetings=x=>localStorage.setItem('mnt_scheduled_meetings',JSON.stringify(x));
  const roomLink=code=>`${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`;
  const roomFromUrl=()=>new URLSearchParams(location.search).get('room')||(location.pathname.match(/\/room\/([^/]+)/i)?.[1]||'');
  const cleanCode=v=>{const s=(v||'').trim();const m=s.match(/[?&]room=([^&#/]+)/i)||s.match(/\/room\/([^/?#]+)/i);return decodeURIComponent(m?m[1]:s).replace(/[^A-Za-z0-9_-]/g,'').slice(0,50)};
  const LK=window.LivekitClient;
  const TOKEN_ENDPOINT=`${window.MNT_SUPABASE_URL}/functions/v1/livekit-token`;
  if(!LK){console.error('LiveKit SDK missing');alert('LiveKit SDK load wenne naha. Page eka refresh කරන්න.');return}

  let activeCode='',room=null,name='Guest',activeTitle='MNTchnology Meeting',role='Guest';
  let peerId=sessionStorage.getItem('mnt_peer_id')||((crypto.randomUUID&&crypto.randomUUID())||Math.random().toString(36).slice(2));
  let selectedPeerId=null,screenOwnerId=null,annotationStrokes=[],redoStrokes=[],annotationEnabled=false;
  let annotationTool='select',annotationColor='#ff2f2f',annotationToolbarClosed=false,annotationToolbarPosition=null;
  let annotationPipWindow=null,annotationPipOpening=false,annotationPipMinimized=false;
  let currentCameraDeviceId=null,screenPublishing=false;
  let participantFocus=false,suppressTileClickUntil=0,pipPosition=null;
  let meetingRecorder=null,meetingRecordStream=null,meetingRecordChunks=[];
  let meetingRecordCanvas=null,meetingRecordCanvasStream=null,meetingRecordRaf=0,meetingRecordAudioCtx=null,meetingRecordAudioDest=null,meetingRecordAudioSources=[];
  let meetingRecordStartedAt=0,meetingRecordPausedAt=0,meetingRecordPausedTotal=0,meetingRecordUiTimer=0;
  sessionStorage.setItem('mnt_peer_id',peerId);

  function requestAppFullscreen(){
    const el=document.documentElement;
    if(document.fullscreenElement||document.webkitFullscreenElement)return;
    const fn=el.requestFullscreen||el.webkitRequestFullscreen;
    if(fn){try{const p=fn.call(el);p?.catch?.(()=>{})}catch{}}
  }
  async function exitAppFullscreen(){
    try{
      if(document.fullscreenElement&&document.exitFullscreen)await document.exitFullscreen();
      else if(document.webkitFullscreenElement&&document.webkitExitFullscreen)document.webkitExitFullscreen();
    }catch{}
  }
  const isHost=()=>role==='Host';
  const setRoomMeta=(title,status)=>{$('#roomTitle').textContent=title||'MNTchnology Meeting';$('#roomMeta').textContent=status||''};
  const identityFor=()=>`${isHost()?'host':'guest'}-${peerId}`;
  const participantByIdentity=id=>room?.remoteParticipants?.get(id)||null;
  const displayNameForParticipant=p=>p?.name||p?.identity?.replace(/^(host|guest)-/,'')||'Guest';

  function syncGuestLandscapeShareMode(){
    const meeting=$('#room .meeting-room');
    const grid=$('#videoGrid');
    if(!meeting||!grid)return;
    const isLandscape=window.matchMedia?.('(orientation: landscape)')?.matches ?? (window.innerWidth>window.innerHeight);
    const phoneLandscape=isLandscape && Math.min(window.innerWidth,window.innerHeight)<=600;
    const hostScreen=[...grid.querySelectorAll('.tile[data-kind="screen"]')]
      .find(t=>String(t.dataset.peerTile||'').startsWith('screen:host-'))||null;
    const active=!isHost() && phoneLandscape && !!hostScreen;
    meeting.classList.toggle('mnt-guest-landscape-share',active);
    if(active){
      window.MNTMeetingUI?.closePanel?.();
      const target=hostScreen.dataset.peerTile;
      if(selectedPeerId!==target||!participantFocus){
        selectedPeerId=target;
        participantFocus=true;
        applyVideoLayout();
      }
    }
  }
  window.addEventListener('resize',()=>requestAnimationFrame(syncGuestLandscapeShareMode));
  window.addEventListener('orientationchange',()=>setTimeout(syncGuestLandscapeShareMode,180));

  function tile(id,n){
    let t=document.querySelector(`[data-peer-tile="${CSS.escape(id)}"]`);if(t)return t;
    t=document.createElement('div');t.className='tile';t.dataset.peerTile=id;
    t.addEventListener('click',()=>{
      if(performance.now()<suppressTileClickUntil)return;
      requestAppFullscreen();
      selectMainTile(id,true);
    });
    t.innerHTML=`<div class="avatar">${esc((n||'G').trim().charAt(0).toUpperCase()||'G')}</div><span>🎙 ${esc(n||'Guest')}${id===peerId?' (You)':''}</span>`;
    $('#videoGrid').appendChild(t);
    if(id===peerId)enablePipDrag(t);
    return t;
  }

  function enablePipDrag(t){
    if(!t||t.dataset.pipDragBound==='1')return;
    t.dataset.pipDragBound='1';
    let dragging=false,moved=false,startX=0,startY=0,startLeft=0,startTop=0,pointerId=null;
    t.addEventListener('pointerdown',e=>{
      if(!t.classList.contains('self-pip'))return;
      dragging=true;moved=false;pointerId=e.pointerId;
      const grid=$('#videoGrid');const tr=t.getBoundingClientRect();const gr=grid.getBoundingClientRect();
      startX=e.clientX;startY=e.clientY;startLeft=tr.left-gr.left;startTop=tr.top-gr.top;
      try{t.setPointerCapture(pointerId)}catch{}
      e.preventDefault();
    });
    t.addEventListener('pointermove',e=>{
      if(!dragging||e.pointerId!==pointerId)return;
      const grid=$('#videoGrid');const gr=grid.getBoundingClientRect();
      const dx=e.clientX-startX,dy=e.clientY-startY;
      if(Math.abs(dx)>4||Math.abs(dy)>4)moved=true;
      const w=t.offsetWidth,h=t.offsetHeight;
      const left=Math.max(6,Math.min(gr.width-w-6,startLeft+dx));
      const top=Math.max(6,Math.min(gr.height-h-6,startTop+dy));
      t.style.left=`${left}px`;t.style.top=`${top}px`;t.style.right='auto';t.style.bottom='auto';
      pipPosition={left,top};
      e.preventDefault();
    });
    const end=e=>{
      if(!dragging)return;
      dragging=false;
      if(moved)suppressTileClickUntil=performance.now()+350;
      try{t.releasePointerCapture(pointerId)}catch{}
      pointerId=null;
    };
    t.addEventListener('pointerup',end);t.addEventListener('pointercancel',end);
  }

  function applyVideoLayout(){
    const grid=$('#videoGrid');if(!grid)return;
    const tiles=$$('#videoGrid .tile');
    tiles.forEach(t=>{
      t.classList.remove('main-tile','self-pip');
      if(t.dataset.peerTile===peerId){
        t.style.left='';t.style.top='';t.style.right='';t.style.bottom='';
      }
    });
    let main=tiles.find(t=>t.dataset.peerTile===selectedPeerId);
    if(!main){main=tiles.find(t=>t.dataset.peerTile===peerId)||tiles[0]||null;selectedPeerId=main?.dataset.peerTile||null}
    if(main)main.classList.add('main-tile');
    grid.classList.toggle('participant-focus-mode',participantFocus);
    grid.classList.toggle('focus-mode',participantFocus);
    if(participantFocus&&selectedPeerId!==peerId){
      const self=tiles.find(t=>t.dataset.peerTile===peerId&&t.dataset.kind!=='screen');
      if(self){
        self.classList.add('self-pip');
        enablePipDrag(self);
        if(pipPosition){
          self.style.left=`${pipPosition.left}px`;self.style.top=`${pipPosition.top}px`;self.style.right='auto';self.style.bottom='auto';
        }
      }
    }
    updateAnnotationLayer();
  }

  function setDefaultMain(id){
    participantFocus=false;
    selectedPeerId=id;
    applyVideoLayout();
  }

  function selectMainTile(id,fromUser=false){
    const exists=document.querySelector(`[data-peer-tile="${CSS.escape(id)}"]`);
    if(!exists)return;
    if(fromUser&&participantFocus&&selectedPeerId===id){
      participantFocus=false;
      selectedPeerId=id;
      applyVideoLayout();
      return;
    }
    selectedPeerId=id;
    participantFocus=!!fromUser || String(id).startsWith('screen:');
    applyVideoLayout();
  }
  function setScreenOwner(id,active){
    const sid=`screen:${id}`;const t=document.querySelector(`[data-peer-tile="${CSS.escape(sid)}"]`);
    if(t)t.classList.toggle('screen-share-tile',!!active);
    if(active){
      screenOwnerId=sid;
      annotationToolbarClosed=false;
      selectMainTile(sid);
    }
    else if(screenOwnerId===sid){
      screenOwnerId=null;
      annotationTool='select';annotationEnabled=false;annotationToolbarClosed=false;
      closePersistentAnnotationToolbar();
      const fallback=[...document.querySelectorAll('#videoGrid .tile')].find(x=>x.dataset.peerTile===id)||document.querySelector('#videoGrid .tile');
      if(fallback)selectMainTile(fallback.dataset.peerTile);
    }
    requestAnimationFrame(syncGuestLandscapeShareMode);
  }
  function putVideo(id,videoEl,n,type='camera',muted=false){
    const tileId=type==='screen'?`screen:${id}`:id;const t=tile(tileId,n);t.dataset.kind=type;
    let v=t.querySelector('video');
    if(videoEl?.tagName==='VIDEO'){
      if(v&&v!==videoEl)try{v.remove()}catch{}
      v=videoEl;
      v.autoplay=true;v.playsInline=true;v.muted=muted;v.setAttribute('playsinline','');
      v.style.display='block';v.style.width='100%';v.style.height='100%';v.style.objectFit=type==='screen'?'contain':'cover';v.style.background='#000';
      t.prepend(v);
    }else{
      if(!v){v=document.createElement('video');v.autoplay=true;v.playsInline=true;v.muted=muted;v.setAttribute('playsinline','');t.prepend(v)}
      if(videoEl?.srcObject)v.srcObject=videoEl.srcObject;
      v.style.display='block';v.style.width='100%';v.style.height='100%';v.style.objectFit=type==='screen'?'contain':'cover';
    }
    v.play?.().catch(()=>{});
    const a=t.querySelector('.avatar');if(a)a.style.display='none';
    return v;
  }
  function renderLocalCamera(){
    if(!room)return;
    const pub=room.localParticipant.getTrackPublication(LK.Track.Source.Camera);
    const track=pub?.track;
    if(!track)return;
    const el=track.attach();
    const v=Array.isArray(el)?el[0]:el;
    if(v)putVideo(peerId,v,name,'camera',true);
  }
  function attachTrack(track,participant,source){
    const id=participant.identity,n=displayNameForParticipant(participant);
    const type=source===LK.Track.Source.ScreenShare?'screen':'camera';
    const el=track.attach();
    if(el.tagName==='AUDIO'){el.autoplay=true;el.setAttribute('data-peer-audio',id);el.style.display='none';document.body.appendChild(el);el.play?.().catch(()=>{})}
    else {const t=tile(type==='screen'?`screen:${id}`:id,n);t.dataset.kind=type;let old=t.querySelector('video');if(old)old.remove();el.autoplay=true;el.playsInline=true;el.classList.add('lk-track-video');el.style.width='100%';el.style.height='100%';el.style.objectFit=type==='screen'?'contain':'cover';el.style.background='#000';t.prepend(el);el.play?.().catch(()=>{});if(type==='screen'){t.classList.add('screen-share-tile');setScreenOwner(id,true)}}
  }
  function detachTrack(track,participant,source){
    try{track.detach().forEach(e=>e.remove())}catch{}
    if(source===LK.Track.Source.ScreenShare){document.querySelector(`[data-peer-tile="${CSS.escape('screen:'+participant.identity)}"]`)?.remove();setScreenOwner(participant.identity,false)}
  }

  function ensureAnnotationUI(){
    if($('#annotationToolbar'))return;
    const roomEl=$('#room .meeting-room');
    if(!roomEl)return;

    const bar=document.createElement('div');
    bar.id='annotationToolbar';
    bar.setAttribute('role','toolbar');
    bar.setAttribute('aria-label','Screen annotation tools');
    bar.innerHTML=`
      <button type="button" class="ann-tool active" id="annSelect" data-ann-tool="select" title="Mouse / Select"><span class="ann-icon">↖</span><small>Select</small></button>
      <button type="button" class="ann-tool" id="annPen" data-ann-tool="pen" title="Pencil"><span class="ann-icon">✎</span><small>Pen</small></button>
      <div class="ann-color-wrap">
        <button type="button" class="ann-tool" id="annColor" title="Pencil color"><span class="ann-color-dot" id="annColorDot"></span><small>Color</small></button>
        <div class="ann-color-palette" id="annColorPalette" aria-label="Annotation colors">
          <button type="button" data-ann-color="#ff2f2f" style="--sw:#ff2f2f" title="Red"></button>
          <button type="button" data-ann-color="#ff9f1c" style="--sw:#ff9f1c" title="Orange"></button>
          <button type="button" data-ann-color="#ffd60a" style="--sw:#ffd60a" title="Yellow"></button>
          <button type="button" data-ann-color="#25d366" style="--sw:#25d366" title="Green"></button>
          <button type="button" data-ann-color="#20b7ff" style="--sw:#20b7ff" title="Blue"></button>
          <button type="button" data-ann-color="#7b61ff" style="--sw:#7b61ff" title="Purple"></button>
          <button type="button" data-ann-color="#ffffff" style="--sw:#ffffff" title="White"></button>
          <button type="button" data-ann-color="#111111" style="--sw:#111111" title="Black"></button>
        </div>
      </div>
      <button type="button" class="ann-tool" data-ann-tool="line" title="Line"><span class="ann-icon">╱</span><small>Line</small></button>
      <button type="button" class="ann-tool" data-ann-tool="arrow" title="Arrow"><span class="ann-icon">→</span><small>Arrow</small></button>
      <button type="button" class="ann-tool" data-ann-tool="rect" title="Rectangle"><span class="ann-icon">□</span><small>Rectangle</small></button>
      <button type="button" class="ann-tool" data-ann-tool="circle" title="Circle"><span class="ann-icon">○</span><small>Circle</small></button>
      <button type="button" class="ann-tool" data-ann-tool="text" title="Text"><span class="ann-icon">T</span><small>Text</small></button>
      <span class="ann-separator"></span>
      <button type="button" class="ann-tool ann-action" id="annUndo" title="Undo"><span class="ann-icon">↶</span><small>Undo</small></button>
      <button type="button" class="ann-tool ann-action" id="annRedo" title="Redo"><span class="ann-icon">↷</span><small>Redo</small></button>
      <span class="ann-separator"></span>
      <button type="button" class="ann-tool ann-move" id="annMove" title="Move toolbar"><span class="ann-icon">✥</span><small>Move</small></button>
      <span class="ann-drag-grip" id="annDragGrip" title="Drag toolbar" aria-label="Drag toolbar">⠿</span>
      <button type="button" class="ann-tool ann-close" id="annClose" title="Close annotations"><span class="ann-icon">×</span><small>Close</small></button>`;
    roomEl.appendChild(bar);

    const c=document.createElement('canvas');
    c.id='annotationCanvas';
    c.style.pointerEvents='none';
    roomEl.appendChild(c);

    const floatBtn=document.createElement('button');
    floatBtn.id='annotationFloatBtn';
    floatBtn.type='button';
    floatBtn.title='Open floating annotation toolbar';
    floatBtn.setAttribute('aria-label','Open floating annotation toolbar');
    floatBtn.innerHTML='<span>✎</span><small>Annotate</small>';
    roomEl.appendChild(floatBtn);
    floatBtn.addEventListener('click',()=>openPersistentAnnotationToolbar());

    let drawing=false,current=null,lastBroadcast=0;
    const pos=e=>{
      const r=getAnnotationContentRect(c);
      return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/Math.max(1,r.width))),y:Math.max(0,Math.min(1,(e.clientY-r.top)/Math.max(1,r.height)))};
    };
    const sync=()=>{const main=document.querySelector('#videoGrid .main-tile');if(main&&!main.contains(c))main.appendChild(c);resizeAnnotationCanvas()};

    function setTool(tool){
      annotationTool=tool;
      annotationEnabled=tool!=='select';
      bar.querySelectorAll('[data-ann-tool]').forEach(b=>b.classList.toggle('active',b.dataset.annTool===tool));
      c.style.pointerEvents=annotationEnabled?'auto':'none';
      c.style.cursor=tool==='text'?'text':annotationEnabled?'crosshair':'default';
      $('#annColorPalette')?.classList.remove('open');
      sync();
      syncPersistentAnnotationToolbar();
    }
    function commit(obj){
      if(!obj)return;
      annotationStrokes.push(obj);redoStrokes=[];current=null;drawing=false;drawAnnotations();sendAnnotationState();syncPersistentAnnotationToolbar();
    }
    function makeShape(tool,a,b){return{type:tool,color:annotationColor,points:[a,b]}};

    bar.querySelectorAll('[data-ann-tool]').forEach(btn=>btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();setTool(btn.dataset.annTool)}));
    $('#annColor')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();$('#annColorPalette')?.classList.toggle('open')});
    $('#annColorPalette')?.querySelectorAll('[data-ann-color]').forEach(btn=>btn.addEventListener('click',e=>{
      e.preventDefault();e.stopPropagation();annotationColor=btn.dataset.annColor||'#ff2f2f';
      $('#annColorDot')?.style.setProperty('background',annotationColor);$('#annColorPalette')?.classList.remove('open');
      syncPersistentAnnotationToolbar();
    }));
    $('#annColorDot')?.style.setProperty('background',annotationColor);

    $('#annUndo').onclick=()=>{if(!isHost()||!annotationStrokes.length)return;redoStrokes.push(annotationStrokes.pop());drawAnnotations();sendAnnotationState();syncPersistentAnnotationToolbar()};
    $('#annRedo').onclick=()=>{if(!isHost()||!redoStrokes.length)return;annotationStrokes.push(redoStrokes.pop());drawAnnotations();sendAnnotationState();syncPersistentAnnotationToolbar()};
    $('#annClose').onclick=()=>{annotationToolbarClosed=true;setTool('select');bar.classList.remove('visible');updateAnnotationFloatButton()};

    c.addEventListener('pointerdown',e=>{
      if(!isHost()||!annotationEnabled||!screenOwnerId)return;
      const p=pos(e);
      if(annotationTool==='text'){
        const value=window.prompt('Text එක type කරන්න:','');
        if(value&&value.trim())commit({type:'text',color:annotationColor,point:p,text:value.trim().slice(0,160)});
        return;
      }
      drawing=true;c.setPointerCapture?.(e.pointerId);
      current=annotationTool==='pen'?{type:'pen',color:annotationColor,points:[p]}:makeShape(annotationTool,p,p);
      drawAnnotations(current);sendAnnotationLive(current);
    });
    c.addEventListener('pointermove',e=>{
      if(!drawing||!current)return;
      const p=pos(e);
      if(current.type==='pen')current.points.push(p);else current.points[1]=p;
      drawAnnotations(current);
      const now=performance.now();if(now-lastBroadcast>45){lastBroadcast=now;sendAnnotationLive(current)}
    });
    const end=e=>{if(!drawing||!current)return;if(e?.pointerId!=null)try{c.releasePointerCapture?.(e.pointerId)}catch{};commit(current)};
    c.addEventListener('pointerup',end);c.addEventListener('pointercancel',end);c.addEventListener('pointerleave',e=>{if(drawing&&e.buttons===0)end(e)});

    // Zoom-style movable toolbar. Drag with Move button or dotted grip.
    const dragStart=e=>{
      if(!isHost())return;
      e.preventDefault();e.stopPropagation();
      const r=bar.getBoundingClientRect(),sx=e.clientX,sy=e.clientY,startLeft=r.left,startTop=r.top;
      bar.style.setProperty('left',`${startLeft}px`,'important');bar.style.setProperty('top',`${startTop}px`,'important');bar.style.setProperty('right','auto','important');bar.style.setProperty('transform','none','important');
      bar.classList.add('dragging');
      const move=ev=>{
        const maxLeft=Math.max(6,window.innerWidth-bar.offsetWidth-6),maxTop=Math.max(6,window.innerHeight-bar.offsetHeight-6);
        const left=Math.min(maxLeft,Math.max(6,startLeft+ev.clientX-sx));
        const top=Math.min(maxTop,Math.max(6,startTop+ev.clientY-sy));
        annotationToolbarPosition={left,top};bar.style.setProperty('left',`${left}px`,'important');bar.style.setProperty('top',`${top}px`,'important');bar.style.setProperty('right','auto','important');bar.style.setProperty('transform','none','important');
      };
      const up=()=>{bar.classList.remove('dragging');window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up)};
      window.addEventListener('pointermove',move);window.addEventListener('pointerup',up,{once:true});
    };
    $('#annMove')?.addEventListener('pointerdown',dragStart);$('#annDragGrip')?.addEventListener('pointerdown',dragStart);

    window.addEventListener('pointerdown',e=>{if(!bar.contains(e.target))$('#annColorPalette')?.classList.remove('open')});
    window.addEventListener('resize',()=>{resizeAnnotationCanvas();if(annotationToolbarPosition){const maxLeft=Math.max(6,window.innerWidth-bar.offsetWidth-6),maxTop=Math.max(6,window.innerHeight-bar.offsetHeight-6);annotationToolbarPosition.left=Math.min(maxLeft,annotationToolbarPosition.left);annotationToolbarPosition.top=Math.min(maxTop,annotationToolbarPosition.top);bar.style.setProperty('left',`${annotationToolbarPosition.left}px`,'important');bar.style.setProperty('top',`${annotationToolbarPosition.top}px`,'important');bar.style.setProperty('transform','none','important')}});
  }


  function updateAnnotationFloatButton(){
    const btn=$('#annotationFloatBtn');
    if(!btn)return;
    const active=!!screenOwnerId&&isHost();
    const pipOpen=!!annotationPipWindow&&!annotationPipWindow.closed;
    btn.classList.toggle('visible',active&&!pipOpen);
  }

  function closePersistentAnnotationToolbar(){
    const w=annotationPipWindow;
    annotationPipWindow=null;annotationPipOpening=false;annotationPipMinimized=false;
    try{if(w&&!w.closed)w.close()}catch{}
    updateAnnotationFloatButton();
  }

  function syncPersistentAnnotationToolbar(){
    const w=annotationPipWindow;
    if(!w||w.closed){annotationPipWindow=null;updateAnnotationFloatButton();return}
    try{
      const d=w.document;
      d.querySelectorAll('[data-pip-tool]').forEach(b=>b.classList.toggle('active',b.dataset.pipTool===annotationTool));
      const dot=d.getElementById('pipAnnColorDot');if(dot)dot.style.background=annotationColor;
      const undo=d.getElementById('pipAnnUndo');if(undo)undo.disabled=!annotationStrokes.length;
      const redo=d.getElementById('pipAnnRedo');if(redo)redo.disabled=!redoStrokes.length;
      const status=d.getElementById('pipAnnStatus');if(status)status.textContent=screenOwnerId?'Screen sharing • Annotation ready':'Waiting for screen share';
    }catch{}
    updateAnnotationFloatButton();
  }

  function renderPersistentAnnotationToolbar(w){
    const d=w.document;
    d.title='MNT Annotation Toolbar';
    d.head.innerHTML=`<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0b0e13;color:#fff;font-family:Inter,"Segoe UI",Arial,sans-serif}
      body{display:flex;align-items:center;justify-content:center}.pip-wrap{width:100%;height:100%;display:flex;align-items:center;padding:7px;background:rgba(11,14,19,.98)}
      .pip-bar{display:flex;align-items:stretch;gap:2px;width:100%;min-width:max-content}.pip-tool{width:60px;min-width:60px;height:58px;border:0;border-radius:9px;background:transparent;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer}
      .pip-tool:hover{background:#1b222c}.pip-tool.active{background:#0867d8;box-shadow:inset 0 0 0 1px #238cff}.pip-tool:disabled{opacity:.36;cursor:not-allowed}.ico{font-size:26px;line-height:27px}.pip-tool small{font-size:10px;font-weight:700;white-space:nowrap}
      .sep{width:1px;height:46px;margin:6px 4px;background:rgba(255,255,255,.16)}.color-wrap{position:relative;display:flex}.dot{width:24px;height:24px;border:2px solid #fff;border-radius:50%}.palette{position:absolute;display:none;grid-template-columns:repeat(4,30px);gap:6px;left:0;top:60px;padding:8px;background:#111820;border:1px solid #ffffff29;border-radius:10px;box-shadow:0 10px 24px #0008}.palette.open{display:grid}.palette button{width:30px;height:30px;border-radius:50%;border:2px solid #dfe7f4;background:var(--sw);cursor:pointer}
      .move-note{position:fixed;left:8px;bottom:2px;font-size:9px;color:#9aa7b7;pointer-events:none}.mini{display:none;width:100%;height:100%;align-items:center;justify-content:center}.mini button{border:0;border-radius:18px;background:#0867d8;color:white;font-size:16px;font-weight:800;padding:14px 20px;cursor:pointer}.minimized .pip-wrap{display:none}.minimized .mini{display:flex}
      .min-btn .ico{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#f02f45}.status{position:fixed;right:8px;bottom:2px;font-size:9px;color:#9aa7b7;pointer-events:none}
    </style>`;
    d.body.innerHTML=`<div class="pip-wrap"><div class="pip-bar">
      <button class="pip-tool active" data-pip-tool="select" title="Mouse / Select"><span class="ico">↖</span><small>Select</small></button>
      <button class="pip-tool" data-pip-tool="pen" title="Pencil"><span class="ico">✎</span><small>Pen</small></button>
      <div class="color-wrap"><button class="pip-tool" id="pipAnnColor" title="Pencil color"><span class="dot" id="pipAnnColorDot"></span><small>Color</small></button><div class="palette" id="pipAnnPalette">
        <button data-pip-color="#ff2f2f" style="--sw:#ff2f2f"></button><button data-pip-color="#ff9f1c" style="--sw:#ff9f1c"></button><button data-pip-color="#ffd60a" style="--sw:#ffd60a"></button><button data-pip-color="#25d366" style="--sw:#25d366"></button>
        <button data-pip-color="#20b7ff" style="--sw:#20b7ff"></button><button data-pip-color="#7b61ff" style="--sw:#7b61ff"></button><button data-pip-color="#ffffff" style="--sw:#ffffff"></button><button data-pip-color="#111111" style="--sw:#111111"></button>
      </div></div>
      <button class="pip-tool" data-pip-tool="line"><span class="ico">╱</span><small>Line</small></button><button class="pip-tool" data-pip-tool="arrow"><span class="ico">→</span><small>Arrow</small></button><button class="pip-tool" data-pip-tool="rect"><span class="ico">□</span><small>Rectangle</small></button><button class="pip-tool" data-pip-tool="circle"><span class="ico">○</span><small>Circle</small></button><button class="pip-tool" data-pip-tool="text"><span class="ico">T</span><small>Text</small></button>
      <span class="sep"></span><button class="pip-tool" id="pipAnnUndo"><span class="ico">↶</span><small>Undo</small></button><button class="pip-tool" id="pipAnnRedo"><span class="ico">↷</span><small>Redo</small></button><span class="sep"></span>
      <button class="pip-tool" id="pipAnnMove" title="Drag this floating window itself to move it"><span class="ico">✥</span><small>Move</small></button><button class="pip-tool min-btn" id="pipAnnMin"><span class="ico">−</span><small>Minimize</small></button>
    </div><div class="move-note">Move: drag the floating window</div><div class="status" id="pipAnnStatus"></div></div><div class="mini"><button id="pipAnnRestore">✎ Annotate</button></div>`;

    d.querySelectorAll('[data-pip-tool]').forEach(btn=>btn.addEventListener('click',()=>{
      $('#annotationToolbar [data-ann-tool="'+btn.dataset.pipTool+'"]')?.click();
      syncPersistentAnnotationToolbar();
    }));
    d.getElementById('pipAnnColor')?.addEventListener('click',()=>d.getElementById('pipAnnPalette')?.classList.toggle('open'));
    d.querySelectorAll('[data-pip-color]').forEach(btn=>btn.addEventListener('click',()=>{
      const color=btn.dataset.pipColor;const mainBtn=$('#annColorPalette [data-ann-color="'+color+'"]');
      if(mainBtn)mainBtn.click();else{annotationColor=color;syncPersistentAnnotationToolbar()}
      d.getElementById('pipAnnPalette')?.classList.remove('open');
    }));
    d.getElementById('pipAnnUndo')?.addEventListener('click',()=>{$('#annUndo')?.click();syncPersistentAnnotationToolbar()});
    d.getElementById('pipAnnRedo')?.addEventListener('click',()=>{$('#annRedo')?.click();syncPersistentAnnotationToolbar()});
    d.getElementById('pipAnnMove')?.addEventListener('click',()=>{
      const n=d.querySelector('.move-note');if(n){n.textContent='Move: drag this floating window';setTimeout(()=>{if(n)n.textContent='Move: drag the floating window'},1600)}
    });
    d.getElementById('pipAnnMin')?.addEventListener('click',()=>{
      annotationPipMinimized=true;d.body.classList.add('minimized');try{w.resizeTo(190,82)}catch{}
    });
    d.getElementById('pipAnnRestore')?.addEventListener('click',()=>{
      annotationPipMinimized=false;d.body.classList.remove('minimized');try{w.resizeTo(920,92)}catch{};syncPersistentAnnotationToolbar();
    });
    d.addEventListener('pointerdown',e=>{if(!e.target.closest('.color-wrap'))d.getElementById('pipAnnPalette')?.classList.remove('open')});
    syncPersistentAnnotationToolbar();
  }

  async function openPersistentAnnotationToolbar(){
    if(!isHost()||annotationPipOpening)return;
    if(annotationPipWindow&&!annotationPipWindow.closed){try{annotationPipWindow.focus()}catch{};syncPersistentAnnotationToolbar();return}
    annotationPipOpening=true;
    try{
      let w=null;
      if(window.documentPictureInPicture?.requestWindow){
        w=await window.documentPictureInPicture.requestWindow({width:920,height:92});
      }else{
        w=window.open('','MNTAnnotationToolbar','popup=yes,width=920,height=120,resizable=yes,scrollbars=no');
        if(!w)throw new Error('Floating toolbar window was blocked');
      }
      annotationPipWindow=w;annotationPipMinimized=false;
      renderPersistentAnnotationToolbar(w);
      const onClose=()=>{if(annotationPipWindow===w){annotationPipWindow=null;annotationPipMinimized=false;updateAnnotationFloatButton()}};
      w.addEventListener?.('pagehide',onClose,{once:true});
      w.addEventListener?.('unload',onClose,{once:true});
    }catch(e){
      console.warn('floating annotation toolbar',e);
      annotationPipWindow=null;
      updateAnnotationFloatButton();
      if(screenOwnerId)alert('Floating toolbar එක open කරන්න Annotate button එක click කරන්න. Browser එක Picture-in-Picture/Pop-up allow කරන්න.');
    }finally{annotationPipOpening=false}
  }

  function resizeAnnotationCanvas(){
    const c=$('#annotationCanvas');if(!c)return;const main=document.querySelector('#videoGrid .main-tile');if(!main)return;
    const r=main.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1);
    const cssW=Math.max(1,Math.round(r.width)),cssH=Math.max(1,Math.round(r.height));
    c.style.width=`${cssW}px`;c.style.height=`${cssH}px`;c.width=Math.max(1,Math.round(cssW*dpr));c.height=Math.max(1,Math.round(cssH*dpr));
    drawAnnotations();
  }
  function updateAnnotationLayer(){
    ensureAnnotationUI();const c=$('#annotationCanvas'),bar=$('#annotationToolbar');if(!c||!bar)return;
    const active=!!screenOwnerId&&selectedPeerId===screenOwnerId;const main=document.querySelector('#videoGrid .main-tile');
    if(main&&!main.contains(c))main.appendChild(c);
    c.classList.toggle('visible',active);
    bar.classList.toggle('visible',active&&isHost()&&!annotationToolbarClosed);
    if(!active){annotationTool='select';annotationEnabled=false;c.style.pointerEvents='none';bar.querySelectorAll('[data-ann-tool]').forEach(b=>b.classList.toggle('active',b.dataset.annTool==='select'))}
    updateAnnotationFloatButton();
    syncPersistentAnnotationToolbar();
    if(active&&isHost()&&!annotationPipWindow&&navigator.userActivation?.isActive){openPersistentAnnotationToolbar().catch(()=>{})}
    resizeAnnotationCanvas();
  }
  function getAnnotationContentRect(c){
    const cr=c?.getBoundingClientRect?.();
    if(!cr)return{left:0,top:0,width:1,height:1,offsetX:0,offsetY:0};
    const main=c.closest?.('.main-tile')||document.querySelector('#videoGrid .main-tile');
    const v=main?.querySelector?.('video');
    if(!v)return{left:cr.left,top:cr.top,width:cr.width,height:cr.height,offsetX:0,offsetY:0};
    const vw=v.videoWidth||0,vh=v.videoHeight||0;
    if(!vw||!vh)return{left:cr.left,top:cr.top,width:cr.width,height:cr.height,offsetX:0,offsetY:0};
    const scale=Math.min(cr.width/vw,cr.height/vh);
    const width=vw*scale,height=vh*scale,offsetX=(cr.width-width)/2,offsetY=(cr.height-height)/2;
    return{left:cr.left+offsetX,top:cr.top+offsetY,width,height,offsetX,offsetY};
  }

  function drawAnnotations(extra){
    const c=$('#annotationCanvas');if(!c)return;const ctx=c.getContext('2d');if(!ctx)return;
    const dpr=Math.min(2,window.devicePixelRatio||1),w=c.width,h=c.height,cssW=w/dpr,cssH=h/dpr;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,cssW,cssH);ctx.lineCap='round';ctx.lineJoin='round';
    const all=extra?[...annotationStrokes,extra]:annotationStrokes;
    const content=getAnnotationContentRect(c);
    const sx=cssW/Math.max(1,c.getBoundingClientRect().width),sy=cssH/Math.max(1,c.getBoundingClientRect().height);
    const ox=content.offsetX*sx,oy=content.offsetY*sy,cw=content.width*sx,ch=content.height*sy;
    const xy=p=>({x:ox+(p?.x||0)*cw,y:oy+(p?.y||0)*ch});
    const baseWidth=Math.max(2.5,Math.min(cw,ch)/220);
    const drawOne=item=>{
      if(!item)return;
      // Backward compatibility with the old pencil-array format.
      if(Array.isArray(item))item={type:'pen',color:'#ff2f2f',points:item};
      const type=item.type||'pen',color=item.color||'#ff2f2f';ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=baseWidth;
      if(type==='text'){
        const p=xy(item.point||item.points?.[0]);ctx.font=`700 ${Math.max(16,Math.round(Math.min(cssW,cssH)*.045))}px Inter,Segoe UI,Arial`;ctx.textBaseline='top';ctx.fillText(String(item.text||''),p.x,p.y);return;
      }
      const pts=Array.isArray(item.points)?item.points:[];if(!pts.length)return;
      if(type==='pen'){
        ctx.beginPath();const a=xy(pts[0]);ctx.moveTo(a.x,a.y);for(let i=1;i<pts.length;i++){const p=xy(pts[i]);ctx.lineTo(p.x,p.y)}ctx.stroke();return;
      }
      const a=xy(pts[0]),b=xy(pts[1]||pts[0]);
      if(type==='line'||type==='arrow'){
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
        if(type==='arrow'){
          const ang=Math.atan2(b.y-a.y,b.x-a.x),len=Math.max(12,Math.min(28,Math.hypot(b.x-a.x,b.y-a.y)*.16));
          ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-len*Math.cos(ang-Math.PI/6),b.y-len*Math.sin(ang-Math.PI/6));ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-len*Math.cos(ang+Math.PI/6),b.y-len*Math.sin(ang+Math.PI/6));ctx.stroke();
        }
        return;
      }
      if(type==='rect'){ctx.strokeRect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x),Math.abs(b.y-a.y));return}
      if(type==='circle'){
        const cx=(a.x+b.x)/2,cy=(a.y+b.y)/2,rx=Math.abs(b.x-a.x)/2,ry=Math.abs(b.y-a.y)/2;ctx.beginPath();ctx.ellipse(cx,cy,Math.max(.5,rx),Math.max(.5,ry),0,0,Math.PI*2);ctx.stroke();return;
      }
    };
    all.forEach(drawOne);
  }
  async function sendAnnotationState(){await publishData({kind:'annotation-state',strokes:annotationStrokes},true)}
  async function sendAnnotationLive(stroke){await publishData({kind:'annotation-live',strokes:annotationStrokes,live:stroke},false)}

  async function publishData(obj,reliable=true){if(!room)return;try{const bytes=new TextEncoder().encode(JSON.stringify(obj));await room.localParticipant.publishData(bytes,{reliable})}catch(e){console.warn('LiveKit data',e)}}
  async function sendAnnotationState(){await publishData({kind:'annotation-state',strokes:annotationStrokes},true)}
  async function sendAnnotationLive(stroke){await publishData({kind:'annotation-live',strokes:annotationStrokes,live:stroke},false)}

  function renderPeople(){
    const box=$('#participantsPanel .messages');if(!box)return;
    const arr=[{id:peerId,name,local:true},...(room?[...room.remoteParticipants.values()].map(p=>({id:p.identity,name:displayNameForParticipant(p)})):[])];
    box.innerHTML=`<p class="participant-count"><b>Participants (${arr.length})</b></p>`+
      arr.map(x=>`<p class="participant-row" data-focus-peer="${esc(x.id)}">🎙 <b>${esc(x.name)}${x.local?' (You)':''}</b></p>`).join('');
    box.querySelectorAll('[data-focus-peer]').forEach(row=>row.addEventListener('click',()=>{
      const id=row.dataset.focusPeer;
      requestAppFullscreen();
      selectMainTile(id,true);
      window.MNTMeetingUI?.closePanel?.();
    }));
  }
  function ensureParticipantTiles(){if(room){tile(peerId,name);for(const p of room.remoteParticipants.values())tile(p.identity,displayNameForParticipant(p));}applyVideoLayout();}

  async function fetchToken(code){
    const identity=identityFor();
    const res=await fetch(TOKEN_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','apikey':window.MNT_SUPABASE_PUBLISHABLE_KEY||''},body:JSON.stringify({room_name:code,participant_identity:identity,participant_name:name})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||`Token request failed (${res.status})`);
    return data;
  }
  async function join(rawCode,n='Guest',title='MNTchnology Meeting',asHost=false){
    const code=cleanCode(rawCode);if(!code){alert('Meeting code or link enter කරන්න.');return}
    await leave(true);
    activeCode=code;activeTitle=title||'MNTchnology Meeting';name=(n||'Guest').trim().slice(0,40)||'Guest';role=asHost?'Host':'Guest';
    participantFocus=false;pipPosition=null;selectedPeerId=peerId;screenOwnerId=null;annotationStrokes=[];redoStrokes=[];annotationTool='select';annotationEnabled=false;annotationToolbarClosed=false;$('#videoGrid').innerHTML='';
    window.dispatchEvent(new CustomEvent('mnt-role-changed',{detail:{role}}));
    showPage('room');setRoomMeta(activeTitle,'Connecting to LiveKit…');ensureAnnotationUI();
    try{
      const creds=await fetchToken(code);
      room=new LK.Room({adaptiveStream:true,dynacast:true});
      room.on(LK.RoomEvent.TrackSubscribed,(track,publication,participant)=>{attachTrack(track,participant,publication.source);setRoomMeta(activeTitle,`● ${room.remoteParticipants.size+1} participant${room.remoteParticipants.size+1===1?'':'s'}`);renderPeople();updateAnnotationLayer()});
      room.on(LK.RoomEvent.TrackUnsubscribed,(track,publication,participant)=>{detachTrack(track,participant,publication.source);renderPeople();updateAnnotationLayer()});
      room.on(LK.RoomEvent.ParticipantConnected,p=>{tile(p.identity,displayNameForParticipant(p));renderPeople();applyVideoLayout();setRoomMeta(activeTitle,`● ${room.remoteParticipants.size+1} participants`)});
      room.on(LK.RoomEvent.ParticipantDisconnected,p=>{
        document.querySelector(`[data-peer-tile="${CSS.escape(p.identity)}"]`)?.remove();
        document.querySelector(`[data-peer-tile="${CSS.escape('screen:'+p.identity)}"]`)?.remove();
        if(selectedPeerId===p.identity||selectedPeerId===`screen:${p.identity}`){participantFocus=false;selectedPeerId=peerId}
        renderPeople();applyVideoLayout();setRoomMeta(activeTitle,`● ${room.remoteParticipants.size+1} participant${room.remoteParticipants.size+1===1?'':'s'}`);updateAnnotationLayer()
      });
      room.on(LK.RoomEvent.LocalTrackPublished,(publication)=>{
        const track=publication.track;
        if(publication.source===LK.Track.Source.Camera){
          const attached=track?.attach?.();
          const el=Array.isArray(attached)?attached[0]:attached;
          if(el){putVideo(peerId,el,name,'camera',true)}
        }
        if(publication.source===LK.Track.Source.ScreenShare){
          screenPublishing=true;
          const attached=track?.attach?.();
          const el=Array.isArray(attached)?attached[0]:attached;
          if(el){const t=tile(`screen:${identityFor()}`,name);t.dataset.kind='screen';t.classList.add('screen-share-tile');el.autoplay=true;el.playsInline=true;el.muted=true;el.style.width='100%';el.style.height='100%';el.style.objectFit='contain';t.prepend(el);el.play?.().catch(()=>{})}
          setScreenOwner(identityFor(),true)
        }
      });
      room.on(LK.RoomEvent.LocalTrackUnpublished,(publication)=>{if(publication.source===LK.Track.Source.ScreenShare){screenPublishing=false;document.querySelector(`[data-peer-tile="${CSS.escape('screen:'+identityFor())}"]`)?.remove();setScreenOwner(identityFor(),false)}});
      room.on(LK.RoomEvent.DataReceived,(payload,participant)=>{try{const msg=JSON.parse(new TextDecoder().decode(payload));if(msg.kind==='chat'){chatAdd(msg.name||displayNameForParticipant(participant),msg.text,msg.time)}else if(msg.kind==='annotation-state'&&participant?.identity!==identityFor()){annotationStrokes=Array.isArray(msg.strokes)?msg.strokes:[];redoStrokes=[];drawAnnotations()}else if(msg.kind==='annotation-live'&&participant?.identity!==identityFor()){annotationStrokes=Array.isArray(msg.strokes)?msg.strokes:[];drawAnnotations(msg.live||null)}}catch{}});
      room.on(LK.RoomEvent.Disconnected,()=>setRoomMeta(activeTitle,'Disconnected'));
      await room.connect(creds.server_url,creds.participant_token);
      ensureParticipantTiles();
      setDefaultMain(peerId);
      await room.localParticipant.setCameraEnabled(true);
      renderLocalCamera();
      setDefaultMain(peerId);
      await room.localParticipant.setMicrophoneEnabled(true);
      setRoomMeta(activeTitle,`● ${room.remoteParticipants.size+1} participant${room.remoteParticipants.size+1===1?'':'s'}`);
      renderPeople();
    }catch(e){console.error(e);setRoomMeta(activeTitle,'Connection error');alert(`Meeting connect wenne naha. ${e.message||''}`);await leave(true)}
  }

  async function leave(silent=false){
    try{if(meetingRecorder&&meetingRecorder.state!=='inactive')meetingRecorder.stop()}catch{}
    try{if(room){await room.disconnect()}}catch{}
    closePersistentAnnotationToolbar();
    room=null;screenPublishing=false;participantFocus=false;activeCode='';screenOwnerId=null;annotationStrokes=[];redoStrokes=[];annotationTool='select';annotationEnabled=false;annotationToolbarClosed=false;selectedPeerId=null;$('#videoGrid').innerHTML='';
    $('#room .meeting-room')?.classList.remove('mnt-guest-landscape-share');
    window.MNTMeetingUI?.closePanel?.();
    if(!silent){showPage('home');await exitAppFullscreen()}
  }
  async function startScreen(){
    if(!room||screenPublishing)return;
    try{await room.localParticipant.setScreenShareEnabled(true,{audio:true,selfBrowserSurface:'exclude',surfaceSwitching:'include',systemAudio:'include'});setScreenOwner(identityFor(),true)}catch(e){console.warn('screen share',e)}
  }
  async function stopScreen(){if(!room||!screenPublishing)return;try{await room.localParticipant.setScreenShareEnabled(false)}catch{}screenPublishing=false;closePersistentAnnotationToolbar()}

  const create=safeClone($('#createBtn'));if(create)create.addEventListener('click',async()=>{requestAppFullscreen();const n=($('#meetingName')?.value||'Team Meeting').trim()||'Team Meeting';const pw=$('#meetingPassword')?.value||'';const code=Math.random().toString(36).slice(2,8);localStorage.setItem('mnt_last_meeting',JSON.stringify({name:n,code,password:pw,createdAt:new Date().toISOString()}));$('#shareBox span').textContent=roomLink(code);await join(code,'Host',n,true)});
  const copy=safeClone($('#copyBtn'));if(copy)copy.addEventListener('click',async()=>{const t=$('#shareBox span').textContent;try{await navigator.clipboard.writeText(t);alert('Meeting link copied.')}catch{alert(t)}});
  const joinBtn=safeClone($('#joinMeetingBtn'));if(joinBtn)joinBtn.addEventListener('click',()=>{requestAppFullscreen();join($('#joinCode')?.value,$('#joinName')?.value||'Guest')});
  const oldRoomJoin=$('#meetingsList [data-page="room"]');if(oldRoomJoin){const c=safeClone(oldRoomJoin);c.removeAttribute('data-page');c.addEventListener('click',()=>{const x=JSON.parse(localStorage.getItem('mnt_last_meeting')||'null');if(x)join(x.code,'Guest',x.name);else showPage('join')})}
  const sched=safeClone($('#scheduleBtn'));if(sched)sched.addEventListener('click',()=>{const n=($('#scheduleName')?.value||'Scheduled Meeting').trim()||'Scheduled Meeting',date=$('#scheduleDate')?.value,time=$('#scheduleTime')?.value,duration=$('#scheduleDuration')?.value||'60';if(!date||!time){alert('Date and time select කරන්න.');return}const code=Math.random().toString(36).slice(2,8),label=duration==='0'?'Unlimited':duration+' minutes',m={name:n,date,time,duration,durationLabel:label,code,password:$('#schedulePassword')?.value||'',link:roomLink(code),createdAt:new Date().toISOString()};const a=getMeetings();a.push(m);a.sort((x,y)=>(x.date+'T'+x.time).localeCompare(y.date+'T'+y.time));saveMeetings(a);renderSchedule();$('#scheduleResult').style.display='block';$('#scheduleResult').innerHTML=`✓ Meeting scheduled. Link: <span>${esc(m.link)}</span> <button id="copyScheduledLink">▣</button>`;$('#copyScheduledLink').onclick=async()=>{try{await navigator.clipboard.writeText(m.link);alert('Meeting link copied.')}catch{alert(m.link)}}});
  function renderSchedule(){const box=$('#scheduledList');if(!box)return;const a=getMeetings();if(!a.length){box.innerHTML='<div class="form-note">No scheduled meetings yet.</div>';return}box.innerHTML='<h3>Upcoming Meetings</h3>'+a.map((m,i)=>{const code=m.code||cleanCode(m.link);const link=code?roomLink(code):(m.link||'');return `<div><b>${esc(m.name)}</b><span>${esc(m.date)} · ${esc(m.time)} · ${esc(m.durationLabel)}</span><button type="button" class="primary small" data-v45join="${i}">Join</button><button type="button" class="secondary small" data-v45copy="${i}">Copy Link</button></div>`}).join('');box.querySelectorAll('[data-v45join]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const m=a[Number(b.dataset.v45join)];const code=m?.code||cleanCode(m?.link);if(!code){alert('Meeting code or link enter කරන්න.');return}requestAppFullscreen();join(code,'Host',m.name,true)}));box.querySelectorAll('[data-v45copy]').forEach(b=>b.addEventListener('click',async e=>{e.preventDefault();e.stopPropagation();const m=a[Number(b.dataset.v45copy)];const code=m?.code||cleanCode(m?.link);const link=code?roomLink(code):(m?.link||'');try{await navigator.clipboard.writeText(link);alert('Meeting link copied.')}catch{alert(link)}}))}
  renderSchedule();
  const leaveBtn=safeClone($('#room .leave'));if(leaveBtn){leaveBtn.removeAttribute('data-page');leaveBtn.addEventListener('click',()=>leave(false))}
  const chatBtn=safeClone($('#chatBtn'));if(chatBtn)chatBtn.addEventListener('click',()=>window.MNTMeetingUI?.togglePanel?.('chat'));
  const closeChat=safeClone($('#closeChat'));if(closeChat)closeChat.addEventListener('click',()=>window.MNTMeetingUI?.closePanel?.());
  const chatAdd=(who,text,time)=>{const box=$('#chatPanel .messages');if(!box)return;const p=document.createElement('p');p.innerHTML=`<b>${esc(who)}</b> <small>${esc(time||'')}</small><br>${esc(text)}`;box.appendChild(p);box.scrollTop=box.scrollHeight};
  const chatSend=safeClone($('#chatPanel .chat-input button'));if(chatSend)chatSend.addEventListener('click',async()=>{const input=$('#chatPanel .chat-input input'),text=(input?.value||'').trim();if(!text)return;const time=new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});chatAdd('You',text,time);input.value='';await publishData({kind:'chat',name,text,time},true)});
  const chatInput=$('#chatPanel .chat-input input');chatInput?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();chatSend?.click()}});
  const peopleBtn=safeClone($('#peopleBtn'));if(peopleBtn)peopleBtn.addEventListener('click',()=>{window.MNTMeetingUI?.togglePanel?.('participants');renderPeople()});
  const controls=$$('#room .room-controls > button');const mic=controls[0],cam=controls[1],share=$('#room .share');
  const switchCamBtn=document.createElement('button');
  switchCamBtn.id='switchCameraBtn';
  switchCamBtn.innerHTML='<small>Switch Cam</small>';
  switchCamBtn.title='Switch front / back camera or webcam';
  switchCamBtn.setAttribute('aria-label','Switch camera');
  $('#room .room-controls')?.insertBefore(switchCamBtn,share);
  switchCamBtn.addEventListener('click',async()=>{
    if(!room||!navigator.mediaDevices?.enumerateDevices)return;
    try{
      const cameraPub=room.localParticipant.getTrackPublication(LK.Track.Source.Camera);
      const currentTrack=cameraPub?.track?.mediaStreamTrack;
      const activeDeviceId=currentTrack?.getSettings?.().deviceId||currentCameraDeviceId||'';
      const cams=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput'&&d.deviceId);
      if(cams.length<2){alert('මෙම device එකේ මාරු කරන්න වෙනත් camera එකක් හමු වුණේ නැහැ.');return}
      let idx=cams.findIndex(d=>d.deviceId===activeDeviceId);
      if(idx<0)idx=0;
      const next=cams[(idx+1)%cams.length];
      currentCameraDeviceId=next.deviceId;
      switchCamBtn.disabled=true;
      await room.switchActiveDevice('videoinput',next.deviceId);
      setTimeout(renderLocalCamera,120);
    }catch(e){
      console.warn('camera switch',e);
      alert('Camera මාරු කරන්න බැරි වුණා. Camera permission එක check කරන්න.');
    }finally{
      switchCamBtn.disabled=false;
    }
  });
  mic?.addEventListener('click',async()=>{if(!room)return;const p=room.localParticipant;const pub=p.getTrackPublication(LK.Track.Source.Microphone);const enabled=!!pub&&!pub.isMuted;p.setMicrophoneEnabled(!enabled);mic.classList.toggle('active-control',!enabled);mic.querySelector('small').textContent=!enabled?'Mute':'Unmute'});
  cam?.addEventListener('click',async()=>{if(!room)return;const p=room.localParticipant;const pub=p.getTrackPublication(LK.Track.Source.Camera);const enabled=!!pub&&!pub.isMuted;p.setCameraEnabled(!enabled);cam.classList.toggle('active-control',!enabled);cam.querySelector('small').textContent=!enabled?'Stop Video':'Start Video'});
  share?.addEventListener('click',async()=>{if(screenPublishing){await stopScreen()}else{await startScreen();updateAnnotationFloatButton();if(isHost()&&navigator.userActivation?.isActive&&!annotationPipWindow)openPersistentAnnotationToolbar().catch(()=>{})}});

  const moreBtn=[...$('#room .room-controls')?.querySelectorAll(':scope > button')||[]].find(b=>!b.classList.contains('leave')&&b.textContent.includes('More'));
  function formatRecordTime(ms){
    const total=Math.max(0,Math.floor(ms/1000));
    const m=String(Math.floor(total/60)).padStart(2,'0');
    const s=String(total%60).padStart(2,'0');
    return `${m}:${s}`;
  }
  function currentRecordedMs(){
    if(!meetingRecordStartedAt)return 0;
    const now=performance.now();
    const pausedNow=meetingRecorder?.state==='paused'&&meetingRecordPausedAt?now-meetingRecordPausedAt:0;
    return Math.max(0,now-meetingRecordStartedAt-meetingRecordPausedTotal-pausedNow);
  }
  function ensureRecordingDock(){
    let dock=document.getElementById('mntRecordingDock');
    if(dock)return dock;
    dock=document.createElement('div');
    dock.id='mntRecordingDock';
    dock.innerHTML='<span id="mntRecordingDockStatus">● REC 00:00</span><button type="button" id="mntRecordingPauseBtn">Ⅱ Pause</button><button type="button" id="mntRecordingStopBtn">■ Stop</button>';
    $('#room .meeting-room')?.appendChild(dock);
    dock.querySelector('#mntRecordingPauseBtn')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();toggleRecordingPause()});
    dock.querySelector('#mntRecordingStopBtn')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();stopMeetingRecording()});
    return dock;
  }
  function updateRecordingDock(){
    const state=meetingRecorder?.state||'inactive';
    const active=isHost()&&(state==='recording'||state==='paused');
    const dock=document.getElementById('mntRecordingDock');
    if(!active){dock?.remove();if(meetingRecordUiTimer){clearInterval(meetingRecordUiTimer);meetingRecordUiTimer=0}return}
    const d=ensureRecordingDock();
    const status=d.querySelector('#mntRecordingDockStatus');
    const pause=d.querySelector('#mntRecordingPauseBtn');
    if(status)status.textContent=state==='paused'?`Ⅱ PAUSED ${formatRecordTime(currentRecordedMs())}`:`● REC ${formatRecordTime(currentRecordedMs())}`;
    if(pause)pause.textContent=state==='paused'?'▶ Resume':'Ⅱ Pause';
    d.classList.toggle('paused',state==='paused');
    if(!meetingRecordUiTimer)meetingRecordUiTimer=setInterval(()=>{if(meetingRecorder?.state==='recording'||meetingRecorder?.state==='paused')updateRecordingDock();else{clearInterval(meetingRecordUiTimer);meetingRecordUiTimer=0}},500);
  }
  function syncHostRecordControl(){
    if(!moreBtn)return;
    moreBtn.classList.toggle('mnt-record-control',isHost());
    moreBtn.dataset.hostRecord=isHost()?'1':'0';
    const small=moreBtn.querySelector('small');
    const state=meetingRecorder?.state||'inactive';
    if(small)small.textContent=isHost()?((state==='recording'||state==='paused')?'Stop Rec':'Record'):'More';
    let badge=document.getElementById('mntRecordingBadge');
    if(isHost()&&(state==='recording'||state==='paused')){
      if(!badge){badge=document.createElement('div');badge.id='mntRecordingBadge';$('#room .meeting-room')?.appendChild(badge)}
      badge.textContent=state==='paused'?'Ⅱ PAUSED':'● REC';
      badge.classList.toggle('paused',state==='paused');
    }else badge?.remove();
    updateRecordingDock();
  }
  function drawVideoFit(ctx,video,x,y,w,h,fit='cover'){
    const vw=video?.videoWidth||0,vh=video?.videoHeight||0;
    if(!vw||!vh||video.readyState<2){ctx.fillStyle='#071329';ctx.fillRect(x,y,w,h);return}
    const sr=vw/vh,dr=w/h;
    let sx=0,sy=0,sw=vw,sh=vh,dx=x,dy=y,dw=w,dh=h;
    if(fit==='contain'){
      if(sr>dr){dh=w/sr;dy=y+(h-dh)/2}else{dw=h*sr;dx=x+(w-dw)/2}
    }else{
      if(sr>dr){sw=vh*dr;sx=(vw-sw)/2}else{sh=vw/dr;sy=(vh-sh)/2}
    }
    try{ctx.drawImage(video,sx,sy,sw,sh,dx,dy,dw,dh)}catch{ctx.fillStyle='#071329';ctx.fillRect(x,y,w,h)}
  }
  function currentScreenVideo(){
    const tiles=[...document.querySelectorAll('#videoGrid .tile[data-kind="screen"]')];
    const preferred=tiles.find(t=>t.dataset.peerTile===screenOwnerId)||tiles.find(t=>t.classList.contains('screen-share-tile'))||tiles[0];
    const v=preferred?.querySelector('video');
    return v&&v.readyState>=2?v:null;
  }
  function currentSelfVideo(){
    const t=document.querySelector(`[data-peer-tile="${CSS.escape(peerId)}"]`);
    const v=t?.querySelector('video');
    return v&&v.readyState>=2?v:null;
  }
  async function buildMeetingRecordingStream(){
    const grid=$('#videoGrid');
    if(!grid)throw new Error('Meeting video area not found');
    if(!window.MediaRecorder)throw new Error('MediaRecorder not supported');
    const captureSupported=!!HTMLCanvasElement.prototype.captureStream;
    if(!captureSupported){
      if(navigator.mediaDevices?.getDisplayMedia)return navigator.mediaDevices.getDisplayMedia({video:true,audio:true});
      throw new Error('Recording is not supported in this browser');
    }
    const gr=grid.getBoundingClientRect();
    const aspect=(gr.width>10&&gr.height>10)?gr.width/gr.height:16/9;
    const maxW=1280,maxH=720;
    let cw=maxW,ch=Math.round(maxW/aspect);
    if(ch>maxH){ch=maxH;cw=Math.round(maxH*aspect)}
    cw=Math.max(360,cw);ch=Math.max(240,ch);
    const canvas=document.createElement('canvas');canvas.width=cw;canvas.height=ch;meetingRecordCanvas=canvas;
    const ctx=canvas.getContext('2d',{alpha:false});
    const draw=()=>{
      if(!meetingRecordCanvas)return;
      const currentGrid=$('#videoGrid');
      const r=currentGrid?.getBoundingClientRect();
      ctx.fillStyle='#020b1d';ctx.fillRect(0,0,cw,ch);

      /* If any screen is being shared, always record that screen full-size.
         This is independent of whether the tile is hidden by the host UI. */
      const shared=currentScreenVideo();
      if(shared){
        drawVideoFit(ctx,shared,0,0,cw,ch,'contain');
        const self=currentSelfVideo();
        if(self){
          const pw=Math.round(cw*.22),ph=Math.round(pw*9/16),pad=Math.round(cw*.018);
          const px=cw-pw-pad,py=ch-ph-pad;
          ctx.fillStyle='#071329';ctx.fillRect(px,py,pw,ph);
          drawVideoFit(ctx,self,px,py,pw,ph,'cover');
          ctx.strokeStyle='#ffffff';ctx.lineWidth=Math.max(2,Math.round(cw/640));ctx.strokeRect(px,py,pw,ph);
        }
      }else if(currentGrid&&r&&r.width>0&&r.height>0){
        const scaleX=cw/r.width,scaleY=ch/r.height;
        [...currentGrid.querySelectorAll('.tile')].forEach(t=>{
          const cs=getComputedStyle(t);if(cs.display==='none'||cs.visibility==='hidden'||t.offsetWidth===0||t.offsetHeight===0)return;
          const tr=t.getBoundingClientRect();
          const x=(tr.left-r.left)*scaleX,y=(tr.top-r.top)*scaleY,w=tr.width*scaleX,h=tr.height*scaleY;
          ctx.fillStyle='#071329';ctx.fillRect(x,y,w,h);
          const v=t.querySelector('video');
          if(v)drawVideoFit(ctx,v,x,y,w,h,t.dataset.kind==='screen'?'contain':'cover');
          ctx.strokeStyle='#173052';ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);
        });
      }
      meetingRecordRaf=requestAnimationFrame(draw);
    };
    draw();
    meetingRecordCanvasStream=canvas.captureStream(30);
    const output=new MediaStream();
    meetingRecordCanvasStream.getVideoTracks().forEach(t=>output.addTrack(t));

    const AC=window.AudioContext||window.webkitAudioContext;
    if(AC&&room){
      try{
        meetingRecordAudioCtx=new AC();
        await meetingRecordAudioCtx.resume?.();
        meetingRecordAudioDest=meetingRecordAudioCtx.createMediaStreamDestination();
        const seen=new Set();
        const addAudioTrack=(mst)=>{
          if(!mst||mst.kind!=='audio'||seen.has(mst.id))return;
          seen.add(mst.id);
          try{
            const src=meetingRecordAudioCtx.createMediaStreamSource(new MediaStream([mst]));
            src.connect(meetingRecordAudioDest);meetingRecordAudioSources.push(src);
          }catch(e){console.warn('record audio source',e)}
        };
        const collectParticipant=(p)=>{
          const pubs=p?.trackPublications?[...p.trackPublications.values()]:[];
          pubs.forEach(pub=>addAudioTrack(pub?.track?.mediaStreamTrack));
        };
        collectParticipant(room.localParticipant);
        for(const p of room.remoteParticipants.values())collectParticipant(p);
        meetingRecordAudioDest.stream.getAudioTracks().forEach(t=>output.addTrack(t));
      }catch(e){console.warn('record audio mix',e)}
    }
    return output;
  }
  function cleanupMeetingRecording(){
    if(meetingRecordRaf){cancelAnimationFrame(meetingRecordRaf);meetingRecordRaf=0}
    meetingRecordCanvasStream?.getTracks().forEach(t=>t.stop());
    meetingRecordCanvasStream=null;meetingRecordCanvas=null;
    meetingRecordAudioSources.forEach(s=>{try{s.disconnect()}catch{}});meetingRecordAudioSources=[];
    try{meetingRecordAudioDest?.stream?.getTracks()?.forEach(t=>t.stop())}catch{}
    meetingRecordAudioDest=null;
    try{meetingRecordAudioCtx?.close?.()}catch{}meetingRecordAudioCtx=null;
    meetingRecordStream?.getTracks().forEach(t=>t.stop());meetingRecordStream=null;
    meetingRecordStartedAt=0;meetingRecordPausedAt=0;meetingRecordPausedTotal=0;
    if(meetingRecordUiTimer){clearInterval(meetingRecordUiTimer);meetingRecordUiTimer=0}
    document.getElementById('mntRecordingDock')?.remove();
  }
  function stopMeetingRecording(){
    if(!meetingRecorder||meetingRecorder.state==='inactive')return;
    try{meetingRecorder.stop()}catch(e){console.warn('recording stop',e)}
  }
  function toggleRecordingPause(){
    if(!meetingRecorder||meetingRecorder.state==='inactive')return;
    try{
      if(meetingRecorder.state==='recording'){
        meetingRecorder.pause();
        meetingRecordPausedAt=performance.now();
      }else if(meetingRecorder.state==='paused'){
        if(meetingRecordPausedAt){meetingRecordPausedTotal+=performance.now()-meetingRecordPausedAt;meetingRecordPausedAt=0}
        meetingRecorder.resume();
      }
      syncHostRecordControl();
    }catch(e){console.warn('recording pause/resume',e);alert('Recording pause/resume කරන්න බැරි වුණා.')}
  }
  async function toggleMeetingRecording(){
    if(!isHost())return;
    if(meetingRecorder&&meetingRecorder.state!=='inactive'){stopMeetingRecording();return}
    try{
      meetingRecordChunks=[];
      meetingRecordStream=await buildMeetingRecordingStream();
      /* MP4 is preferred where the browser supports it because it saves with
         normal duration/index metadata, so the downloaded file can be seeked. */
      const mimeTypes=[
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp8',
        'video/webm'
      ];
      const mimeType=mimeTypes.find(x=>MediaRecorder.isTypeSupported?.(x))||'';
      meetingRecorder=new MediaRecorder(meetingRecordStream,mimeType?{mimeType,videoBitsPerSecond:4500000,audioBitsPerSecond:128000}:undefined);
      meetingRecorder.ondataavailable=e=>{if(e.data?.size)meetingRecordChunks.push(e.data)};
      meetingRecorder.onerror=e=>{console.warn('recording error',e);alert('Recording error එකක් ආවා. Browser permissions/check කරන්න.')};
      meetingRecorder.onpause=syncHostRecordControl;
      meetingRecorder.onresume=syncHostRecordControl;
      meetingRecorder.onstop=()=>{
        const recorder=meetingRecorder;
        const chunks=[...meetingRecordChunks];
        try{
          if(chunks.length){
            const type=recorder?.mimeType||mimeType||'video/webm';
            const blob=new Blob(chunks,{type});
            const isMp4=/mp4/i.test(type);
            const ext=isMp4?'mp4':'webm';
            const url=URL.createObjectURL(blob);
            const a=document.createElement('a');a.href=url;a.download=`MNTchnology-Meeting-${new Date().toISOString().replace(/[:.]/g,'-')}.${ext}`;
            document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
          }else alert('Recording data save වුණේ නැහැ. නැවත try කරන්න.');
        }catch(e){console.warn('recording save',e);alert('Recording save කරන්න බැරි වුණා.')}
        cleanupMeetingRecording();meetingRecorder=null;meetingRecordChunks=[];
        moreBtn?.classList.remove('mnt-recording');syncHostRecordControl();
      };
      /* No timeslice: let the browser finalize one indexed file on Stop.
         This gives normal seeking/fast-forward behavior in modern Chromium. */
      meetingRecorder.start();
      meetingRecordStartedAt=performance.now();meetingRecordPausedAt=0;meetingRecordPausedTotal=0;
      moreBtn?.classList.add('mnt-recording');syncHostRecordControl();
    }catch(e){
      console.warn('recording',e);cleanupMeetingRecording();meetingRecorder=null;meetingRecordChunks=[];moreBtn?.classList.remove('mnt-recording');syncHostRecordControl();
      alert(`Recording start කරන්න බැරි වුණා. ${e?.message||'Browser permission/support check කරන්න.'}`);
    }
  }
  moreBtn?.addEventListener('click',e=>{if(isHost()){e.preventDefault();e.stopPropagation();toggleMeetingRecording()}});
  window.addEventListener('mnt-role-changed',syncHostRecordControl);
  syncHostRecordControl();

  const urlCode=cleanCode(roomFromUrl());if(urlCode){const m=getMeetings().find(x=>x.code===urlCode),last=JSON.parse(localStorage.getItem('mnt_last_meeting')||'null');showPage('join');$('#joinCode').value=urlCode;$('#joinNote').textContent=m?`Meeting: ${m.name}`:(last?.code===urlCode?`Meeting: ${last.name}`:'Enter your name and join the meeting.')}
});

/* ================================================================
   MNT TECHNOLOGY — reference interface shell
   Keeps LiveKit behavior from the meeting core, but rearranges only
   the room DOM so it matches the supplied Meeting Room design.
   ================================================================ */
document.addEventListener('DOMContentLoaded',()=>{
  const roomPage=document.getElementById('room');
  const meeting=roomPage?.querySelector('.meeting-room');
  if(!roomPage||!meeting||meeting.dataset.referenceUi==='1') return;
  meeting.dataset.referenceUi='1';
  meeting.classList.add('mnt-reference-layout');

  const top=meeting.querySelector('.room-top');
  const grid=meeting.querySelector('#videoGrid');
  const controls=meeting.querySelector('.room-controls');
  const chat=meeting.querySelector('#chatPanel');
  if(!top||!grid||!controls||!chat) return;

  // Preserve the IDs used by the LiveKit core while rendering the supplied header.
  top.innerHTML=`
    <span id="roomTitle" class="mnt-hidden-meta">MNTchnology Meeting</span>
    <span id="roomMeta" class="mnt-hidden-meta">Connecting…</span>
    <div class="mnt-brand-cluster">
      <div class="mnt-brand-logo">MN</div>
      <div class="mnt-brand-copy">
        <div class="mnt-brand-name"><span class="mn">MN</span>Technology</div>
        <div class="mnt-brand-tag">Learn Technology</div>
      </div>
    </div>
    <div class="mnt-title-cluster">
      <div class="mnt-people-logo" aria-hidden="true">
        <svg viewBox="0 0 64 64" fill="currentColor"><circle cx="32" cy="18" r="9"/><circle cx="16" cy="23" r="7"/><circle cx="48" cy="23" r="7"/><path d="M18 50c0-11 6-18 14-18s14 7 14 18v2H18z"/><path d="M4 49c0-9 5-15 12-15 3 0 6 1 8 4-4 4-6 9-6 14H4zM60 49H46c0-5-2-10-6-14 2-2 5-4 8-4 7 0 12 6 12 15z"/></svg>
      </div>
      <div class="mnt-title-copy">
        <div class="mnt-title-main">Meeting Room</div>
        <div class="mnt-title-sub">Learn&nbsp;&nbsp;•&nbsp;&nbsp;Share&nbsp;&nbsp;•&nbsp;&nbsp;Grow</div>
      </div>
    </div>
    <div class="mnt-room-actions">
      <div class="mnt-timer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></svg><span id="mntMeetingTimer">00:00:00</span></div>
      <button type="button" class="mnt-reference-leave" id="mntReferenceLeave"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8V5H5v14h9v-3"/><path d="M10 12h10"/><path d="m17 9 3 3-3 3"/></svg><span>Leave Meeting</span></button>
    </div>`;

  let participants=meeting.querySelector('#participantsPanel');
  if(!participants){
    participants=document.createElement('aside');
    participants.id='participantsPanel';
    participants.className='chat-panel open';
    participants.innerHTML='<div class="chat-head">Participants</div><div class="messages"><p><b>Participants</b></p></div>';
  }else{
    participants.classList.remove('open');
  }
  chat.classList.remove('open');

  const body=document.createElement('div');
  body.className='mnt-meeting-body';
  const stage=document.createElement('div');
  stage.className='mnt-stage-column';
  const rail=document.createElement('div');
  rail.className='mnt-right-rail';
  top.insertAdjacentElement('afterend',body);
  body.append(stage,rail);
  stage.append(grid,controls);
  rail.append(participants,chat);

  // The desktop reference shows six bottom controls; keep the existing functional buttons.
  const buttons=[...controls.querySelectorAll(':scope > button')];
  const nonLeave=buttons.filter(b=>!b.classList.contains('leave') && b.id!=='switchCameraBtn');
  const more=nonLeave.find(b=>b.textContent.includes('More')) || nonLeave[nonLeave.length-1];
  if(more && !more.querySelector('small')) more.insertAdjacentHTML('beforeend','<small>More</small>');

  const oldLeave=controls.querySelector('.leave');
  document.getElementById('mntReferenceLeave')?.addEventListener('click',()=>oldLeave?.click());

  // Meeting duration timer. It runs only while the room page is visible.
  const timerEl=document.getElementById('mntMeetingTimer');
  let startedAt=null,timerId=null;
  const format=n=>String(n).padStart(2,'0');
  const renderTimer=()=>{
    if(!startedAt||!timerEl) return;
    const seconds=Math.max(0,Math.floor((Date.now()-startedAt)/1000));
    timerEl.textContent=`${format(Math.floor(seconds/3600))}:${format(Math.floor((seconds%3600)/60))}:${format(seconds%60)}`;
  };
  const syncRoomState=()=>{
    const active=roomPage.classList.contains('active-page');
    document.body.classList.toggle('mnt-in-room',active);
    if(active){
      if(!startedAt) startedAt=Date.now();
      if(!timerId){renderTimer();timerId=setInterval(renderTimer,1000)}
    }else if(timerId){clearInterval(timerId);timerId=null;startedAt=null;if(timerEl)timerEl.textContent='00:00:00'}
  };
  new MutationObserver(syncRoomState).observe(roomPage,{attributes:true,attributeFilter:['class']});
  syncRoomState();

  // Participants and Chat are closed by default. Only the selected panel opens.
  let activePanel=null;
  const ensureCloseButton=(panel)=>{
    const head=panel?.querySelector('.chat-head');if(!head)return;
    let btn=head.querySelector('button');
    if(!btn){btn=document.createElement('button');btn.type='button';btn.textContent='×';head.appendChild(btn)}
    btn.onclick=()=>window.MNTMeetingUI?.closePanel?.();
  };
  ensureCloseButton(participants);ensureCloseButton(chat);

  const closePanel=()=>{
    activePanel=null;
    meeting.classList.remove('mnt-panel-open','mnt-mobile-panel-open');
    rail.classList.remove('open');
    participants.classList.remove('open');
    chat.classList.remove('open');
  };
  const openPanel=(kind)=>{
    activePanel=kind;
    meeting.classList.add('mnt-panel-open');
    if(matchMedia('(max-width:820px)').matches)meeting.classList.add('mnt-mobile-panel-open');
    rail.classList.add('open');
    participants.classList.toggle('open',kind==='participants');
    chat.classList.toggle('open',kind==='chat');
  };
  const togglePanel=(kind)=>{
    if(activePanel===kind&&meeting.classList.contains('mnt-panel-open'))closePanel();
    else openPanel(kind);
  };
  window.MNTMeetingUI={...(window.MNTMeetingUI||{}),openPanel,closePanel,togglePanel};
  closePanel();

  // Escape closes panels and exits participant focus only through the existing tile toggle.
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&meeting.classList.contains('mnt-panel-open'))closePanel()});
});
