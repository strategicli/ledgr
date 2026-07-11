import { parseHTML } from "linkedom";
import fs from "node:fs";
const { document, window } = parseHTML("<!doctype html><html><head></head><body></body></html>");
const g:any=globalThis; g.document=document; g.window=window;
if(!("DOMParser" in g)) g.DOMParser=window.DOMParser;
if(!("MutationObserver" in g)) g.MutationObserver=(window as any).MutationObserver??class{observe(){}disconnect(){}takeRecords(){return[]}};
g.innerHeight=768;g.innerWidth=1024;
const sel={rangeCount:0,removeAllRanges(){},addRange(){},getRangeAt(){return null},anchorNode:null,focusNode:null};
(document as any).getSelection=()=>sel;(window as any).getSelection=()=>sel;
const { Editor } = await import("@tiptap/core");
const { default: StarterKit } = await import("@tiptap/starter-kit");
const { Markdown } = await import("@tiptap/markdown");
const { TaskList, TaskItem } = await import("@tiptap/extension-list");
const { TableRow, TableHeader, TableCell } = await import("@tiptap/extension-table");
const ext = await import("@/components/markdown-editor/extensions");
const toggle = await import("@/components/markdown-editor/toggle-extension");
const extensions=[StarterKit,Markdown.configure({indentation:{style:"space",size:4}}),TaskList,TaskItem.configure({nested:true}),ext.TextColor,ext.Highlight,ext.LedgrImage,ext.LedgrTable.configure({resizable:true}),TableRow,TableHeader,TableCell,ext.LedgrPassage,toggle.Toggle,toggle.ToggleSummary,toggle.ToggleContent];
function load(md:string){const hadImage=/!\[[^\]]*\]\(/.test(md);
 try{const e:any=new Editor({element:document.createElement("div"),injectCSS:false,extensions:extensions as any,content:"",contentType:"markdown" as any});
  e.view.dispatch(e.state.tr.insertText(""));
  e.commands.setContent(md,{contentType:"markdown",emitUpdate:false});
  e.view.dispatch(e.state.tr.insertText(""));
  e.state.doc.check();
  const kept=hadImage?JSON.stringify(e.getJSON()).includes('"image"'):true;
  e.destroy();return {ok:true,hadImage,kept};
 }catch(err){return {ok:false,hadImage,kept:false,err:(err as Error).message}}}
const state=JSON.parse(fs.readFileSync("C:/dev/nsx-migration/import/ledgr-import-state.json","utf8")).notes;
const V=JSON.parse(fs.readFileSync("C:/dev/nsx-migration/import/validated-bodies.json","utf8"));
const done=Object.keys(state).filter((r:string)=>state[r].done&&state[r].id&&V[r]);
const imageRels=done.filter((r:string)=>state[r].images>0);
const others=done.filter((r:string)=>!(state[r].images>0));
// shuffle others, take 300
for(let i=others.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[others[i],others[j]]=[others[j],others[i]];}
const sample=[...imageRels,...others.slice(0,300)];
let n=0,crash=0,lost=0;const bad:string[]=[];
for(const rel of sample){const r=load(V[rel].body);n++;
 if(!r.ok){crash++;bad.push(rel+" :: "+r.err);} else if(r.hadImage&&!r.kept)lost++;
 if(n%100===0)console.log(`…${n}/${sample.length} crashes ${crash} imgLost ${lost}`);}
console.log(`\nRESULT: tested ${n} (all ${imageRels.length} image-notes + ${sample.length-imageRels.length} others) | crashes ${crash} | image lost ${lost}`);
if(bad.length)console.log("BAD:\n  "+bad.slice(0,20).join("\n  "));
