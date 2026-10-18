/**
 * OPTIONAL host adapter for the existing Site: do not replace its authenticated
 * message bridge. Normalize a genuine host receipt to {acknowledged:true,
 * selectionId} only after the host accepted the text message.
 * This helper is not an implementation of ChatGPT messaging or attachment APIs.
 */
export async function deliverSelectionWithReceipt({selectionController, deliveryArgs, sendTextWithAck}={}) {
  if(typeof selectionController?.createDelivery!=='function' || typeof sendTextWithAck!=='function'){
    throw new TypeError('Existing selection controller and authenticated text sender required');
  }
  const packet=await selectionController.createDelivery(deliveryArgs);
  const {selection}=packet;
  if(!selection?.selectionId)throw new TypeError('Missing selection ID');
  const receipt=await sendTextWithAck(packet.message,{selectionId:selection.selectionId,
    pageNumber:selection.pageNumber,documentFingerprint:selection.documentFingerprint});
  const active=selectionController.getSelection?.();
  if(receipt?.acknowledged!==true || receipt?.selectionId!==selection.selectionId ||
      (active && (active.selectionId!==selection.selectionId || active.pageNumber!==selection.pageNumber ||
        active.documentFingerprint!==selection.documentFingerprint))){
    throw new Error('Current Chat did not acknowledge this selection message; do not mark as sent');
  }
  return {...packet,textAcknowledged:true,receipt};
}
