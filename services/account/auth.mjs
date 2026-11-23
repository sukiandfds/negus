import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";

export function createAccountService({ database, origin, secret, google, sendCode }) {
  if (!secret || secret.length < 32) throw new Error("缺少账号服务密钥");
  return betterAuth({
    appName: "Negus", baseURL: origin, secret, database,
    socialProviders: google ? { google } : {},
    account: { accountLinking: { enabled: true, disableImplicitLinking: true } },
    rateLimit: { enabled: true, storage: "database" },
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    plugins: [emailOTP({
      expiresIn: 300, allowedAttempts: 3, storeOTP: "hashed",
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== "sign-in") throw new Error("此入口仅用于登录");
        await sendCode(email, otp);
      }
    })]
  });
}
