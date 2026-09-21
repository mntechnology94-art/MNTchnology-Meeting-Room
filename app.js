document.addEventListener("DOMContentLoaded", () => {
const pages=[...document.querySelectorAll('.page')];
function showPage(id){
  pages.forEach(p=>p.classList.toggle('active-page',p.id===id));
  document.querySelectorAll('.nav-link').forEach(b=>b.classList.toggle('active',b.dataset.page===id));
  window.scrollTo(0,0);
}
document.addEventListener('click',e=>{
  const btn=e.target.closest('[data-page]');
  if(btn){showPage(btn.dataset.page)}
});
document.querySelectorAll('.nav-link').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.page)));
document.querySelectorAll('.side-link').forEach(b=>b.addEventListener('click',()=>b.dataset.page&&showPage(b.dataset.page)));
document.getElementById('createBtn').addEventListener('click',()=>{
  const name=document.getElementById('meetingName').value||'Team Meeting';
  const code=Math.random().toString(36).slice(2,8);
  document.querySelector('#shareBox span').textContent='https://mntchnology.com/room/'+code;
  alert('Meeting created: '+name);
});
document.getElementById('copyBtn').addEventListener('click',async()=>{
  const t=document.querySelector('#shareBox span').textContent;
  try{await navigator.clipboard.writeText(t);alert('Meeting link copied.')}catch{alert(t)}
});
document.getElementById('chatBtn').addEventListener('click',()=>document.getElementById('chatPanel').classList.add('open'));
document.getElementById('closeChat').addEventListener('click',()=>document.getElementById('chatPanel').classList.remove('open'));
document.getElementById('signin').addEventListener('click',()=>document.getElementById('hostSigninOverlay').classList.add('open'));

const hostRegisterOverlay=document.getElementById('hostRegisterOverlay');
const hostSigninOverlay=document.getElementById('hostSigninOverlay');
const hostRegisterError=document.getElementById('hostRegisterError');
const hostSigninError=document.getElementById('hostSigninError');
function setHostError(el,msg){el.textContent=msg;el.classList.toggle('show',!!msg);}
document.getElementById('hostRegister').addEventListener('click',()=>{hostRegisterOverlay.classList.add('open');setHostError(hostRegisterError,'');});
document.getElementById('hostRegisterCancel').addEventListener('click',()=>hostRegisterOverlay.classList.remove('open'));
document.getElementById('hostSigninCancel').addEventListener('click',()=>hostSigninOverlay.classList.remove('open'));
document.getElementById('hostRegisterBtn').addEventListener('click',async ()=>{
  const email=document.getElementById('hostEmail').value.trim().toLowerCase();
  const pw=document.getElementById('hostPassword').value;
  const cpw=document.getElementById('hostPasswordConfirm').value;
  if(!email || !email.includes('@')) return setHostError(hostRegisterError,'Valid host email එකක් enter කරන්න.');
  if(pw.length<6) return setHostError(hostRegisterError,'Password එකේ අවම වශයෙන් characters 6ක් තියෙන්න ඕන.');
  if(pw!==cpw) return setHostError(hostRegisterError,'Passwords දෙකම සමාන වෙන්න ඕන.');
  localStorage.setItem('mnt_host_account',JSON.stringify({email,password:pw,status:'Pending Approval',trialDays:7}));
  hostRegisterOverlay.classList.remove('open');

  // Production notification: the browser never sees the email API key.
  // Configure SUPABASE_URL in config.js and deploy the Edge Function.
  const supabaseUrl = window.MNT_SUPABASE_URL || '';
  const publishableKey = window.MNT_SUPABASE_PUBLISHABLE_KEY || '';
  if(supabaseUrl && publishableKey){
    try{
      const resp = await fetch(supabaseUrl.replace(/\/$/,'') + '/functions/v1/notify-host-registration', {
        method:'POST',
        headers:{'Content-Type':'application/json','apikey':publishableKey},
        body:JSON.stringify({email})
      });
      if(!resp.ok) throw new Error('notification failed');
      alert('Host registration submitted. Permission request එක platform ownerගේ email එකට automatic යැවුණා.');
    }catch(e){
      console.warn(e);
      alert('Host registration saved. Email notification service එක තවම configure කරලා නැහැ.');
    }
  }else{
    alert('Host registration saved. Email notification service එක configure කළාම request එක automatic email එකක් ලෙස යැවෙයි.');
  }
});
document.getElementById('hostSigninBtn').addEventListener('click',()=>{
  const email=document.getElementById('hostSigninEmail').value.trim().toLowerCase();
  const pw=document.getElementById('hostSigninPassword').value;
  let account=null; try{account=JSON.parse(localStorage.getItem('mnt_host_account')||'null')}catch{}
  if(!account || account.email!==email || account.password!==pw) return setHostError(hostSigninError,'Host email/password වැරදියි, නැත්නම් registration එක නැහැ.');
  hostSigninOverlay.classList.remove('open');
  document.getElementById('hostWelcome').textContent='Signed in as '+account.email;
  document.getElementById('hostStatus').textContent=account.status;
  showPage('host-dashboard');
});

