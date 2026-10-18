import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverSelectionWithReceipt} from '../worker/zoom/reading-delivery.mjs';
const packet={selection:{selectionId:'selected-99',pageNumber:3,documentFingerprint:'pdf-digest'},message:'page 3 full text',imageDelivery:{page:false}};
const selectionController={createDelivery:async()=>packet};
test('genuine matching text receipt completes delivery',async()=>{
  let observed;
  const result=await deliverSelectionWithReceipt({selectionController,deliveryArgs:{},sendTextWithAck:async(message,meta)=>{
    observed={message,meta};return {acknowledged:true,selectionId:'selected-99'};
  }});
  assert.equal(result.textAcknowledged,true);
  assert.equal(observed.message,'page 3 full text');
  assert.equal(observed.meta.documentFingerprint,'pdf-digest');
});
test('a bare resolved Promise is NOT a host receipt',async()=>{
  await assert.rejects(deliverSelectionWithReceipt({selectionController,sendTextWithAck:async()=>{}}),/did not acknowledge/);
});
test('a stale reply for another selection is rejected',async()=>{
  await assert.rejects(deliverSelectionWithReceipt({selectionController,sendTextWithAck:async()=>({acknowledged:true,selectionId:'other-id'})}),/did not acknowledge/);
});
test('sender failure is surfaced, not disguised as a sent message',async()=>{
  await assert.rejects(deliverSelectionWithReceipt({selectionController,sendTextWithAck:async()=>{throw new Error('host unavailable');}}),/host unavailable/);
});
test('host acknowledgement is rejected when user changed selection while message was sending',async()=>{
  let active=packet.selection;
  const controller={createDelivery:async()=>packet,getSelection:()=>active};
  await assert.rejects(deliverSelectionWithReceipt({selectionController:controller,
    sendTextWithAck:async()=>{active={...packet.selection,selectionId:'replacement'};
      return {acknowledged:true,selectionId:'selected-99'};}
  }),/did not acknowledge/);
});
test('host acknowledgement works when matching selection is still active',async()=>{
  const controller={createDelivery:async()=>packet,getSelection:()=>packet.selection};
  const sent=await deliverSelectionWithReceipt({selectionController:controller,
    sendTextWithAck:async()=>({acknowledged:true,selectionId:'selected-99'})});
  assert.equal(sent.textAcknowledged,true);
});
