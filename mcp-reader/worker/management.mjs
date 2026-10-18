// Identity headers are trusted only behind Sites dispatch. No body-supplied identity is accepted.
export function requireReaderOwner(request, env) {
  const id = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email');
  if (!env?.READER_OWNER_EMAIL || !id || !email || email.toLowerCase() !== env.READER_OWNER_EMAIL.toLowerCase()) {
    throw new Error('owner-required');
  }
  return id;
}
export const managementTools = [
  {name:'get_development_status',title:'核对共读室开发链路',description:'仅所有者可调用。读回原项目身份、版本和真实开发能力；未接通的改码、测试或发布链路明确返回 unavailable。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,openWorldHint:false}},
  {name:'read_reader_source',title:'读取共读室源码',description:'仅所有者可调用。读取本次部署随包保存的白名单源码快照。不是远程仓库实时读取，不返回凭据、环境或用户 PDF。',inputSchema:{type:'object',properties:{path:{type:'string',enum:['worker/reader.js','worker/ui.html','worker/bridge.js','worker/reader-settings.mjs','worker/zoom/reader-geometry.mjs','worker/zoom/reader-frame.mjs','worker/zoom/reading-focus-marker.mjs','worker/zoom/reading-selection.mjs','worker/zoom/reading-selection-geometry.mjs']},offset:{type:'integer',minimum:0,maximum:200000},length:{type:'integer',minimum:1,maximum:12000}},required:['path'],additionalProperties:false},annotations:{readOnlyHint:true,openWorldHint:false}},
  {name:'get_reader_settings',title:'读取阅读器默认配置',description:'仅所有者可调用。读取当前发布版本的默认设置及保存方式；这些是源码中的版本化默认值，不是跨会话可写配置。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,openWorldHint:false}},
  {name:'get_render_diagnostics',title:'读取阅读器渲染诊断',description:'仅所有者可调用。读取当前部署的渲染策略与验收限制；不会把服务端策略冒充当前浏览器的真实 DPI。实际客户端数值需从阅读器复制。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,openWorldHint:false}},
];
export function managementResult(name, args, {version, uri, defaults, sources}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('invalid-arguments');
  const allowed = name === 'read_reader_source' ? ['path','offset','length'] : [];
  if (Object.keys(args).some(key=>!allowed.includes(key))) throw Error('invalid-arguments');
  const status = {projectId:'YOUR_PROJECT_ID',version,resourceUri:uri,
    capabilities:{readDeployedSource:'available-owner-only',editSource:'unavailable-no-authorized-runner',test:'unavailable-no-authorized-runner',preview:'unavailable',saveVersion:'unavailable-in-site-runtime',publish:'unavailable-in-site-runtime',readBack:'available-version-and-source',rollback:'unavailable-in-site-runtime',updatePersistentSettings:'unavailable-no-persistent-binding'},
    reason:'Sites native save/deploy and short-lived Git credentials exist in the authoring environment. No supported delegated Site-runtime management API or authorized build/deploy runner is connected. GitHub mirror and original-Site deployment integration are unverified.'};
  if(name==='get_development_status')return status;
  if(name==='get_reader_settings')return {version,settings:defaults,storage:'versioned-source-defaults',runtimeWritable:false};
  if(name==='get_render_diagnostics')return {version,resourceUri:uri,policy:defaults,clientTelemetry:null,verification:'No real Work/ordinary-Chat browser rendering or ordinary-Chat-triggered source mutation has been verified. Read client diagnostics in the reader; a server response does not establish real DPI or image receipt.'};
  if(name==='read_reader_source'){
    if(!Object.hasOwn(sources,args.path))throw Error('path-not-allowed');
    const offset=args.offset??0,length=args.length??6000;
    if(!Number.isInteger(offset)||offset<0||offset>200000||!Number.isInteger(length)||length<1||length>12000)throw Error('invalid-range');
    const source=sources[args.path];
    return {path:args.path,version,provenance:'deployed-build-source-snapshot',offset,totalCharacters:source.length,text:source.slice(offset,offset+length),nextOffset:offset+length<source.length?offset+length:null};
  }
  throw Error('unknown-management-tool');
}