document.querySelectorAll('.admin-tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.admin-tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.admin-panel').forEach(p=>p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('admin-'+tab.dataset.adminTab).classList.add('active');
  });
});
['saveHost','saveSettings','savePayment'].forEach(id=>{
  const el=document.getElementById(id);
  if(el) el.addEventListener('click',()=>alert('Saved in prototype. Production version will save this securely in Supabase.'));
});
async function loadHostRequests(){
  const table=document.getElementById('hostTable');
  if(!table || !supabaseClient) return;
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(!session?.access_token){
    table.innerHTML='<div class="host-row"><span><b>Admin session expired.</b><small>Please sign in again.</small></span></div>';
    return;
  }
  try{
    const resp=await fetch(supabaseUrl.replace(/\/$/,'')+'/functions/v1/rapid-processor',{
      method:'GET',
      headers:{
        'Authorization':'Bearer '+session.access_token,
        'apikey':publishableKey,
        'Content-Type':'application/json'
      }
    });
    const raw=await resp.text();
    let data={};
    try{data=raw?JSON.parse(raw):{};}catch{data={error:raw||'Empty response'};}
    if(!resp.ok) throw new Error((data.error||'Could not load host requests')+(data.details?': '+data.details:''));
    const rows=data.requests||[];
    table.innerHTML='<div class="host-row host-header"><b>Host</b><b>Status</b><b>Participants</b><b>Meeting Time</b><b>Trial / Paid</b><b>Action</b></div>';
    if(!rows.length){
      table.insertAdjacentHTML('beforeend','<div class="host-row"><span><b>No host requests yet.</b><small>New registrations will appear here automatically.</small></span><span class="pill pending">No Requests</span><span>—</span><span>—</span><span>—</span><span>—</span></div>');
    } else {
      rows.forEach(r=>{
        const status=r.status||'pending_approval';
        const cls=status==='trial'?'trial':status==='paid'?'paid':status==='expired'?'expired':status==='suspended'?'expired':'pending';
        const label=status==='pending_approval'?'Pending Approval':status==='trial'?'7-Day Trial':status.charAt(0).toUpperCase()+status.slice(1);
        const expiry=r.trial_ends_at||r.subscription_ends_at;
        const expiryText=expiry ? new Date(expiry).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : (status==='pending_approval'?'Not started':'—');
        const action=status==='pending_approval'?`<button class="text-btn" data-request-id="${r.id}" data-request-action="approve">Approve</button>`:status==='suspended'?`<button class="text-btn" data-request-id="${r.id}" data-request-action="restore">Restore</button>`:`<button class="text-btn" data-request-id="${r.id}" data-request-action="manage">Manage</button>`;
        table.insertAdjacentHTML('beforeend',`<div class="host-row"><span><b>${escapeHtml(r.email)}</b><small>Registered ${new Date(r.created_at).toLocaleString('en-US')}</small></span><span class="pill ${cls}">${label}</span><span><input class="mini-input" value="${r.participant_limit??100}"></span><span><input class="mini-input" value="${r.meeting_minutes??'∞'}"></span><span>${expiryText}</span>${action}</div>`);
      });
    }
    document.getElementById('statHosts').textContent=data.stats?.total??rows.length;
    document.getElementById('statTrials').textContent=data.stats?.trial??rows.filter(x=>x.status==='trial').length;
    document.getElementById('statPaid').textContent=data.stats?.paid??rows.filter(x=>x.status==='paid').length;
    document.getElementById('statExpired').textContent=data.stats?.expired??rows.filter(x=>x.status==='expired').length;
    table.querySelectorAll('[data-request-action]').forEach(btn=>btn.addEventListener('click',()=>handleHostAction(btn.dataset.requestId,btn.dataset.requestAction)));
  }catch(e){
    console.error(e);
    const msg=escapeHtml(e?.message||'Unknown error');
    table.innerHTML='<div class="host-row"><span><b>Host requests load වෙන්න බැරි වුණා.</b><small>'+msg+'</small></span><span class="pill expired">Error</span></div>';
  }
}
function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
async function handleHostAction(id,action){
  if(action==='manage') return alert('Host management details can be added next.');
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(!session?.access_token) return alert('Admin session expired. Please sign in again.');
  try{
    const resp=await fetch(supabaseUrl.replace(/\/$/,'')+'/functions/v1/rapid-processor',{
      method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token,'apikey':publishableKey},
      body:JSON.stringify({id,action})
    });
    const data=await resp.json();
    if(!resp.ok) throw new Error(data.error||'Action failed');
    alert(action==='approve'?'Host approved. 7-day unlimited trial started.':'Host restored.');
    await loadHostRequests();
  }catch(e){alert('Host action failed: '+e.message);}
}


