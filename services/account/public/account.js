const el = id => document.getElementById(id);
async function api(path, body) {
  const response = await fetch('/api/auth/' + path, body === undefined ? {cache:'no-store'} :
    {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const data = await response.json();
  if (!response.ok) throw Error(data?.message || '请求失败，请稍后重试');
  return data;
}
const action = key => document.querySelector('[data-action="'+key+'"]');
async function refresh() {
  const session = await api('get-session');
  el('guest').hidden = !!session?.user;
  el('member').hidden = !session?.user;
  if (session?.user) {
    el('identity').textContent = session.user.email;
    action('link').hidden = (await api('list-accounts')).some(a => a.providerId === 'google');
  }
}
function run(fn) { return async event => {
  event.preventDefault();
  const button = event.submitter || event.currentTarget;
  button.disabled = true;
  try { el('notice').textContent=''; await fn(); }
  catch(error) { el('notice').textContent=error.message; }
  finally { button.disabled=false; }
}; }
for (const [key,path] of [['google','sign-in/social'],['link','link-social']]) {
  action(key).onclick = run(async()=>location.assign((await api(path,{provider:'google',callbackURL:'/'})).url));
}
action('logout').onclick = run(async()=>{await api('sign-out',{});location.replace('/');});
action('reset').onclick = ()=>location.replace('/');
el('form').onsubmit = run(async()=>{
  const email=el('email').value.trim();
  if (el('codeLabel').hidden) {
    await api('email-otp/send-verification-otp',{email,type:'sign-in'});
    el('email').readOnly=true; el('codeLabel').hidden=false; el('code').required=true;
    action('reset').hidden=false; el('submit').textContent='验证并登录'; el('code').focus();
    el('notice').textContent='请查看邮箱，验证码五分钟内有效。';
  } else {
    await api('sign-in/email-otp',{email,otp:el('code').value});
    location.replace('/');
  }
});
refresh().catch(e=>el('notice').textContent=e.message);
