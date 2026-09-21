// Isolated UI smoke test: serve the built app from an existing local service.
// All API calls are fixtures, so this test cannot create sessions or send model requests.
// NEGUS_PLAYWRIGHT_MODULE must point to an already-installed playwright/index.mjs.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { readDesktopAutomations } from "../server/desktop-automations.mjs";
const automationSnapshot = await readDesktopAutomations();
const { chromium } = await import(pathToFileURL(process.env.NEGUS_PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const root = "D:/desktop-ui-fixture";
const session = { threadId: "desktop-fixture", source: "codex", title: "测试任务", cwd: root, updatedAt: "2026-09-20T07:00:00Z", messageCount: 2, latestUser: "整理今天的素材", latestAssistant: "已整理", messages: [] };
const status = { type: "execution_status", threadId: session.threadId, turnId: "turn", phase: "completed", active: false, label: "已完成", detail: "", commentary: "", activities: [], updatedAt: session.updatedAt, startedAt: null };
const project = { id: "p", name: "测试项目", kind: "personal", root, conversations: [{ id: session.threadId, threadId: session.threadId, title: session.title, updatedAt: session.updatedAt, status }] };
let sentText = "";
await context.addInitScript(({ root, session, project }) => {
  const put = (key, value) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, value })); };
  put(`negus:desktop-thread:v1:${root}`, session.threadId);
  put("negus-project-directory-v1", [project]);
  put("negus:desktop-workspace:v1", [{ id: "current-tasks", kind: "tasks", title: "当前任务", x: 0, y: 0, w: 6, h: 8 }, { id: "legacy-region", kind: "content", title: "选区 1", x: 6, y: 0, w: 6, h: 8, preview: { role: "assistant", text: "自动化任务的说明文字，不是实际功能" } }]);
}, { root, session, project });
await page.route("**/api/**", async (route) => {
  const url = new URL(route.request().url());
  let data = {};
  if (url.pathname === "/api/session/message") {
    const body = route.request().postDataJSON(); sentText = body.text;
    session.messages = [{ id: "fixture-user", role: "user", text: sentText, turnId: "turn", turnStatus: "completed" }, { id: "fixture-answer", role: "assistant", text: "## 今日素材\n\n这是用于验证选区绑定的测试回复。", turnId: "turn", turnStatus: "completed" }];
    data = { threadId: session.threadId, turnId: "turn", status: "accepted" };
  }
  else if (url.pathname === "/api/desktop/automations") data = automationSnapshot;
  else if (url.pathname === "/api/project") data = { name: project.name, root, mode: "interactive" };
  else if (url.pathname === "/api/project-directory") data = { projects: [project] };
  else if (url.pathname === "/api/sessions") data = [session];
  else if (url.pathname === "/api/session") data = session;
  else if (url.pathname === "/api/execution-status") data = status;
  else if (url.pathname === "/api/session/goal") data = { goal: null };
  else if (url.pathname.includes("queue")) data = { items: [] };
  else if (url.pathname.includes("models")) data = { models: [], channels: [] };
  else if (url.pathname.includes("user-input")) data = { request: null };
  else if (url.pathname.includes("context")) data = { threadId: session.threadId, model: "test", usedTokens: 0, maxTokens: 1000 };
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
});
await page.route("**/events**", (route) => route.fulfill({ status: 200, contentType: "text/event-stream", body: `data: ${JSON.stringify(status)}\n\n` }));
const layout = () => page.evaluate(() => JSON.parse(localStorage.getItem("negus:desktop-workspace:v1")).value);
try {
  await page.goto("http://127.0.0.1:9360/?view=desktop", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "定制桌面", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /撤销|重做|框出区域/ }).count(), 0);
  const client = await context.newCDPSession(page);
  const touch = async (type, x=0, y=0) => client.send("Input.dispatchTouchEvent", { type, touchPoints: ["touchEnd","touchCancel"].includes(type) ? [] : [{x,y}] });
  const draw = async (points) => {
    await touch("touchStart", points[0].x, points[0].y);
    for(const p of points.slice(1)) await touch("touchMove",p.x,p.y);
    await touch("touchEnd");
  };
  await page.getByRole("button", { name:"定制桌面",exact:true }).click();
  const canvas = page.getByLabel("桌面绘制区域",{exact:true});
  const c = await canvas.boundingBox();
  const circle = Array.from({length:41},(_,i)=>({x:c.x+95+53*Math.cos(i*Math.PI/20),y:c.y+328+53*Math.sin(i*Math.PI/20)}));
  await draw(circle);
  await page.locator('[data-region-shape="circle"]').waitFor();
  assert.equal((await layout()).length,3);
  assert.equal((await layout()).find(t=>t.shape==="circle").kind,"content");
  assert.equal(sentText,"","drawing never sends a model request");
  await page.getByText(/针对「新区域/).waitFor();
  const rect=[];
  const corners=[{x:c.x+210,y:c.y+285},{x:c.x+345,y:c.y+285},{x:c.x+345,y:c.y+380},{x:c.x+210,y:c.y+380},{x:c.x+210,y:c.y+285}];
  for(let j=0;j<4;j++) for(let i=0;i<12;i++) rect.push({x:corners[j].x+(corners[j+1].x-corners[j].x)*i/12,y:corners[j].y+(corners[j+1].y-corners[j].y)*i/12});
  rect.push(corners[4]); await draw(rect);
  assert.equal((await layout()).length,4,"rectangle created");
  assert.equal((await layout()).filter(t=>t.kind==="content"&&t.shape==="rectangle").length,1);
  await page.screenshot({path:"runtime/desktop-shapes-mobile-edit.png"});
  const circleTile=page.locator('[data-region-shape="circle"]');
  const box=await circleTile.boundingBox();
  await touch("touchStart",box.x+box.width/2,box.y+box.height/2);await touch("touchEnd");
  await page.getByRole("button",{name:"管理 新区域 1",exact:true}).click();
  await page.getByRole("button",{name:"固定",exact:true}).click();
  assert.equal((await layout()).find(t=>t.shape==="circle").pinned,true);
  assert.equal(await page.getByRole("button",{name:"调整 新区域 1 大小",exact:true}).count(),0);
  const beforePinned=await layout();
  await draw([{x:box.x+box.width/2,y:box.y+box.height/2},{x:box.x+box.width/2+30,y:box.y+box.height/2+30}]);
  assert.deepEqual(await layout(),beforePinned);
  await page.getByRole("button",{name:"管理 新区域 1",exact:true}).click();
  await page.getByRole("button",{name:"取消固定",exact:true}).click();
  const beforeCancel=await layout();
  await touch("touchStart",box.x+box.width/2,box.y+box.height/2);
  await touch("touchMove",box.x+box.width/2,box.y+box.height/2+65);
  await touch("touchCancel"); assert.deepEqual(await layout(),beforeCancel);
  // Drag a component rather than starting a new region.
  await draw([{x:box.x+box.width/2,y:box.y+box.height/2},{x:box.x+box.width/2,y:box.y+box.height/2+64}]);
  assert.equal((await layout()).find(t=>t.shape==="circle").y,beforeCancel.find(t=>t.shape==="circle").y+2);
  const resize=page.getByRole("button",{name:"调整 新区域 1 大小",exact:true});
  await resize.focus(); await page.keyboard.press("ArrowRight");
  assert.equal((await layout()).find(t=>t.shape==="circle").w,beforeCancel.find(t=>t.shape==="circle").w+1);
  await page.getByRole("button",{name:"完成定制",exact:true}).click();
  await page.screenshot({path:"runtime/desktop-shapes-mobile.png"});
  const beforeReload=await layout();
  await page.reload({waitUntil:"domcontentloaded"});
  await page.getByRole("button",{name:"定制桌面",exact:true}).waitFor();
  assert.deepEqual(await layout(),beforeReload);
  const visual=await circleTile.locator("div").first().boundingBox();
  assert.ok(Math.abs(visual.width-visual.height)<1,"circle is not an ellipse");
  await page.setViewportSize({width:1080,height:800});
  await page.screenshot({path:"runtime/desktop-shapes-wide.png"});
  const wideCircle=await circleTile.locator("div").first().boundingBox();
  assert.ok(Math.abs(wideCircle.width-wideCircle.height)<1);
  assert.equal(sentText,"");
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:["single toggle","no undo controls","touch circle","touch rectangle","region context","no model calls","pin/unpin","cancel gesture","drag","resize","persistence","circle proportions mobile/wide"],fixtureConversations:true}));
} catch(error) { await page.screenshot({path:"runtime/desktop-shapes-failure.png"}); throw error; }
finally { await browser.close(); }