// Host recording demo: real browser MediaRecorder with Start/Pause/Resume/Stop.
let rec=null, recChunks=[], recStream=null;
const recStart=document.getElementById('recordStart'), recPause=document.getElementById('recordPause'), recResume=document.getElementById('recordResume'), recStop=document.getElementById('recordStop'), recStatus=document.getElementById('recordStatus');
function recUi(state){
  recStart.disabled=state!=='idle'; recPause.disabled=state!=='recording'; recResume.disabled=state!=='paused'; recStop.disabled=!(state==='recording'||state==='paused');
}
recUi('idle');
recStart.addEventListener('click',async()=>{
  try{
    recStream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});
    recChunks=[]; rec=new MediaRecorder(recStream);
    rec.ondataavailable=e=>{if(e.data.size) recChunks.push(e.data)};
    rec.onstop=()=>{
      const blob=new Blob(recChunks,{type:'video/webm'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='MNTchnology-recording-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.webm'; a.textContent='Download recording'; a.style.display='inline-block'; a.style.marginLeft='8px'; recStatus.innerHTML='Recording stopped. '+a.outerHTML; recUi('idle'); recStream?.getTracks().forEach(t=>t.stop());
    };
    recStream.getVideoTracks()[0].addEventListener('ended',()=>{if(rec && rec.state!=='inactive') rec.stop()});
    rec.start(); recUi('recording'); recStatus.textContent='● Recording...';
  }catch(e){recStatus.textContent='Screen permission එක දෙන්න ඕන. Recording start වුණේ නැහැ.'}
});
recPause.addEventListener('click',()=>{if(rec?.state==='recording'){rec.pause();recUi('paused');recStatus.textContent='Ⅱ Recording paused.'}});
recResume.addEventListener('click',()=>{if(rec?.state==='paused'){rec.resume();recUi('recording');recStatus.textContent='● Recording resumed...'}});
recStop.addEventListener('click',()=>{if(rec && rec.state!=='inactive') rec.stop()});
document.getElementById('connectDrive').addEventListener('click',()=>{document.getElementById('driveStatus').textContent='Connected (Demo)'; document.getElementById('driveStatus').className='pill paid'; recStatus.textContent='Google Drive connected for this demo host. Production OAuth upload will use this host account.'});

