import { createAccountService } from "./auth.mjs";

import page from "./public/index.html?raw";
import script from "./public/account.js?raw";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.origin !== env.AUTH_ORIGIN) return new Response("未知的登录地址", {status:404});
    if (!url.pathname.startsWith("/api/auth/")) {
      if (!["GET","HEAD"].includes(request.method)) return new Response(null,{status:405});
      const asset = url.pathname === "/" ? [page,"text/html"] : url.pathname === "/account.js" ? [script,"text/javascript"] : null;
      return asset ? new Response(request.method === "HEAD" ? null : asset[0], {headers:{
        "content-type":asset[1]+"; charset=utf-8","cache-control":"no-store","referrer-policy":"no-referrer",
        "content-security-policy":"default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'","x-content-type-options":"nosniff"
      }}) : new Response(null,{status:404});
    }
    const service = createAccountService({
      origin: env.AUTH_ORIGIN, database: env.DB, secret: env.BETTER_AUTH_SECRET,
      google: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET} : undefined,
      async sendCode(email, otp) {
        if (!(env.MAIL || env.RESEND_API_KEY) || !env.MAIL_FROM) throw new Error("验证码发信服务未配置");
        const message = {from:env.MAIL_FROM,to:email,subject:"Negus 登录验证码",
          text:"您的验证码是 "+otp+"，五分钟内有效。请勿转发。"};
        if (env.MAIL) return env.MAIL.send(message);
        const response = await fetch("https://api.resend.com/emails", {
          method:"POST", headers:{authorization:"Bearer "+env.RESEND_API_KEY,"content-type":"application/json"},
          body:JSON.stringify(message)
        });
        if (!response.ok) throw new Error("验证码发信服务拒绝请求："+response.status);
      }
    });
    return service.handler(request);
  }
};
