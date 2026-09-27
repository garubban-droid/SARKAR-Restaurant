/* MI EXPRESS BIRYANI - modular frontend loader
 * Any .js/.css file added under modules/<app>/ is loaded automatically.
 * No change to index.html/admin.html/rider.html is required for new modules.
 */
(async function(){
  const tag=document.currentScript;
  const app=tag?.dataset?.app||'customer';
  const bust=Date.now();
  try{
    const r=await fetch('/api/modules/'+encodeURIComponent(app),{cache:'no-store'});
    if(!r.ok)return;
    const files=await r.json();
    for(const f of files){
      const url='/modules/'+encodeURIComponent(app)+'/'+encodeURIComponent(f.name)+'?v='+encodeURIComponent(f.version||bust);
      if(f.type==='css'){
        const l=document.createElement('link');l.rel='stylesheet';l.href=url;document.head.appendChild(l);
      }else if(f.type==='js'){
        await import(url);
      }
    }
    window.dispatchEvent(new CustomEvent('mi:modules-ready',{detail:{app,files}}));
  }catch(e){console.warn('MI module loader:',e)}
})();