// Admin access: Supabase Auth protects the owner account. No admin password is hard-coded.
const supabaseUrl = window.MNT_SUPABASE_URL || '';
const publishableKey = window.MNT_SUPABASE_PUBLISHABLE_KEY || '';
const supabaseClient = (window.supabase && supabaseUrl && publishableKey)
  ? window.supabase.createClient(supabaseUrl, publishableKey)
  : null;
// Expose the initialized client to the meeting core.
window.supabaseClient = supabaseClient;
let adminUnlocked = false;
const logoAdminTrigger = document.getElementById('logoAdminTrigger');
const adminOverlay = document.getElementById('adminLoginOverlay');
const adminPassword = document.getElementById('adminPassword');
const adminEmail = document.getElementById('adminEmail');
const adminLoginError = document.getElementById('adminLoginError');
const adminResetOverlay = document.getElementById('adminResetOverlay');
const adminResetError = document.getElementById('adminResetError');
const newAdminPassword = document.getElementById('newAdminPassword');
const newAdminPasswordConfirm = document.getElementById('newAdminPasswordConfirm');
const adminOwnerEmail = 'mntechnology94@gmail.com';
if(adminEmail) adminEmail.value = adminOwnerEmail;

function showAdminError(msg){ adminLoginError.textContent=msg; adminLoginError.classList.toggle('show',!!msg); }
function showResetError(msg){ adminResetError.textContent=msg; adminResetError.classList.toggle('show',!!msg); }
function openAdminLogin(){
  if(adminUnlocked){ showPage('admin'); return; }
  adminOverlay.classList.add('open');
  adminPassword.value=''; showAdminError('');
  setTimeout(()=>adminEmail?.focus(),50);
}
if(logoAdminTrigger) logoAdminTrigger.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openAdminLogin();});
document.getElementById('adminCancel').addEventListener('click',()=>adminOverlay.classList.remove('open'));
document.getElementById('adminLoginBtn').addEventListener('click',tryAdminLogin);
adminPassword.addEventListener('keydown',e=>{if(e.key==='Enter') tryAdminLogin();});
adminEmail.addEventListener('keydown',e=>{if(e.key==='Enter') adminPassword.focus();});
async function tryAdminLogin(){
  const email=adminEmail.value.trim().toLowerCase();
  const password=adminPassword.value;
  if(!supabaseClient) return showAdminError('Supabase connection eka configure karala naha.');
  if(!email || !email.includes('@')) return showAdminError('Owner email eka enter කරන්න.');
  if(!password) return showAdminError('Password eka enter කරන්න.');
  const {data,error}=await supabaseClient.auth.signInWithPassword({email,password});
  if(error || !data.session) return showAdminError('Email/password එක වැරදියි.');
  adminUnlocked=true; adminOverlay.classList.remove('open'); showPage('admin');
  await loadHostRequests();
}
document.getElementById('adminForgotPassword').addEventListener('click',async()=>{
  const email=adminEmail.value.trim().toLowerCase() || adminOwnerEmail;
  if(!supabaseClient) return showAdminError('Supabase connection eka configure karala naha.');
  const redirectTo=window.location.href.split('#')[0]+'#admin-reset';
  const {error}=await supabaseClient.auth.resetPasswordForEmail(email,{redirectTo});
  if(error) return showAdminError('Password reset email eka yawanna bari una.');
  showAdminError('Password reset link eka owner email ekata yewwa. Email eka check කරන්න.');
});
document.getElementById('adminResetCancel').addEventListener('click',()=>adminResetOverlay.classList.remove('open'));
document.getElementById('adminResetBtn').addEventListener('click',async()=>{
  const pw=newAdminPassword.value, cpw=newAdminPasswordConfirm.value;
  if(pw.length<6) return showResetError('Password eka අවම වශයෙන් characters 6ක් තියෙන්න ඕන.');
  if(pw!==cpw) return showResetError('Passwords දෙකම සමාන වෙන්න ඕන.');
  if(!supabaseClient) return showResetError('Supabase connection eka configure karala naha.');
  const {error}=await supabaseClient.auth.updateUser({password:pw});
  if(error) return showResetError('Password update කරන්න බැරි වුණා. Reset link eka aluthin request කරන්න.');
  showResetError(''); newAdminPassword.value=''; newAdminPasswordConfirm.value='';
  adminResetOverlay.classList.remove('open'); adminUnlocked=true; showPage('admin');
  alert('Admin password eka successfully update kala.');
});

