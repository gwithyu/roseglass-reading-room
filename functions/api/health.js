/** A safe capability probe: does not require or disclose any user's key. */
export function onRequestGet(){
  return new Response(JSON.stringify({
    ok:true,mode:'pages-byok',providers:['deepseek','openai','qwen','kimi'],
    credentials:'user-provided, request-only',sharedModelQuota:false
  }),{
    headers:{
      'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store',
      'Referrer-Policy':'no-referrer',
      'X-Content-Type-Options':'nosniff'
    }
  });
}
