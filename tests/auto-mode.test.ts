import { observeNativeAdmissions, type AdmissionObservation, createNativeSession, sdk, createGentleAiExtension, fauxAssistantMessage, fauxToolCall } from "./support/bash-preexec-fixture.ts";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

class FixtureStop extends Error {}

async function harness(t:test.TestContext) {
 const home=mkdtempSync(join(tmpdir(),"auto-hook-"));
 const sentinel=join(home,"owned-counter");writeFileSync(sentinel,"unchanged");
 const previous=process.env.GENTLE_PI_CONFIG_HOME;process.env.GENTLE_PI_CONFIG_HOME=home;
 t.after(()=>{if(previous===undefined)delete process.env.GENTLE_PI_CONFIG_HOME;else process.env.GENTLE_PI_CONFIG_HOME=previous;});
 const commands=new Map<string,any>(),requests:any[]=[],records:any[]=[],callbacks:string[]=[],observations:any[]=[];
 const admissions:AdmissionObservation[]=[];
 let confirmations=0,decision="allow",ctx:any;
 const native=await createNativeSession({cwd:home,tools:["*"],extensionFactories:[pi=>{
  const observed=new Proxy(observeNativeAdmissions(pi,admissions),{get(target,key){
   if(key==="registerCommand")return (name:string,value:any)=>{commands.set(name,value);return target.registerCommand(name,value);};
   if(key==="appendEntry")return (type:string,data:any)=>{target.appendEntry(type,data);if(type==="gentle-auto-permission")records.push([type,data]);};
   return Reflect.get(target,key);
  }});
  createGentleAiExtension({nativeReviewCli:null,candidateViews:null,processEnv:{GENTLE_PI_CONFIG_HOME:home},
   resolveTelemetryTriggerBinary:()=>{throw Error("fixture");},autoPermissionClassifier:{cancel(){},run:async(request:any)=>{requests.push(request);return {status:"available",decision,reason:"Fixture",usage:{totalTokens:3}};}}})(observed);
  // Preserve the canonical SDK execute/backend for known local Bash-family aliases.
  for(const name of ["bash_background","monitor"])pi.registerTool({...sdk.createBashToolDefinition(home,{requireAdmission:true,shellPath:"/bin/sh"}),name});
  // Harmless non-shell callbacks exercise family gates, not independent consent implementations.
  for(const name of ["powershell","mcp__fixture__update","custom_tool","codemode","gentle_review","gentle_review_capture","ask_user_choice"])
   pi.registerTool({name,label:name,description:"Unanswered owned fixture callback",parameters:{type:"object",additionalProperties:true} as never,
    execute:async()=>{callbacks.push(name);return {content:[{type:"text",text:"unanswered"}],details:{}};}});
  pi.on("session_start",(_event,context)=>{ctx=context;});
 }]});
 t.after(()=>{native.session.dispose();rmSync(home,{recursive:true,force:true});});
 await native.session.bindExtensions({mode:"tui",uiContext:{notify(){},setStatus(){},setWidget(){},confirm:async()=>{confirmations++;return false;}}});
 return {home,get ctx(){return ctx;},commands,requests,records,callbacks,observations,confirmations:()=>confirmations,setDecision:(v:string)=>decision=v,
  emit:async(name:string,event:any)=>native.session.extensionRunner.emit({type:name,...event}),
  enable:async()=>{assert.ok(commands.get("gentle:mode"));await commands.get("gentle:mode").handler("auto",ctx);},
  input:async(text:string)=>{await native.session.extensionRunner.emitInput(text,undefined,"interactive");native.session.sessionManager.appendMessage({role:"user",content:text,timestamp:1});},
  call:async(toolName:string,input:any)=>{
   const outcomes:any[]=[],attempts:Parameters<typeof childProcess.spawn>[]=[];
   const admissionStart=admissions.length;let legacyProgress=0;
   const unsubscribe=native.session.subscribe((event:any)=>{
    if(event.type==="tool_execution_update"&&event.partialResult.content.length===0)legacyProgress++;
    if(event.type==="tool_execution_end")outcomes.push(event);
   });
   const originalSpawn=childProcess.spawn,stopped=new FixtureStop("FixtureStop: Auto fixture categorically stopped OS process creation");
   childProcess.spawn=((...args:Parameters<typeof originalSpawn>)=>{attempts.push(args);throw stopped;}) as unknown as typeof originalSpawn;
   syncBuiltinESMExports();
   native.faux.setResponses([fauxAssistantMessage([fauxToolCall(toolName,input,{id:"call"})],{stopReason:"toolUse"}),fauxAssistantMessage("done")]);
   try{await native.session.agent.prompt({role:"user",content:"Check only the owned admission fixture.",timestamp:1});}
   finally{unsubscribe();childProcess.spawn=originalSpawn;syncBuiltinESMExports();}
   assert.equal(outcomes.length,1);assert.equal(readFileSync(sentinel,"utf8"),"unchanged");
   const outcome=outcomes[0],reason=outcome.result.content.filter((block:any)=>block.type==="text").map((block:any)=>block.text).join("\n");
   const visits=admissions.slice(admissionStart);
   const nativeCallbacks=visits.filter(entry=>entry.method==="evaluate").length;
   assert.equal(legacyProgress,0,"native dispatch suppresses the legacy empty progress update");
   assert.ok(visits.filter(entry=>entry.method==="isValid").every(entry=>entry.result===true));
   observations.push({toolName,nativeCallbacks,attempts:attempts.length,outcome,admissions:visits});
   if(attempts.length){
    assert.equal(attempts.length,1);assert.equal(nativeCallbacks,1);assert.equal(outcome.isError,true);assert.equal(reason,stopped.message);
    assert.equal((attempts[0][1] as string[]).at(-1),input.command);assert.equal((attempts[0][2] as {cwd:string}).cwd,home);
    return undefined; // final admission reached; the hazardous sample never became an OS process
   }
   if(outcome.isError)assert.ok([
    "Tool execution admission denied",
    "Gentle AI safety policy blocked a destructive shell command. Ask the user for an explicit safer plan.",
    "Permission configuration is human-controlled. Use the mode settings UI; model tools cannot change it.",
    "Auto denied this action: Fixture. Find a materially safer alternative within the request, or ask the user; do not pursue the same effect through another tool.",
   ].includes(reason),`Unexpected SDK failure: ${reason}`);
   return outcome.isError?{block:true,reason}:undefined;
  }};
}