if(supabaseClient){
  supabaseClient.auth.onAuthStateChange((event)=>{
    if(event==='PASSWORD_RECOVERY'){
      adminResetOverlay.classList.add('open');
      showResetError('');
      setTimeout(()=>newAdminPassword.focus(),100);
    }
  });
}
});
document.addEventListener("DOMContentLoaded",()=>{
// Meeting media controls: microphone, camera, screen share, participants.
const meetingRoom = document.querySelector('.meeting-room');
const controlButtons = meetingRoom ? [...meetingRoom.querySelectorAll('.room-controls > button')] : [];
const muteBtn = controlButtons[0], videoBtn = controlButtons[1], shareBtn = meetingRoom?.querySelector('.room-controls .share'), peopleBtn = document.getElementById('peopleBtn');
let micStream = null, camStream = null, screenStream = null;
const myTile = meetingRoom?.querySelector('.tile');
let myVideo = myTile?.querySelector('video');
function updateControl(btn, onLabel, offLabel, active){ if(!btn) return; const small=btn.querySelector('small'); if(small) small.textContent=active?onLabel:offLabel; btn.classList.toggle('active-control', active); }
async function ensureMic(){
  if(!micStream) micStream=await navigator.mediaDevices.getUserMedia({audio:true});
  micStream.getAudioTracks().forEach(t=>t.enabled=true);
  return micStream;
}
async function ensureCam(){
  if(!camStream) camStream=await navigator.mediaDevices.getUserMedia({video:true});
  camStream.getVideoTracks().forEach(t=>t.enabled=true);
  if(myTile){
    if(!myVideo){ myVideo=document.createElement('video'); myVideo.autoplay=true; myVideo.playsInline=true; myVideo.muted=true; myTile.insertBefore(myVideo,myTile.firstChild); }
    myVideo.srcObject=camStream;
    myVideo.style.display='block';
    const av=myTile.querySelector('.avatar'); if(av) av.style.display='none';
  }
  return camStream;
}
if(muteBtn) muteBtn.addEventListener('click',async()=>{
  try{ if(!micStream) await ensureMic(); const enabled=micStream.getAudioTracks()[0].enabled; micStream.getAudioTracks().forEach(t=>t.enabled=!enabled); updateControl(muteBtn, enabled?'Unmute':'Mute', enabled?'Unmute':'Mute', !enabled); }
  catch(e){alert('Microphone permission එක දෙන්න ඕන.');}
});
if(videoBtn) videoBtn.addEventListener('click',async()=>{
  try{ if(!camStream) await ensureCam(); const enabled=camStream.getVideoTracks()[0].enabled; camStream.getVideoTracks().forEach(t=>t.enabled=!enabled); if(myVideo) myVideo.style.display=!enabled?'block':'none'; const av=myTile?.querySelector('.avatar'); if(av) av.style.display=!enabled?'none':'flex'; updateControl(videoBtn, enabled?'Start Video':'Stop Video', enabled?'Start Video':'Stop Video', !enabled); }
  catch(e){alert('Camera permission එක දෙන්න ඕන.');}
});
if(shareBtn) shareBtn.addEventListener('click',async()=>{
  try{
    if(screenStream){ screenStream.getTracks().forEach(t=>t.stop()); screenStream=null; shareBtn.classList.remove('active-control'); shareBtn.querySelector('small').textContent='Share Screen'; return; }
    screenStream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});
    shareBtn.classList.add('active-control'); shareBtn.querySelector('small').textContent='Stop Sharing';
    screenStream.getVideoTracks()[0].addEventListener('ended',()=>{screenStream=null;shareBtn.classList.remove('active-control');shareBtn.querySelector('small').textContent='Share Screen';});
  }catch(e){ /* user cancelled */ }
});
if(peopleBtn){
  peopleBtn.addEventListener('click',()=>{
    let panel=document.getElementById('participantsPanel');
    if(!panel){
      panel=document.createElement('aside'); panel.id='participantsPanel'; panel.className='chat-panel open';
      panel.innerHTML='<div class="chat-head">Participants <button id="closeParticipants">×</button></div><div class="messages"><p>🎙 <b>John (You)</b></p><p>🎙 Sara</p><p>🎙 Amal</p><p>🎙 Nethmi</p><p>🎙 Kasun</p><p>🎙 Dinushi</p></div>';
      meetingRoom.appendChild(panel); panel.querySelector('#closeParticipants').addEventListener('click',()=>panel.classList.remove('open'));
    } else panel.classList.toggle('open');
  });
}

});


