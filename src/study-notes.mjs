/** Per-document study annotations. No file contents are stored or uploaded. */
import {positionKey} from './reading-progress.mjs';
const PREFIX = 'roseglass:v1:notes:';
const MAX_NOTES = 300;
const MAX_TEXT = 480;
export function notesKey(fingerprint) { return positionKey(fingerprint) ? PREFIX+fingerprint : null; }
export function normalizedNote(value, count) {
  if(!value || !Number.isInteger(count) || count < 1 || !Number.isInteger(value.page) || value.page < 0 || value.page >= count) return null;
  if(typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.id))return null;
  const x=value.x, y=value.y;
  if(!((x===null && y===null)||(Number.isFinite(x)&&Number.isFinite(y)&&x>=0&&x<=1&&y>=0&&y<=1)))return null;
  if(typeof value.text !== 'string')return null;
  return {id:value.id,page:value.page,x,y,text:value.text.trim().slice(0,MAX_TEXT)};
}
export function normalizeNotes(value, count) {
  if(!Array.isArray(value))return [];
  const ids=new Set(), result=[];
  for(const raw of value.slice(0,MAX_NOTES*2)){
    const note=normalizedNote(raw,count);
    if(note&&!ids.has(note.id)){result.push(note);ids.add(note.id);}
    if(result.length===MAX_NOTES)break;
  }
  return result;
}
export function loadNotes(storage,fingerprint,count){
  const key=notesKey(fingerprint);if(!key||!storage)return [];
  try{return normalizeNotes(JSON.parse(storage.getItem(key)||'[]'),count);}catch{return [];}
}
export function saveNotes(storage,fingerprint,count,notes){
  const key=notesKey(fingerprint);if(!key||!storage||!Array.isArray(notes))return false;
  const normalized=normalizeNotes(notes,count);
  try{storage.setItem(key,JSON.stringify(normalized));return true;}catch{return false;}
}