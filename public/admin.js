const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function req(url,opt={}){const r=await fetch(url,{...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw d;return d}
async function login(){try{await req('/api/admin/login',{method:'POST',body:JSON.stringify({adminId:$('adminId').value})});$('login').classList.add('hidden');$('dash').classList.remove('hidden');$('out').classList.remove('hidden');load()}catch(e){alert(e.error||'Khalad')}}
$('loginBtn').onclick=login;$('out').onclick=async()=>{await req('/api/admin/logout',{method:'POST'});location.reload()};
async function load(){loadStats();loadPayments();loadLessons()}
async function loadStats(){const s=await req('/api/admin/stats');$('stats').innerHTML=[['👥 Users',s.users],['🟢 Active',s.active],['💳 Pending',s.pending],['🎬 Lessons',s.lessons]].map(x=>`<div class="stat"><span>${x[0]}</span><b>${x[1]}</b></div>`).join('')}
async function loadPayments(){const ps=await req('/api/admin/payments');$('payments').innerHTML=ps.length?ps.map(p=>`<div class="pay"><b>📱 ${esc(p.phone)}</b><br><span>$${p.amount} • Ref: <b>${esc(p.reference)}</b></span><br><small>${new Date(p.createdAt).toLocaleString()}</small><br>${p.status==='pending'?`<button class="success" onclick="approve('${p.id}')">✅ Approve +30 maalmood</button><button class="danger" onclick="rejectP('${p.id}')">Reject</button>`:`<span class="hint">Status: ${p.status}</span>`}</div>`).join(''):'<span class="hint">Payment requests ma jiraan.</span>'}
async function approve(id){
  if(!confirm('Ma hubtaa inaad APPROVE gareyneyso payment-kan?')) return;
  try{
    const d=await req('/api/admin/payment/'+encodeURIComponent(id)+'/approve',{method:'POST'});
    alert(d.message||'Payment approved');
    await load();
  }catch(e){
    alert('Approve failed: '+(e.error||e.message||'Khalad aan la aqoon'));
  }
}

async function rejectP(id){
  if(!confirm('Ma hubtaa inaad REJECT gareyneyso payment-kan?')) return;
  try{
    const d=await req('/api/admin/payment/'+encodeURIComponent(id)+'/reject',{method:'POST'});
    alert(d.message||'Payment rejected');
    await load();
  }catch(e){
    alert('Reject failed: '+(e.error||e.message||'Khalad aan la aqoon'));
  }
}
$('publish').onclick=async()=>{const f=$('video').files[0];if(!f)return $('msg').textContent='Video geli.';const fd=new FormData();fd.append('title',$('title').value);fd.append('description',$('desc').value);fd.append('video',f);fd.append('lines',$('lines').value);$('msg').textContent='Uploading...';try{const r=await fetch('/api/admin/lesson',{method:'POST',body:fd});const d=await r.json();if(!r.ok)throw d;$('msg').textContent='✅ Casharka waa la publish gareeyay.';$('title').value='';$('desc').value='';$('video').value='';$('lines').value='';load()}catch(e){$('msg').textContent='❌ '+(e.error||'Khalad')}};
async function loadLessons(){const ls=await req('/api/admin/lessons');$('lessonList').innerHTML=ls.length?ls.map(x=>`<div class="lesson-admin"><span>🎬 <b>${esc(x.title)}</b><br><small class="hint">${x.lines?.length||0} subtitles</small></span><button class="danger" onclick="delLesson('${x.id}')">🗑️ Delete</button></div>`).join(''):'<span class="hint">Wali wax cashar ah lama publish-gareyn.</span>'}
async function delLesson(id){if(!confirm('Casharkan ma tirtiraysaa?'))return;await req('/api/admin/lesson/'+id,{method:'DELETE'});load()}