// v12: robust meeting interactions (UI + local media preview)
document.addEventListener('DOMContentLoaded', () => {
  const room = document.querySelector('.meeting-room');
  if (!room) return;

  const chatInput = room.querySelector('.chat-input input');
  const chatSend = room.querySelector('.chat-input button');
  const messages = room.querySelector('#chatPanel .messages');
  function sendChat(){
    const value=(chatInput?.value||'').trim();
    if(!value || !messages) return;
    const p=document.createElement('p');
    p.innerHTML='<b>You</b> <small>'+new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})+'</small><br>'+
      value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    messages.appendChild(p); messages.scrollTop=messages.scrollHeight; chatInput.value='';
  }
  chatSend?.addEventListener('click',sendChat);
  chatInput?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();sendChat();}});

  // Replace the first two room controls with explicit, reliable state handling.
  const controls=[...room.querySelectorAll('.room-controls > button')];
  const micBtn=controls[0], camBtn=controls[1], shareBtn=room.querySelector('.room-controls .share');
  let mic=null, cam=null, screen=null;
  const tile=room.querySelector('.video-grid .tile');
  let video=tile?.querySelector('video');
  const avatar=tile?.querySelector('.avatar');
  const setLabel=(btn,label)=>{const s=btn?.querySelector('small');if(s)s.textContent=label;};
  const safeTracks=(stream)=>stream?.getTracks().forEach(t=>t.stop());

  async function toggleMic(){
    if(!navigator.mediaDevices?.getUserMedia){alert('Browser එක microphone access support කරන්නේ නැහැ.');return;}
    if(!mic){ mic=await navigator.mediaDevices.getUserMedia({audio:true}); }
    const track=mic.getAudioTracks()[0]; track.enabled=!track.enabled;
    micBtn?.classList.toggle('active-control',track.enabled); setLabel(micBtn,track.enabled?'Mute':'Unmute');
  }
  async function toggleCam(){
    if(!navigator.mediaDevices?.getUserMedia){alert('Browser එක camera access support කරන්නේ නැහැ.');return;}
    if(!cam){ cam=await navigator.mediaDevices.getUserMedia({video:true}); }
    const track=cam.getVideoTracks()[0]; track.enabled=!track.enabled;
    if(track.enabled){
      if(!video){video=document.createElement('video');video.autoplay=true;video.playsInline=true;video.muted=true;tile?.prepend(video);}
      video.srcObject=cam; video.style.display='block'; if(avatar)avatar.style.display='none';
    } else {if(video)video.style.display='none';if(avatar)avatar.style.display='flex';}
    camBtn?.classList.toggle('active-control',track.enabled); setLabel(camBtn,track.enabled?'Stop Video':'Start Video');
  }
  async function toggleScreen(){
    if(!navigator.mediaDevices?.getDisplayMedia){alert('Browser එක screen sharing support කරන්නේ නැහැ.');return;}
    if(screen){safeTracks(screen);screen=null;shareBtn?.classList.remove('active-control');setLabel(shareBtn,'Share Screen');return;}
    try{
      screen=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});
      shareBtn?.classList.add('active-control');setLabel(shareBtn,'Stop Sharing');
      screen.getVideoTracks()[0]?.addEventListener('ended',()=>{screen=null;shareBtn?.classList.remove('active-control');setLabel(shareBtn,'Share Screen');});
    }catch(e){}
  }
  micBtn?.addEventListener('click',()=>toggleMic().catch(()=>alert('Microphone permission එක දෙන්න ඕන.')));
  camBtn?.addEventListener('click',()=>toggleCam().catch(()=>alert('Camera permission එක දෙන්න ඕන.')));
  shareBtn?.addEventListener('click',()=>toggleScreen().catch(()=>{}));

  // Participants panel: live local count + host controls.
  const people=room.querySelector('#peopleBtn');
  people?.addEventListener('click',()=>{
    let panel=document.getElementById('participantsPanel');
    if(!panel){
      panel=document.createElement('aside');panel.id='participantsPanel';panel.className='chat-panel open';
      panel.innerHTML='<div class="chat-head">Participants <button id="closeParticipants">×</button></div>'+ 
        '<div class="messages"><p><b>Participants (6)</b></p><p>🎙 <b>John (You)</b></p><p>🎙 Sara</p><p>🎙 Amal</p><p>🎙 Nethmi</p><p>🎙 Kasun</p><p>🎙 Dinushi</p></div>';
      room.appendChild(panel);panel.querySelector('#closeParticipants').onclick=()=>panel.classList.remove('open');
    } else panel.classList.toggle('open');
  });
});




