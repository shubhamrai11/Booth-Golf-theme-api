export async function generatePortrait({ guest, reference, outfitReference, prompt, model, size, quality, key, signal, timeoutMs: requestedTimeout, fetchImpl = fetch }) {
  if (!key) throw new Error('Add your OpenAI API key in Setup before switching to live AI.');
  const body = new FormData();
  body.set('model', model);
  const outfitInstructions = outfitReference ? `\nIMAGE 3: an additional tailored golf-outfit and standing-pose reference. Consider the clothing cuts in both IMAGE 2 and IMAGE 3 and adapt the fit naturally to the guest's visible build and styling in IMAGE 1. IMAGE 3 shows a shaped white polo with red piping, beige tailored trousers, a light belt and white golf shoes; use these details where they suit the guest. Its light belt can replace the dark belt described below. Preserve the guest's own face, age, complexion, hairstyle, hair length, facial hair, accessories and observed body proportions. Do not copy either reference person's face, hairstyle or body shape, combine their identities, slim the guest, or add reference people to the output. Do not infer or label the guest's gender identity. Keep the selected golf scene and coherent sunny lighting. Use only the photograph inside each reference: exclude its frame, footer, logos, text, Edit/share/download buttons and other screenshot controls.` : '';
  body.set('prompt', `IMAGE 1: the current guest; the only source of identity. IMAGE 2: the golf composition reference, not the guest.${outfitInstructions}\n\n${prompt}`);
  body.set('size', size);
  body.set('quality', quality);
  body.set('output_format', 'png');
  body.set('n', '1');
  if (model === 'gpt-image-1.5') body.set('input_fidelity', 'high');
  body.append('image[]', new Blob([guest], { type: 'image/jpeg' }), 'guest.jpg');
  body.append('image[]', new Blob([reference], { type: 'image/jpeg' }), 'golf-reference.jpg');
  if (outfitReference) body.append('image[]', new Blob([outfitReference], { type: 'image/jpeg' }), 'golf-outfit-reference.jpg');
  let response;
  const timeoutMs = requestedTimeout ?? (model.startsWith('gpt-image-2.5-') && ['xhigh', 'max'].includes(quality) ? 600000 : 300000);
  try {
    response = await fetchImpl('https://api.openai.com/v1/images/edits', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (['EACCES', 'EPERM'].includes(error.cause?.code || error.code)) {
      throw new Error('Network access to OpenAI is blocked for this app. Close the booth and reopen Fairway Studio.exe normally, then retry. If it is still blocked, check the app’s network permissions.');
    }
    throw new Error('The AI connection ended or timed out. The provider may have charged for the request. No automatic retry was made; review before retrying.');
  }
  if (!response.ok) {
    const messages = { 401: 'The API key was not accepted. Update it in Setup.', 403: 'Your OpenAI project cannot use this image model. Check model access or verification.', 429: 'The AI account has reached its rate or credit limit. Check billing and retry when ready.', 400: 'The AI provider rejected this request. Check the prompt, model access and images.' };
    throw new Error(messages[response.status] || `AI service returned ${response.status}. No automatic retry was made.`);
  }
  let json;
  try { json = await response.json(); }
  catch { throw new Error('The AI response ended before the image arrived. The provider may have charged. Review before retrying.'); }
  const encoded = json.data?.[0]?.b64_json;
  if (typeof encoded !== 'string' || encoded.length > 50 * 1024 * 1024) throw new Error('The provider did not return a usable image.');
  return Buffer.from(encoded, 'base64');
}
