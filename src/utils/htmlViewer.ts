import { getHtmlPlacementTransform } from './htmlPlacement'

/** Kept self-contained so the same loader can run inside an opaque iframe. */
export const loadViewerFontCss = async (css: string): Promise<FontFace[]> => {
  if (!css.trim()) return []
  if (typeof FontFace === 'undefined' || !document.fonts) throw new Error('此浏览器不支持文稿内嵌字体，请升级浏览器。')
  const style = document.createElement('style')
  style.media = 'not all'
  style.textContent = css
  document.head.appendChild(style)
  let faces: FontFace[]
  try {
    if (!style.sheet) throw new Error('无法读取文稿内嵌字体。')
    faces = Array.from(style.sheet.cssRules).filter(rule => rule.type === 5).map(rule => {
      const declaration = (rule as CSSFontFaceRule).style
      const family = declaration.fontFamily.trim().replace(/^(['"])([\s\S]*)\1$/, '$2')
      const descriptors: FontFaceDescriptors = { display: 'block' }
      if (declaration.fontWeight) descriptors.weight = declaration.fontWeight
      if (declaration.fontStyle) descriptors.style = declaration.fontStyle
      if (declaration.fontStretch) descriptors.stretch = declaration.fontStretch
      if (declaration.getPropertyValue('unicode-range')) descriptors.unicodeRange = declaration.getPropertyValue('unicode-range')
      return new FontFace(family, declaration.getPropertyValue('src'), descriptors)
    })
  }
  finally {
    style.remove()
  }
  await Promise.all(faces.map(face => face.load()))
  for (const face of faces) document.fonts.add(face)
  return faces
}

/** Standalone viewer contains no dependencies and never evaluates slide sources. */
export const htmlViewerStyle = `
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#18191c;color:#fff;font-family:system-ui,sans-serif}#stage{position:fixed;inset:0 0 52px;display:flex;align-items:center;justify-content:center;overflow:hidden}.viewer-page{position:absolute;background:#fff;color:#111;transform-origin:center;overflow:hidden}.viewer-page[hidden]{display:none}.viewer-page iframe{display:block;width:100%;height:100%;border:0;background:white}.native-content{position:absolute;left:0;top:0;transform-origin:0 0}.native-content,.native-content *{pointer-events:auto!important}.native-content .image-shadow-asset{pointer-events:none!important}.native-overlay{z-index:1}.native-overlay,.native-overlay *{pointer-events:none!important}.native-overlay .base-element,.native-overlay .base-element *{pointer-events:auto!important}.native-overlay .image-shadow-asset{pointer-events:none!important}#controls{position:fixed;bottom:0;left:0;right:0;height:52px;padding:8px 20px;display:flex;align-items:center;gap:12px;background:#232428}#controls button{border:1px solid #555;border-radius:7px;background:#33353a;color:white;font:inherit;padding:5px 14px;cursor:pointer}#controls button:disabled{opacity:.35;cursor:default}#page-number{min-width:66px;text-align:center;font-variant-numeric:tabular-nums}.spacer{flex:1}.native-content [data-slide-link],.native-content [data-web-link]{cursor:pointer}body.is-printing #stage{position:static;display:block;overflow:visible}body.is-printing .viewer-page{position:relative!important;display:block!important;transform:none!important;margin:0;break-after:page}body.is-printing .viewer-page:last-child{break-after:auto}body.is-printing{height:auto;overflow:visible;background:white}body.is-printing #controls{display:none}@media print{html,body{position:static!important;height:auto!important;overflow:visible!important;background:white!important}#controls{display:none!important}#stage{position:static;display:block;overflow:visible}.viewer-page,.viewer-page[hidden]{position:relative!important;display:block!important;transform:none!important;margin:0!important;break-inside:avoid;break-after:page}.viewer-page:last-child{break-after:auto}body *{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`

export const htmlViewerScript = String.raw`
(()=>{'use strict';
const payload=JSON.parse(document.getElementById('slide-studio-viewer').textContent);
const placementTransform=${getHtmlPlacementTransform.toString()};
const loadFontCss=${loadViewerFontCss.toString()};
const stage=document.getElementById('stage'),counter=document.getElementById('page-number');
const previous=document.getElementById('previous'),next=document.getElementById('next');
let current=Math.max(0,Math.min(payload.pages.length-1,(Number(location.hash.slice(1))||1)-1)),printing=false,nativeReady=typeof payload.fontCss!=='string';const frameLoads=new Map();
const fontStatus={state:nativeReady?'legacy':'loading',nativeFaces:0,pages:{}};window.__slideStudioFontStatus=fontStatus;
const sections=payload.pages.map((page,index)=>{const section=document.createElement('section');section.className='viewer-page';section.dataset.slideId=page.id;section.setAttribute('aria-label','第 '+(index+1)+' 页');section.style.width=payload.width+'px';section.style.height=payload.height+'px';if(!nativeReady)section.style.visibility='hidden';section.innerHTML=page.markup;stage.appendChild(section);return section});
function fontError(error,section){const message='内嵌字体加载失败，已停止展示以避免字体替换和换行重叠。'+(error&&error.message?' '+error.message:'');fontStatus.state='error';fontStatus.message=message;const notice=document.createElement('div');notice.setAttribute('role','alert');notice.style.cssText='position:absolute;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:40px;background:#fff;color:#a31515;font:20px/1.6 sans-serif;white-space:pre-wrap;';notice.textContent=message;(section||stage).appendChild(notice);if(section)section.style.visibility='visible';return error}
function mount(index){
const page=payload.pages[index],section=sections[index];
if(!page.source)return Promise.resolve();
if(section.querySelector(':scope > .html-content > iframe'))return frameLoads.get(index)||Promise.resolve();
const operation=new Promise((resolve,reject)=>{
const frame=document.createElement('iframe'),width=page.width||payload.width,height=page.height||payload.height,scale=Math.min(payload.width/width,payload.height/height),token=Math.random().toString(36).slice(2);
const content=document.createElement('div');content.className='html-content';content.style.cssText='position:absolute;left:0;top:0;width:'+payload.width+'px;height:'+payload.height+'px;overflow:hidden;transform-origin:0 0;transform:'+placementTransform(page);
frame.style.cssText='position:absolute;left:'+((payload.width-width*scale)/2)+'px;top:'+((payload.height-height*scale)/2)+'px;width:'+width+'px;height:'+height+'px;transform:scale('+scale+');transform-origin:0 0';
frame.width=String(width);frame.height=String(height);frame.title='HTML 幻灯片 '+(index+1);frame.setAttribute('sandbox','allow-scripts allow-forms');
const portable=typeof page.fontCss==='string';let finished=false;const finish=error=>{if(finished)return;finished=true;window.removeEventListener('message',ready);if(error){fontStatus.pages[index]={state:'error',message:error.message};reject(error)}else resolve()};
const ready=event=>{if(event.source!==frame.contentWindow)return;if(portable&&event.data?.studioFontError===token){finish(new Error(event.data.message||'网页内嵌字体无法载入。'));return}if(event.data?.studioViewport!==token||event.data.width!==Math.round(width)||event.data.height!==Math.round(height))return;window.removeEventListener('message',ready);if(!frame.isConnected){finish();return}fontStatus.pages[index]={state:'ready',faces:event.data.fontCount||0};frame.addEventListener('load',()=>requestAnimationFrame(()=>requestAnimationFrame(()=>finish())),{once:true});if(portable)frame.contentWindow.postMessage({studioSource:token,source:page.source},'*');else frame.srcdoc=page.source};
window.addEventListener('message',ready);
const probe=portable?'(async()=>{const load='+loadFontCss.toString()+';try{const faces=await load('+JSON.stringify(page.fontCss)+');const source=event=>{if(event.source!==parent||event.data?.studioSource!=='+JSON.stringify(token)+'||typeof event.data.source!=="string")return;removeEventListener("message",source);const original=event.data.source;document.open();for(const face of faces)document.fonts.add(face);window.__slideStudioPreloadedFonts=faces.length;document.write(original);document.close()};addEventListener("message",source);const check=()=>{if(innerWidth==='+Math.round(width)+'&&innerHeight==='+Math.round(height)+')parent.postMessage({studioViewport:'+JSON.stringify(token)+',width:innerWidth,height:innerHeight,fontCount:faces.length},"*");else setTimeout(check,16)};check()}catch(error){document.body.textContent="内嵌字体无法载入，已停止播放。";parent.postMessage({studioFontError:'+JSON.stringify(token)+',message:error.message},"*")}})()':'(()=>{const check=()=>{if(innerWidth==='+Math.round(width)+'&&innerHeight==='+Math.round(height)+')parent.postMessage({studioViewport:'+JSON.stringify(token)+',width:innerWidth,height:innerHeight},"*");else setTimeout(check,16)};check()})()';
frame.srcdoc='<!doctype html><html><head><meta charset="utf-8"></head><body><script>'+probe+'<'+'/script></body></html>';
content.appendChild(frame);section.insertBefore(content,section.firstChild);setTimeout(()=>{if(!portable||!frame.isConnected)finish();else if(!finished)finish(new Error('网页字体或页面载入超时，请检查浏览器兼容性。'))},portable?30000:12000);
});frameLoads.set(index,operation);return operation
}
function fit(){const scale=Math.min(stage.clientWidth/payload.width,stage.clientHeight/payload.height);sections.forEach(section=>{section.style.transform='scale('+Math.max(.01,scale)+')'})}
function show(index){if(printing||!nativeReady)return;current=Math.max(0,Math.min(sections.length-1,index));sections.forEach((section,i)=>{section.hidden=i!==current;section.setAttribute('aria-hidden',String(i!==current));if(i!==current){section.querySelectorAll('video,audio').forEach(media=>media.pause());if(payload.pages[i].source){section.querySelector(':scope > .html-content')?.remove();frameLoads.delete(i)}}});const visibleIndex=current;mount(visibleIndex).catch(error=>fontError(error,sections[visibleIndex]));sections[current].querySelectorAll('[data-autoplay="true"]').forEach(media=>media.play().catch(()=>{}));counter.textContent=(current+1)+' / '+sections.length;previous.disabled=current===0;next.disabled=current===sections.length-1;try{history.replaceState(null,'','#'+(current+1))}catch{};fit()}
previous.addEventListener('click',()=>show(current-1));next.addEventListener('click',()=>show(current+1));
document.addEventListener('keydown',event=>{if(event.altKey||event.ctrlKey||event.metaKey||event.target.closest('input,textarea,select,[contenteditable="true"],video,audio'))return;if(event.key===' '&&event.target.closest('button,[role="button"],a[href]'))return;if(['ArrowRight','PageDown',' '].includes(event.key)){event.preventDefault();show(current+1)}else if(['ArrowLeft','PageUp'].includes(event.key)){event.preventDefault();show(current-1)}else if(event.key==='Home'){event.preventDefault();show(0)}else if(event.key==='End'){event.preventDefault();show(sections.length-1)}});
stage.addEventListener('click',event=>{const anchor=event.target.closest('a[href]');if(anchor)return;const web=event.target.closest('[data-web-link]');if(web){window.open(web.dataset.webLink,'_blank','noopener,noreferrer');return}const link=event.target.closest('[data-slide-link]');if(link){const index=payload.pages.findIndex(page=>page.id===link.dataset.slideLink);if(index>=0)show(index)}});
document.getElementById('fullscreen').addEventListener('click',()=>{const action=document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();if(action)action.catch(()=>{})});
function printLayout(){printing=true;document.body.classList.add('is-printing');sections.forEach(section=>{section.hidden=false;section.setAttribute('aria-hidden','false')})}
async function preparePrint(){await fontPreparation;printLayout();await Promise.all(payload.pages.map((_,index)=>mount(index)));await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode().catch(()=>{})));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))}
function finishPrint(){printing=false;document.body.classList.remove('is-printing');show(current)}
document.getElementById('print').addEventListener('click',async()=>{try{await preparePrint();window.print()}catch(error){fontError(error)}});window.addEventListener('beforeprint',()=>{printLayout();payload.pages.forEach((_,index)=>mount(index).catch(error=>fontError(error,sections[index])))});window.addEventListener('afterprint',()=>requestAnimationFrame(()=>requestAnimationFrame(finishPrint)));window.addEventListener('resize',fit);window.addEventListener('hashchange',()=>show((Number(location.hash.slice(1))||1)-1));const fontPreparation=nativeReady?Promise.resolve():loadFontCss(payload.fontCss).then(async faces=>{await document.fonts.ready;nativeReady=true;fontStatus.state='ready';fontStatus.nativeFaces=faces.length;sections.forEach(section=>{section.style.visibility=''});show(current)}).catch(error=>{fontError(error);throw error});if(nativeReady)show(current);else fontPreparation.catch(()=>{});
})();`