// Reliable local meeting media controls (prototype).
document.addEventListener('DOMContentLoaded',()=>{
  const room=document.querySelector('.meeting-room');
  if(!room) return;
  const controls=[...room.querySelectorAll('.room-controls > button')];
  const micBtn=controls[0], camBtn=controls[1], shareBtn=room.querySelector('.room-controls .share');
  const peopleBtn=document.getElementById('peopleBtn');
  const tile=room.querySelector('.video-grid .tile');
  let micStream=null, camStream=null, screenStream=null, myVideo=null;
  const avatar=tile?.querySelector('.avatar');
  const label=(btn,text)=>{const el=btn?.querySelector('small');if(el)el.textContent=text;};
  async function toggleMic(){
    if(!micStream) micStream=await navigator.mediaDevices.getUserMedia({audio:true});
    const track=micStream.getAudioTracks()[0]; track.enabled=!track.enabled;
    micBtn?.classList.toggle('active-control',track.enabled); label(micBtn,track.enabled?'Mute':'Unmute');
  }
  async function toggleCam(){
    if(!camStream) camStream=await navigator.mediaDevices.getUserMedia({video:true});
    const track=camStream.getVideoTracks()[0]; track.enabled=!track.enabled;
    if(track.enabled){
      if(!myVideo){myVideo=document.createElement('video');myVideo.autoplay=true;myVideo.playsInline=true;myVideo.muted=true;tile?.prepend(myVideo);}
      myVideo.srcObject=camStream; myVideo.style.display='block'; if(avatar)avatar.style.display='none';
    } else {if(myVideo)myVideo.style.display='none';if(avatar)avatar.style.display='flex';}
    camBtn?.classList.toggle('active-control',track.enabled); label(camBtn,track.enabled?'Stop Video':'Start Video');
  }
  async function toggleShare(){
    if(screenStream){screenStream.getTracks().forEach(t=>t.stop());screenStream=null;shareBtn?.classList.remove('active-control');label(shareBtn,'Share Screen');return;}
    screenStream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});
    shareBtn?.classList.add('active-control'); label(shareBtn,'Stop Sharing');
    screenStream.getVideoTracks()[0]?.addEventListener('ended',()=>{screenStream=null;shareBtn?.classList.remove('active-control');label(shareBtn,'Share Screen');});
  }
  micBtn?.addEventListener('click',()=>toggleMic().catch(()=>alert('Microphone permission එක දෙන්න ඕන.')));
  camBtn?.addEventListener('click',()=>toggleCam().catch(()=>alert('Camera permission එක දෙන්න ඕන.')));
  shareBtn?.addEventListener('click',()=>toggleShare().catch(()=>{}));
  peopleBtn?.addEventListener('click',()=>{
    let panel=document.getElementById('participantsPanel');
    if(!panel){
      panel=document.createElement('aside');panel.id='participantsPanel';panel.className='chat-panel open';
      panel.innerHTML='<div class="chat-head">Participants <button id="closeParticipants">×</button></div><div class="messages"><p><b>Participants (1)</b></p><p>🎙 <b>You (Host)</b></p></div>';
      room.appendChild(panel);panel.querySelector('#closeParticipants').onclick=()=>panel.classList.remove('open');
    } else panel.classList.toggle('open');
  });
});

