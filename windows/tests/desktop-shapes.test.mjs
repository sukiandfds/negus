import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from '../../web-ui/node_modules/typescript/lib/typescript.js';
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const layout = url(compile(await fs.readFile('web-ui/src/features/desktop/desktopLayout.ts', 'utf8')));
const shapes = compile(await fs.readFile('web-ui/src/features/desktop/desktopShapes.ts', 'utf8')).replace('"./desktopLayout"', JSON.stringify(layout));
const { recognizeStroke, shapeRect } = await import(url(shapes));
const ellipse = (rx=70, ry=60) => Array.from({length:81}, (_, i) => ({ x: 100 + rx * Math.cos(i * Math.PI / 40), y: 100 + ry * Math.sin(i * Math.PI / 40) }));
const rectangle = [];
for (const [a,b] of [[{x:20,y:30},{x:170,y:30}],[{x:170,y:30},{x:170,y:120}],[{x:170,y:120},{x:20,y:120}],[{x:20,y:120},{x:20,y:30}]]) for(let i=0;i<=16;i++) rectangle.push({x:a.x+(b.x-a.x)*i/16,y:a.y+(b.y-a.y)*i/16});
test('circle and imperfect ellipse become circles in either drawing direction',()=>{
  assert.equal(recognizeStroke(ellipse(),390).shape,'circle');
  assert.equal(recognizeStroke(ellipse(65,80).reverse(),390).shape,'circle');
});
test('rectangle remains rectangle despite pauses and nonuniform sampling',()=>{
  assert.equal(recognizeStroke(rectangle,390).shape,'rectangle');
  assert.equal(recognizeStroke([...rectangle.slice(0,10),...Array(30).fill(rectangle[9]),...rectangle.slice(10)],390).shape,'rectangle');
});
test('tap, diagonal selection, open arc and tiny scribble do not create regions',()=>{
  assert.equal(recognizeStroke([{x:1,y:1}],390),null);
  assert.equal(recognizeStroke(Array.from({length:30},(_,i)=>({x:i*5,y:i*5})),390),null);
  assert.equal(recognizeStroke(ellipse().slice(0,35),390),null);
  assert.equal(recognizeStroke(ellipse(5,5),390),null);
});
test('grid geometry is bounded and circle area can contain a true circle',()=>{
  const result=recognizeStroke(ellipse(),390);
  const rect=shapeRect(result.rect,'circle',390);
  assert.ok(rect.x>=0 && rect.x+rect.w<=12 && rect.h>=2);
});
test('rough closed outlines resolve directly without a shape question',()=>{
  const rough = ellipse().map((point,i)=>({x:point.x+Math.sin(i*1.7)*9,y:point.y+Math.cos(i*1.3)*7}));
  assert.ok(['circle','rectangle'].includes(recognizeStroke(rough,390)?.shape));
});