test("public legacy Bash execute retains its empty progress notification",async t=>{
 const cwd=mkdtempSync(join(tmpdir(),"legacy-progress-"));
 t.after(()=>rmSync(cwd,{recursive:true,force:true}));
 const updates:any[]=[];
 const tool=sdk.createBashTool(cwd,{shellPath:"/bin/sh",exposeSessionEnvironment:false});
 const result=await tool.execute("legacy-control",{command:"printf legacy-control"},undefined,(update:any)=>updates.push(update));
 assert.equal(updates.filter(update=>update.content.length===0).length,1);
 assert.equal(result.content.filter((block:any)=>block.type==="text").map((block:any)=>block.text).join(""),"legacy-control");
});

test("production hook Auto reviews eligible default confirmations and all tool families without per-call questions",async t=>{
 const h=await harness(t);await h.enable();await h.input("Implement my change, run tests, and push this branch.");
 for(const tool of ["bash","bash_background","monitor"]){assert.equal(await h.call(tool,{command:"git push origin feature"}),undefined);}
 for(const tool of ["powershell","mcp__fixture__update","custom_tool","codemode"]){assert.equal(await h.call(tool,{command:"local work"}),undefined);}
 assert.equal(h.requests.length,7);assert.equal(h.confirmations(),0);assert.equal(h.records.length,7);
 assert.deepEqual(h.observations.slice(0,3).map(({nativeCallbacks,attempts})=>({nativeCallbacks,attempts})),[{nativeCallbacks:1,attempts:1},{nativeCallbacks:1,attempts:1},{nativeCallbacks:1,attempts:1}]);
 assert.deepEqual(h.callbacks,["powershell","mcp__fixture__update","custom_tool","codemode"]);
 assert.ok(h.requests.every(request=>request.trustedMessages.includes("Implement my change, run tests, and push this branch.")));
 h.setDecision("deny");const denied=await h.call("custom_tool",{action:"publish"});assert.ok(denied);assert.equal(denied.block,true);assert.equal(denied.reason,"Auto denied this action: Fixture. Find a materially safer alternative within the request, or ask the user; do not pursue the same effect through another tool.");
 assert.equal(h.callbacks.length,4,"the actual denied callback never starts");assert.equal(h.requests.length,8);
});

test("Auto cannot bypass data-loss, configured confirmation, protected paths or independent consent",async t=>{
 const h=await harness(t);await h.enable();await h.input("Implement the feature");
 assert.equal((await h.call("bash",{command:"git reset --hard"}))?.block,true);assert.equal(h.confirmations(),0,"existing unconditional destructive block remains");assert.equal(h.requests.length,0);
 writeFileSync(join(h.home,"runtime-guardrails.json"),JSON.stringify({guardedCommands:{gitPush:"confirm"}}));
 assert.equal((await h.call("bash",{command:"git push origin feature"}))?.block,true);assert.equal(h.confirmations(),1);assert.equal(h.requests.length,0);
 const protectedPath=join(h.home,"permission-mode.json"),before=existsSync(protectedPath)?readFileSync(protectedPath,"utf8"):undefined;
 assert.equal((await h.call("write",{path:protectedPath,content:"yolo"}))?.block,true);
 assert.equal(existsSync(protectedPath)?readFileSync(protectedPath,"utf8"):undefined,before);
 for(const tool of ["gentle_review","gentle_review_capture","ask_user_choice"]){assert.equal(await h.call(tool,{}),undefined);}
 assert.equal(h.requests.length,0);
 assert.deepEqual(h.observations.slice(0,2).map(({nativeCallbacks,attempts})=>({nativeCallbacks,attempts})),[{nativeCallbacks:1,attempts:0},{nativeCallbacks:1,attempts:0}]);
 assert.deepEqual(h.callbacks,["gentle_review","gentle_review_capture","ask_user_choice"]);
});

test("normal mode preserves previous guard behavior and named children do not inherit Auto",async t=>{
 const h=await harness(t);assert.equal((await h.call("bash",{command:"git push origin feature"}))?.block,true);assert.equal(h.requests.length,0);
 await h.enable();await h.emit("before_agent_start",{agent:{name:"worker"},systemPromptOptions:{}});
 assert.equal((await h.call("bash",{command:"git push origin feature"}))?.block,true);assert.equal(h.requests.length,0);
 assert.equal(h.confirmations(),2);assert.ok(h.observations.every(observation=>observation.attempts===0));
});