// Scheduling: save upcoming meetings locally for this prototype.
const scheduleBtn=document.getElementById('scheduleBtn');
const scheduledList=document.getElementById('scheduledList');
const scheduleResult=document.getElementById('scheduleResult');
const scheduleDate=document.getElementById('scheduleDate');
if(scheduleDate && !scheduleDate.value) scheduleDate.value=new Date().toISOString().slice(0,10);
function renderScheduled(){
  if(!scheduledList) return;
  let items=[]; try{items=JSON.parse(localStorage.getItem('mnt_scheduled_meetings')||'[]')}catch{}
  if(!items.length){scheduledList.innerHTML='<div class="form-note">No scheduled meetings yet.</div>';return;}
  scheduledList.innerHTML='<h3>Upcoming Meetings</h3>'+items.map((m,i)=>`<div><b>${m.name.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</b><span>${m.date} · ${m.time} · ${m.durationLabel}</span><button class="secondary small" data-copy-schedule="${i}">Copy Link</button></div>`).join('');
  scheduledList.querySelectorAll('[data-copy-schedule]').forEach(b=>b.onclick=async()=>{const m=items[+b.dataset.copySchedule];try{await navigator.clipboard.writeText(m.link);alert('Meeting link copied.')}catch{alert(m.link)}});
}
scheduleBtn?.addEventListener('click',()=>{
  const name=(document.getElementById('scheduleName')?.value||'Scheduled Meeting').trim();
  const date=scheduleDate?.value, time=document.getElementById('scheduleTime')?.value;
  if(!date||!time){alert('Date සහ time select කරන්න.');return;}
  const duration=document.getElementById('scheduleDuration')?.value||'60';
  const durationLabel=duration==='0'?'Unlimited':duration+' minutes';
  const code=Math.random().toString(36).slice(2,8);
  const meeting={name,date,time,duration,durationLabel,link:window.location.origin+window.location.pathname+'?room='+encodeURIComponent(code),password:document.getElementById('schedulePassword')?.value||'',createdAt:new Date().toISOString()};
  let items=[];try{items=JSON.parse(localStorage.getItem('mnt_scheduled_meetings')||'[]')}catch{}
  items.push(meeting);items.sort((a,b)=>(a.date+'T'+a.time).localeCompare(b.date+'T'+b.time));localStorage.setItem('mnt_scheduled_meetings',JSON.stringify(items));
  if(scheduleResult){scheduleResult.style.display='block';scheduleResult.innerHTML='✓ Meeting scheduled. Link: <span>'+meeting.link+'</span> <button id="copyScheduledLink">▣</button>';
    document.getElementById('copyScheduledLink')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(meeting.link);alert('Meeting link copied.')}catch{alert(meeting.link)}});}
  renderScheduled();
});
renderScheduled();

