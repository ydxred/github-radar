// Collection runs only while at least one new-tab document stays open.
// Persistent work is coordinated across tabs by the IndexedDB lease in api.js.
RadarExtension.start().catch(error=>{
 const notice=document.getElementById('data-notice');
 if(notice){notice.hidden=false;notice.textContent='浏览器资料库暂时未能打开：'+error.message;}
});
addEventListener('pagehide',()=>RadarExtension.stop(),{once:true});
