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
  let currentCameraDeviceId=null,screenPublishing=false;
  sessionStorage.setItem('mnt_peer_id',peerId);
  const isHost=()=>role==='Host';
  const setRoomMeta=(title,status)=>{$('#roomTitle').textContent=title||'MNTchnology Meeting';$('#roomMeta').textContent=status||''};
  const identityFor=()=>`${isHost()?'host':'guest'}-${peerId}`;
  const participantByIdentity=id=>room?.remoteParticipants?.get(id)||null;
  const displayNameForParticipant=p=>p?.name||p?.identity?.replace(/^(host|guest)-/,'')||'Guest';

  function tile(id,n){
    let t=document.querySelector(`[data-peer-tile="${CSS.escape(id)}"]`);if(t)return t;
    t=document.createElement('div');t.className='tile';t.dataset.peerTile=id;
    t.addEventListener('click',()=>selectMainTile(id));
    t.innerHTML=`<div class="avatar">${esc((n||'G').trim().charAt(0).toUpperCase()||'G')}</div><span>🎙 ${esc(n||'Guest')}${id===peerId?' (You)':''}</span>`;
    $('#videoGrid').appendChild(t);return t;
  }
  function selectMainTile(id){
    const grid=$('#videoGrid');
    if(selectedPeerId===id){
      selectedPeerId=null;
      $$('#videoGrid .tile').forEach(x=>x.classList.remove('main-tile'));
      grid?.classList.remove('focus-mode');
      updateAnnotationLayer();
      return;
    }
    selectedPeerId=id;
    $$('#videoGrid .tile').forEach(x=>x.classList.toggle('main-tile',x.dataset.peerTile===id));
    grid?.classList.add('focus-mode');
    updateAnnotationLayer();
  }
  function setScreenOwner(id,active){
    const sid=`screen:${id}`;const t=document.querySelector(`[data-peer-tile="${CSS.escape(sid)}"]`);
    if(t)t.classList.toggle('screen-share-tile',!!active);
    if(active){screenOwnerId=sid;selectMainTile(sid)}
    else if(screenOwnerId===sid){screenOwnerId=null;const fallback=[...document.querySelectorAll('#videoGrid .tile')].find(x=>x.dataset.peerTile===id)||document.querySelector('#videoGrid .tile');if(fallback)selectMainTile(fallback.dataset.peerTile)}
  }
  function putVideo(id,videoEl,n,type='camera',muted=false){
    const tileId=type==='screen'?`screen:${id}`:id;const t=tile(tileId,n);t.dataset.kind=type;
    let v=t.querySelector('video');
    if(videoEl?.tagName==='VIDEO'){
      if(v&&v!==videoEl)try{v.remove()}catch{}
      v=videoEl;
      v.autoplay=true;v.playsInline=true;v.muted=muted;v.setAttribute('playsinline','');
      v.style.display='block';v.style.width='100%';v.style.height='100%';v.style.objectFit='contain';v.style.background='#000';
      t.prepend(v);
    }else{
      if(!v){v=document.createElement('video');v.autoplay=true;v.playsInline=true;v.muted=muted;v.setAttribute('playsinline','');t.prepend(v)}
      if(videoEl?.srcObject)v.srcObject=videoEl.srcObject;
      v.style.display='block';v.style.width='100%';v.style.height='100%';v.style.objectFit='contain';
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
    else {const t=tile(type==='screen'?`screen:${id}`:id,n);t.dataset.kind=type;let old=t.querySelector('video');if(old)old.remove();el.autoplay=true;el.playsInline=true;el.classList.add('lk-track-video');el.style.width='100%';el.style.height='100%';el.style.objectFit='contain';el.style.background='#000';t.prepend(el);el.play?.().catch(()=>{});if(type==='screen'){t.classList.add('screen-share-tile');setScreenOwner(id,true)}}
  }
  function detachTrack(track,participant,source){
    try{track.detach().forEach(e=>e.remove())}catch{}
    if(source===LK.Track.Source.ScreenShare){document.querySelector(`[data-peer-tile="${CSS.escape('screen:'+participant.identity)}"]`)?.remove();setScreenOwner(participant.identity,false)}
  }

  function ensureAnnotationUI(){
    if($('#annotationToolbar'))return;
    const roomEl=$('#room .meeting-room');
    const bar=document.createElement('div');bar.id='annotationToolbar';bar.innerHTML='<button id="annPen" title="Pencil">✏️</button><button id="annUndo" title="Undo">↩️</button><button id="annRedo" title="Redo">↪️</button><button id="annClose" title="Close">×</button>';roomEl.appendChild(bar);
    const c=document.createElement('canvas');c.id='annotationCanvas';c.style.pointerEvents='none';roomEl.appendChild(c);
    let drawing=false,stroke=null,lastBroadcast=0;
    const pos=e=>{const r=c.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/Math.max(1,r.width))),y:Math.max(0,Math.min(1,(e.clientY-r.top)/Math.max(1,r.height)))}};
    const sync=()=>{const main=document.querySelector('#videoGrid .main-tile');if(main&&!main.contains(c))main.appendChild(c);resizeAnnotationCanvas()};
    $('#annPen').onclick=()=>{annotationEnabled=!annotationEnabled;bar.classList.toggle('active',annotationEnabled);c.style.pointerEvents=annotationEnabled?'auto':'none';sync()};
    $('#annUndo').onclick=()=>{if(!isHost()||!annotationStrokes.length)return;redoStrokes.push(annotationStrokes.pop());drawAnnotations();sendAnnotationState()};
    $('#annRedo').onclick=()=>{if(!isHost()||!redoStrokes.length)return;annotationStrokes.push(redoStrokes.pop());drawAnnotations();sendAnnotationState()};
    $('#annClose').onclick=()=>{annotationEnabled=false;bar.classList.remove('active');c.style.pointerEvents='none'};
    c.addEventListener('pointerdown',e=>{if(!isHost()||!annotationEnabled||!screenOwnerId)return;drawing=true;stroke=[pos(e)];c.setPointerCapture(e.pointerId);drawAnnotations(stroke);sendAnnotationLive(stroke)});
    c.addEventListener('pointermove',e=>{if(!drawing||!stroke)return;stroke.push(pos(e));drawAnnotations(stroke);const now=performance.now();if(now-lastBroadcast>45){lastBroadcast=now;sendAnnotationLive(stroke)}});
    const end=()=>{if(!drawing||!stroke)return;drawing=false;annotationStrokes.push(stroke);redoStrokes=[];stroke=null;drawAnnotations();sendAnnotationState()};
    c.addEventListener('pointerup',end);c.addEventListener('pointercancel',end);c.addEventListener('pointerleave',e=>{if(drawing&&e.buttons===0)end()});
    window.addEventListener('resize',resizeAnnotationCanvas);
  }
  function resizeAnnotationCanvas(){const c=$('#annotationCanvas');if(!c)return;const main=document.querySelector('#videoGrid .main-tile');if(!main)return;const r=main.getBoundingClientRect();c.width=Math.max(1,Math.round(r.width));c.height=Math.max(1,Math.round(r.height));drawAnnotations()}
  function updateAnnotationLayer(){ensureAnnotationUI();const c=$('#annotationCanvas'),bar=$('#annotationToolbar');if(!c||!bar)return;const active=!!screenOwnerId&&selectedPeerId===screenOwnerId;const main=document.querySelector('#videoGrid .main-tile');if(main&&!main.contains(c))main.appendChild(c);c.classList.toggle('visible',active);bar.classList.toggle('visible',active&&isHost());if(!active){annotationEnabled=false;bar.classList.remove('active');c.style.pointerEvents='none'}resizeAnnotationCanvas()}
  function drawAnnotations(extra){const c=$('#annotationCanvas');if(!c)return;const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);ctx.strokeStyle='#ff2f2f';ctx.lineWidth=Math.max(3,Math.round(Math.min(c.width,c.height)/220));ctx.lineCap='round';const all=extra?[...annotationStrokes,extra]:annotationStrokes;for(const s of all){if(!s?.length)continue;ctx.beginPath();ctx.moveTo(s[0].x*c.width,s[0].y*c.height);for(let i=1;i<s.length;i++)ctx.lineTo(s[i].x*c.width,s[i].y*c.height);ctx.stroke()}}
  async function publishData(obj,reliable=true){if(!room)return;try{const bytes=new TextEncoder().encode(JSON.stringify(obj));await room.localParticipant.publishData(bytes,{reliable})}catch(e){console.warn('LiveKit data',e)}}
  async function sendAnnotationState(){await publishData({kind:'annotation-state',strokes:annotationStrokes},true)}
  async function sendAnnotationLive(stroke){await publishData({kind:'annotation-live',strokes:annotationStrokes,live:stroke},false)}

  function renderPeople(){const box=$('#participantsPanel .messages');if(!box)return;const arr=[{id:identityFor(),name,local:true},...(room?[...room.remoteParticipants.values()].map(p=>({id:p.identity,name:displayNameForParticipant(p)})):[])];box.innerHTML=`<p><b>Participants (${arr.length})</b></p>`+arr.map(x=>`<p>🎙 <b>${esc(x.name)}${x.local?' (You)':''}</b></p>`).join('')}
  function ensureParticipantTiles(){if(room){tile(peerId,name);for(const p of room.remoteParticipants.values())tile(p.identity,displayNameForParticipant(p));}}

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
    selectedPeerId=peerId;screenOwnerId=null;annotationStrokes=[];redoStrokes=[];$('#videoGrid').innerHTML='';showPage('room');setRoomMeta(activeTitle,'Connecting to LiveKit…');ensureAnnotationUI();
    try{
      const creds=await fetchToken(code);
      room=new LK.Room({adaptiveStream:true,dynacast:true});
      room.on(LK.RoomEvent.TrackSubscribed,(track,publication,participant)=>{attachTrack(track,participant,publication.source);setRoomMeta(activeTitle,`● ${room.remoteParticipants.size+1} participant${room.remoteParticipants.size+1===1?'':'s'}`);renderPeople();updateAnnotationLayer()});
      room.on(LK.RoomEvent.TrackUnsubscribed,(track,publication,participant)=>{detachTrack(track,participant,publication.source);renderPeople();updateAnnotationLayer()});
      room.on(LK.RoomEvent.ParticipantConnected,p=>{tile(p.identity,displayNameForParticipant(p));renderPeople();setRoomMeta(activeTitle,`● ${room.remoteParticipants.size+1} participants`)});
      room.on(LK.RoomEvent.ParticipantDisconnected,p=>{document.querySelector(`[data-peer-tile="${CSS.escape(p.identity)}"]`)?.remove();document.querySelector(`[data-peer-tile="${CSS.escape('screen:'+p.identity)}"]`)?.remove();renderPeople();setRoomMeta(activeTitle,`● ${room.remoteParticipants.size+1} participant${room.remoteParticipants.size+1===1?'':'s'}`);updateAnnotationLayer()});
      room.on(LK.RoomEvent.LocalTrackPublished,(publication)=>{
        const track=publication.track;
        if(publication.source===LK.Track.Source.Camera){
          const el=track?.attach?.()[0];
          if(el){putVideo(peerId,el,name,'camera',true)}
        }
        if(publication.source===LK.Track.Source.ScreenShare){
          screenPublishing=true;
          const el=track?.attach?.()[0];
          if(el){const t=tile(`screen:${identityFor()}`,name);t.dataset.kind='screen';t.classList.add('screen-share-tile');el.autoplay=true;el.playsInline=true;el.style.width='100%';el.style.height='100%';el.style.objectFit='contain';t.prepend(el)}
          setScreenOwner(identityFor(),true)
        }
      });
      room.on(LK.RoomEvent.LocalTrackUnpublished,(publication)=>{if(publication.source===LK.Track.Source.ScreenShare){screenPublishing=false;document.querySelector(`[data-peer-tile="${CSS.escape('screen:'+identityFor())}"]`)?.remove();setScreenOwner(identityFor(),false)}});
      room.on(LK.RoomEvent.DataReceived,(payload,participant)=>{try{const msg=JSON.parse(new TextDecoder().decode(payload));if(msg.kind==='chat'){chatAdd(msg.name||displayNameForParticipant(participant),msg.text,msg.time)}else if(msg.kind==='annotation-state'&&participant?.identity!==identityFor()){annotationStrokes=Array.isArray(msg.strokes)?msg.strokes:[];redoStrokes=[];drawAnnotations()}else if(msg.kind==='annotation-live'&&participant?.identity!==identityFor()){annotationStrokes=Array.isArray(msg.strokes)?msg.strokes:[];drawAnnotations(msg.live||null)}}catch{}});
      room.on(LK.RoomEvent.Disconnected,()=>setRoomMeta(activeTitle,'Disconnected'));
      await room.connect(creds.server_url,creds.participant_token);
      ensureParticipantTiles();
      selectMainTile(peerId);
      await room.localParticipant.setCameraEnabled(true);
      renderLocalCamera();
      await room.localParticipant.setMicrophoneEnabled(true);
      setRoomMeta(activeTitle,`● ${room.remoteParticipants.size+1} participant${room.remoteParticipants.size+1===1?'':'s'}`);
      renderPeople();
    }catch(e){console.error(e);setRoomMeta(activeTitle,'Connection error');alert(`Meeting connect wenne naha. ${e.message||''}`);await leave(true)}
  }

  async function leave(silent=false){
    try{if(room){await room.disconnect()}}catch{}
    room=null;screenPublishing=false;activeCode='';screenOwnerId=null;annotationStrokes=[];redoStrokes=[];$('#videoGrid').innerHTML='';if(!silent)showPage('home')
  }
  async function startScreen(){
    if(!room||screenPublishing)return;
    try{await room.localParticipant.setScreenShareEnabled(true,{audio:true,selfBrowserSurface:'exclude',surfaceSwitching:'include',systemAudio:'include'});setScreenOwner(identityFor(),true)}catch(e){console.warn('screen share',e)}
  }
  async function stopScreen(){if(!room||!screenPublishing)return;try{await room.localParticipant.setScreenShareEnabled(false)}catch{}screenPublishing=false}

  const create=safeClone($('#createBtn'));if(create)create.addEventListener('click',async()=>{const n=($('#meetingName')?.value||'Team Meeting').trim()||'Team Meeting';const pw=$('#meetingPassword')?.value||'';const code=Math.random().toString(36).slice(2,8);localStorage.setItem('mnt_last_meeting',JSON.stringify({name:n,code,password:pw,createdAt:new Date().toISOString()}));$('#shareBox span').textContent=roomLink(code);await join(code,'Host',n,true)});
  const copy=safeClone($('#copyBtn'));if(copy)copy.addEventListener('click',async()=>{const t=$('#shareBox span').textContent;try{await navigator.clipboard.writeText(t);alert('Meeting link copied.')}catch{alert(t)}});
  const joinBtn=safeClone($('#joinMeetingBtn'));if(joinBtn)joinBtn.addEventListener('click',()=>join($('#joinCode')?.value,$('#joinName')?.value||'Guest'));
  const oldRoomJoin=$('#meetingsList [data-page="room"]');if(oldRoomJoin){const c=safeClone(oldRoomJoin);c.removeAttribute('data-page');c.addEventListener('click',()=>{const x=JSON.parse(localStorage.getItem('mnt_last_meeting')||'null');if(x)join(x.code,'Guest',x.name);else showPage('join')})}
  const sched=safeClone($('#scheduleBtn'));if(sched)sched.addEventListener('click',()=>{const n=($('#scheduleName')?.value||'Scheduled Meeting').trim()||'Scheduled Meeting',date=$('#scheduleDate')?.value,time=$('#scheduleTime')?.value,duration=$('#scheduleDuration')?.value||'60';if(!date||!time){alert('Date and time select කරන්න.');return}const code=Math.random().toString(36).slice(2,8),label=duration==='0'?'Unlimited':duration+' minutes',m={name:n,date,time,duration,durationLabel:label,code,password:$('#schedulePassword')?.value||'',link:roomLink(code),createdAt:new Date().toISOString()};const a=getMeetings();a.push(m);a.sort((x,y)=>(x.date+'T'+x.time).localeCompare(y.date+'T'+y.time));saveMeetings(a);renderSchedule();$('#scheduleResult').style.display='block';$('#scheduleResult').innerHTML=`✓ Meeting scheduled. Link: <span>${esc(m.link)}</span> <button id="copyScheduledLink">▣</button>`;$('#copyScheduledLink').onclick=async()=>{try{await navigator.clipboard.writeText(m.link);alert('Meeting link copied.')}catch{alert(m.link)}}});
  function renderSchedule(){const box=$('#scheduledList');if(!box)return;const a=getMeetings();if(!a.length){box.innerHTML='<div class="form-note">No scheduled meetings yet.</div>';return}box.innerHTML='<h3>Upcoming Meetings</h3>'+a.map((m,i)=>{const code=m.code||cleanCode(m.link);const link=code?roomLink(code):(m.link||'');return `<div><b>${esc(m.name)}</b><span>${esc(m.date)} · ${esc(m.time)} · ${esc(m.durationLabel)}</span><button type="button" class="primary small" data-v45join="${i}">Join</button><button type="button" class="secondary small" data-v45copy="${i}">Copy Link</button></div>`}).join('');box.querySelectorAll('[data-v45join]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const m=a[Number(b.dataset.v45join)];const code=m?.code||cleanCode(m?.link);if(!code){alert('Meeting code or link enter කරන්න.');return}join(code,'Host',m.name,true)}));box.querySelectorAll('[data-v45copy]').forEach(b=>b.addEventListener('click',async e=>{e.preventDefault();e.stopPropagation();const m=a[Number(b.dataset.v45copy)];const code=m?.code||cleanCode(m?.link);const link=code?roomLink(code):(m?.link||'');try{await navigator.clipboard.writeText(link);alert('Meeting link copied.')}catch{alert(link)}}))}
  renderSchedule();
  const leaveBtn=safeClone($('#room .leave'));if(leaveBtn){leaveBtn.removeAttribute('data-page');leaveBtn.addEventListener('click',()=>leave(false))}
  const chatBtn=safeClone($('#chatBtn'));if(chatBtn)chatBtn.addEventListener('click',()=>$('#chatPanel')?.classList.add('open'));
  const closeChat=safeClone($('#closeChat'));if(closeChat)closeChat.addEventListener('click',()=>$('#chatPanel')?.classList.remove('open'));
  const chatAdd=(who,text,time)=>{const box=$('#chatPanel .messages');if(!box)return;const p=document.createElement('p');p.innerHTML=`<b>${esc(who)}</b> <small>${esc(time||'')}</small><br>${esc(text)}`;box.appendChild(p);box.scrollTop=box.scrollHeight};
  const chatSend=safeClone($('#chatPanel .chat-input button'));if(chatSend)chatSend.addEventListener('click',async()=>{const input=$('#chatPanel .chat-input input'),text=(input?.value||'').trim();if(!text)return;const time=new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});chatAdd('You',text,time);input.value='';await publishData({kind:'chat',name,text,time},true)});
  const chatInput=$('#chatPanel .chat-input input');chatInput?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();chatSend?.click()}});
  const peopleBtn=safeClone($('#peopleBtn'));if(peopleBtn)peopleBtn.addEventListener('click',()=>{let panel=$('#participantsPanel');if(!panel){panel=document.createElement('aside');panel.id='participantsPanel';panel.className='chat-panel open';panel.innerHTML='<div class="chat-head">Participants <button id="closeParticipants">×</button></div><div class="messages"></div>';$('#room .meeting-room').appendChild(panel);$('#closeParticipants').onclick=()=>panel.classList.remove('open')}else panel.classList.toggle('open');renderPeople()});
  const controls=$$('#room .room-controls > button');const mic=controls[0],cam=controls[1],share=$('#room .share');
  const switchCamBtn=document.createElement('button');switchCamBtn.id='switchCameraBtn';switchCamBtn.innerHTML='🔄<small>Camera</small>';switchCamBtn.title='Switch camera';$('#room .room-controls')?.insertBefore(switchCamBtn,share);
  switchCamBtn.addEventListener('click',async()=>{if(!room)return;const cams=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');if(cams.length<2){alert('Only one camera is available on this device.');return}const idx=Math.max(0,cams.findIndex(d=>d.deviceId===currentCameraDeviceId));currentCameraDeviceId=cams[(idx+1)%cams.length].deviceId;try{await room.switchActiveDevice('videoinput',currentCameraDeviceId)}catch(e){console.warn('camera switch',e)}});
  mic?.addEventListener('click',async()=>{if(!room)return;const p=room.localParticipant;const pub=p.getTrackPublication(LK.Track.Source.Microphone);const enabled=!!pub&&!pub.isMuted;p.setMicrophoneEnabled(!enabled);mic.classList.toggle('active-control',!enabled);mic.querySelector('small').textContent=!enabled?'Mute':'Unmute'});
  cam?.addEventListener('click',async()=>{if(!room)return;const p=room.localParticipant;const pub=p.getTrackPublication(LK.Track.Source.Camera);const enabled=!!pub&&!pub.isMuted;p.setCameraEnabled(!enabled);cam.classList.toggle('active-control',!enabled);cam.querySelector('small').textContent=!enabled?'Stop Video':'Start Video'});
  share?.addEventListener('click',async()=>{if(screenPublishing)await stopScreen();else await startScreen()});
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
    participants.classList.add('open');
  }
  chat.classList.add('open');

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

  // On phones, Chat/Participants opens the same right rail as an overlay.
  const chatBtn=document.getElementById('chatBtn');
  const peopleBtn=document.getElementById('peopleBtn');
  const toggleMobileRail=()=>{
    if(matchMedia('(max-width:820px)').matches) meeting.classList.toggle('mnt-mobile-panel-open');
  };
  chatBtn?.addEventListener('click',toggleMobileRail);
  peopleBtn?.addEventListener('click',toggleMobileRail);
  rail.addEventListener('dblclick',()=>meeting.classList.remove('mnt-mobile-panel-open'));
});
