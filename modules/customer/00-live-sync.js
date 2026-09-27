/* Rider order refresh. Replace this file to change polling behavior only. */
(function(){
  const refresh=()=>window.loadOrders?.(true);
  if(!refresh)return;
  let timer=setInterval(()=>{if(document.visibilityState==='visible')refresh()},20000);
  window.addEventListener('beforeunload',()=>clearInterval(timer),{once:true});
})();
