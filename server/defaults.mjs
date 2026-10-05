export const DEFAULT_PROMPT = `Create one natural, sunlit, full-length golf-event photograph of the actual guest in IMAGE 1, using IMAGE 2 as the target for the finished photographic look.

REFERENCE ROLES: IMAGE 1 supplies identity only: preserve this guest's distinctive face shape, eye shape and spacing, nose, lips, jaw, cheeks, age, skin tone, hair, facial hair and glasses if present. Keep their recognizable facial asymmetry and observed build. IMAGE 2 supplies the upright portrait pose, camera viewpoint, sunlight, color palette, golf setting, outfit, props and framing. Never substitute the person in IMAGE 2 for the guest. It may be a screenshot or a photographed print: use only the photograph inside the red frame. Ignore its red border, branding, footer, labels, Edit/share buttons, interface icons, tabletop, cables and paper glare. Output a clean digital photograph without any of those elements.

POSTURE AND FACE: Reconstruct a coherent, relaxed standing portrait of this guest from a camera at their true eye level. Correct any leaning-forward webcam pose from IMAGE 1. The head is upright and balanced over the spine, chin gently raised to neutral, with a natural visible neck above the collar. Forehead and chin are approximately equally far from the camera; the guest looks straight ahead into the lens, not upward from beneath lowered brows. Use relaxed eyelids, natural brows and a small friendly closed-mouth smile. Preserve facial identity while changing head orientation and expression; do not paste the tilted source face onto a standing body. Keep realistic head-to-body proportions and age, and fit the clothing to this person's build without slimming or beautifying their face.

STANDING POSE: Follow IMAGE 2's comfortable, slightly angled stance. Turn the torso about 10 degrees, keep shoulders relaxed, weight resting mostly on one leg, the other knee slightly relaxed and its foot a little forward. Let the face turn naturally back to the lens. Both hands rest lightly together on the golf-club grip at waist level, with a white glove on one hand. The club head rests on the grass. Dress the guest in a clean white polo with thin red piping, beige golf trousers, dark belt and white golf shoes. Show anatomically natural hands, clothing folds, collar contact and grounded feet.

LIGHT AND COLOR: Match the attractive sunny daylight in IMAGE 2. Warm sunlight comes from the upper front-left, with soft blue-sky fill keeping the face open and readable. Create gentle modeling across the forehead, cheeks and jaw, crisp but believable directional shadows on the grass, and coherent light across face, neck, arms and shirt. Replace the source photo's indoor green/gray color cast with healthy warm skin tones while preserving the guest's natural complexion. Keep white clothing clean and neutral, rich fresh green grass, a deep natural blue sky with small white clouds, and a vivid red golf bag. Use clear midtone contrast and rich photographic color without orange skin, oversaturation, crushed shadows or HDR halos.

SETTING AND FINISH: Alpine golf course, evergreen trees and crisp snow-capped mountains under the blue sky. The red golf bag sits to the viewer's left. Give the scene natural depth; keep mountains and trees recognizable with restrained background softness. The guest occupies roughly 88% of the photograph's height, with the complete hair, shoes and club head visible and small comfortable margins. Use natural portrait-lens perspective, detailed skin with pores, individual hair strands, fine fabric texture and consistent photographic sharpness. The result should look like a real person photographed outdoors in one exposure, with no plastic smoothing, face-swap seams, cutout edges, extra people, text, logos, borders or watermarks. The booth adds its event frame afterward.`;

export const defaults = {
  eventName: 'Golf experience',
  mode: 'rehearsal',
  cameraMode: 'canon',
  cameraLabel: 'Canon R100 / EOS 200D',
  sdkPath: '',
  watchFolder: '',
  watchEnabled: false,
  autoGenerate: true,
  prompt: DEFAULT_PROMPT,
  model: 'gpt-image-2.5-sunburst',
  quality: 'max',
  size: '1536x2304',
  reference: 'golf-reference.jpg',
  outfitReference: 'golf-outfit-reference.jpg',
  overlay: '',
  frameEnabled: true,
  frameColor: '#b20d23',
  footerTitle: 'GOLF EXPERIENCE',
  footerSubtitle: 'YOUR MOMENT ON THE GREEN',
  downloadBaseUrl: '',
  displaySeconds: 20,
  retentionDays: 7,
  printerName: '',
};
