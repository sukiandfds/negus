import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { nativeCommand } from '../windows/server/computer-control/mcp-server.mjs';
import { installRoot, helperPath } from '../windows/server/computer-control/runtime.mjs';
const exec=promisify(execFile);
if(process.platform!=='darwin')throw new Error('Negus Computer setup currently supports macOS only.');
const app=path.resolve(helperPath,'../../..');
await fs.mkdir(path.dirname(helperPath),{recursive:true});
const source=fileURLToPath(new URL('../windows/server/computer-control/NegusComputer.swift',import.meta.url));
const plist=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.negus.computer</string><key>CFBundleName</key><string>Negus Computer</string><key>CFBundleExecutable</key><string>NegusComputer</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>LSUIElement</key><true/><key>NSScreenCaptureUsageDescription</key><string>Negus uses screenshots to carry out your computer-control requests.</string></dict></plist>`;
// Do not replace an already authorized binary unless its source changed.
const stamp=path.join(installRoot,'runtime/negus-computer-source.swift');
const content=await fs.readFile(source,'utf8');
if(await fs.readFile(stamp,'utf8').catch(()=>null)!==content){
 await exec('/usr/bin/xcrun',['swiftc',source,'-o',helperPath+'.new'],{cwd:installRoot,timeout:120000});
 await fs.rename(helperPath+'.new',helperPath);
 await fs.writeFile(path.join(app,'Contents/Info.plist'),plist);
 await exec('/usr/bin/codesign',['--force','--sign','-','--identifier','local.negus.computer',app]);
 await fs.writeFile(stamp,content);
}
console.log(JSON.stringify(await nativeCommand([process.argv.includes('--authorize')?'authorize':'permissions'])));
