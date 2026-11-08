/* An optional same-browser mirror. Other devices open the shared route as an
 * independent session; BroadcastChannel is never represented as remote pairing. */
export function createRouteMirror({session,onUpdate=()=>{},onStatus=()=>{},Channel=globalThis.BroadcastChannel}={}){
 let channel=null,closed=false;
 const valid=p=>p&&p.version===1&&typeof p.datasetId==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(p.datasetId)&&Number.isSafeInteger(p.holdIndex)&&p.holdIndex>=0&&p.holdIndex<64;
 const send=p=>{try{channel?.postMessage(p);}catch{channel?.close();channel=null;}};
 if(typeof Channel==='function'&&/^[a-zA-Z0-9_-]{1,80}$/.test(session||'')){
  try{channel=new Channel('cyberalpine-route-'+session);}catch{return{publish(){},close(){},available:false};}
  channel.onmessage=event=>{const p=event.data;if(closed||!p||p.session!==session)return;if(p.type==='hello'){onStatus('same-browser');return}if(p.type==='route'&&valid(p)){onStatus('same-browser');onUpdate({datasetId:p.datasetId,holdIndex:p.holdIndex});}};
  send({type:'hello',session});
 }
 return{publish(p){if(channel&&!closed&&valid({...p,version:1}))send({version:1,type:'route',session,datasetId:p.datasetId,holdIndex:p.holdIndex});},close(){closed=true;channel?.close();},get available(){return Boolean(channel)&&!closed;}};
}
