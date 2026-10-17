/** Blind visual challenge. Answers appear ONLY in generated canvas pixels, never in chat prompt or widget metadata. */
const COLORS=[['玫瑰红','#C64D69'],['青绿色','#178C88'],['金黄色','#E6A52E'],['紫色','#7455C0']];
const SHAPES=['圆形','三角形','菱形','五角星'];
export const BLIND_PROMPT='图像链路盲测：请只根据这条消息实际附带的图像像素回答：页内 KEY 是什么？中央图形是什么形状、什么颜色？右侧四格按左上、右上、左下、右下分别是什么颜色？如果你没有收到图像像素，请明确说看不到，禁止根据图片 ID、文件名、文字描述或猜测回答。';
function shuffled(items,random){const arr=[...items];for(let i=arr.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}return arr;}
export function makeChallenge(random=Math.random){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ';
  const key=Array.from({length:5},()=>chars[Math.floor(random()*chars.length)]).join('')+'-'+Math.floor(random()*1000).toString().padStart(3,'0');
  return {key,shape:SHAPES[Math.floor(random()*SHAPES.length)],mainColor:COLORS[Math.floor(random()*COLORS.length)],quadrants:shuffled(COLORS,random)};
}
function drawStar(ctx,x,y,outer,inner){ctx.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,r=i%2?inner:outer,px=x+Math.cos(a)*r,py=y+Math.sin(a)*r;if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);}ctx.closePath();}
export function paintChallenge(canvas,spec){
  if(!canvas?.getContext)throw new Error('缺少挑战图像画布');
  canvas.width=1600;canvas.height=900;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('浏览器无法绘制挑战图像');
  ctx.fillStyle='#FAF6EF';ctx.fillRect(0,0,1600,900);
  ctx.fillStyle='#46383E';ctx.font='bold 56px sans-serif';ctx.fillText('PAGE KEY: '+spec.key,90,115);
  ctx.fillStyle='#836F75';ctx.font='26px sans-serif';ctx.fillText('VISION RECEIPT  /  IMAGE-ONLY CHALLENGE',92,167);
  ctx.strokeStyle='#D9C9C4';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(88,212);ctx.lineTo(1512,212);ctx.stroke();
  const x=630,y=510,size=195;ctx.fillStyle=spec.mainColor[1];ctx.beginPath();
  if(spec.shape==='圆形')ctx.arc(x,y,size,0,Math.PI*2);
  if(spec.shape==='三角形'){ctx.moveTo(x,y-size);ctx.lineTo(x+size,y+size*.85);ctx.lineTo(x-size,y+size*.85);ctx.closePath();}
  if(spec.shape==='菱形'){ctx.moveTo(x,y-size);ctx.lineTo(x+size,y);ctx.lineTo(x,y+size);ctx.lineTo(x-size,y);ctx.closePath();}
  if(spec.shape==='五角星')drawStar(ctx,x,y,size,size*.43);
  ctx.fill();
  ctx.font='bold 32px sans-serif';ctx.fillStyle='#534247';ctx.fillText('COLOR GRID',1105,304);
  const locations=[[1100,344],[1310,344],[1100,554],[1310,554]];
  for(let i=0;i<4;i++){const [px,py]=locations[i];ctx.fillStyle=spec.quadrants[i][1];ctx.fillRect(px,py,174,174);ctx.strokeStyle='#fff';ctx.lineWidth=5;ctx.strokeRect(px,py,174,174);}
  ctx.fillStyle='#837177';ctx.font='24px sans-serif';ctx.fillText('Describe what you can actually see.',91,822);
  return canvas;
}