/** Netlify's hosted entry to the same audited BYOK handler as Cloudflare Pages. */
import {handleChat} from '../../functions/api/chat.js';

/** The only public API path; Netlify's routing keeps this separate from static assets. */
export const config={path:'/api/chat'};
export default async function chat(request){
  return handleChat(request);
}
