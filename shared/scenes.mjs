export const scenes = [
  { id: 'classic', label: 'Classic', description: 'Your signature golf portrait', prompt: '' },
  { id: 'swing', label: 'Swing', description: 'Your moment on the fairway', prompt: 'For this selected scene, replace the reference pose and outfit with a relaxed golf swing follow-through: navy polo, beige golf trousers, white shoes, club resting above the shoulders. Keep the guest facing enough toward the camera for their face to remain recognizable. One guest only, full body and club in frame, natural anatomy.' },
  { id: 'trophy', label: 'Trophy', description: 'A championship moment', prompt: 'For this selected scene, replace the reference pose and golf bag with the guest proudly holding a gold golf trophy at waist height, standing on the fairway. Keep the white golf polo and beige trousers, entire body visible. One guest only, face unobscured, natural hands holding the trophy. No text or logos on the trophy.' },
  { id: 'cart', label: 'Cart', description: 'A day out on the course', prompt: 'For this selected scene, replace the red golf bag and club pose with the guest standing beside a white golf cart on the fairway. Keep the white polo and beige trousers, one hand resting naturally on the cart, looking toward the camera. One guest only, full body visible, no cart branding.' },
];
export function captureOptions(input = {}) {
  const scene = input.scene || 'classic';
  if (!scenes.some(s => s.id === scene)) throw new Error('Choose one of the available golf scenes.');
  const requestId = input.requestId || '';
  if (typeof requestId !== 'string' || (requestId && !/^[a-f0-9-]{36}$/.test(requestId))) throw new Error('Invalid capture request.');
  const review = input.review ?? false;
  if (![true, false, 'true', 'false'].includes(review)) throw new Error('Invalid photo review option.');
  return { scene, requestId, review: review === true || review === 'true' };
}
export function scenePrompt(prompt, id = 'classic') {
  const scene = scenes.find(s => s.id === id);
  if (!scene) throw new Error('Unknown golf scene.');
  return scene.prompt ? prompt + '\n\nSELECTED SCENE — ' + scene.label + ': ' + scene.prompt + '\nPreserve all original guest identity, image-quality and no-text requirements. This scene choice overrides only the pose, outfit and props described above.' : prompt;
}
