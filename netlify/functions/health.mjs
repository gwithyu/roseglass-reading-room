/** Stateless, no credentials, no paid model calls. */
import {onRequestGet} from '../../functions/api/health.js';
export const config={path:'/api/health'};
export default async function health(request){
  if(request.method!=='GET')return new Response(JSON.stringify({error:'仅支持 GET'}),{
    status:405,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
  });
  return onRequestGet();
}
