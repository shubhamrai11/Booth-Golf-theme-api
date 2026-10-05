import { defaults } from '../server/defaults.mjs';
import { imageModels, qualityOptions, sizeOptions } from '../shared/image-models.mjs';
export const cloudDefaults = { ...defaults, reference:'', outfitReference:'', autoGenerate:false, downloadBaseUrl:'' };
export function settingsPatch(current, input, hasKey) {
  const patch = {};
  for (const [key,max] of Object.entries({eventName:80,prompt:12000,footerTitle:36,footerSubtitle:64})) if (key in input) {
    if (typeof input[key] !== 'string' || input[key].length > max) throw new Error('Invalid setting: '+key);
    patch[key] = input[key].trim();
  }
  for (const key of ['autoGenerate','frameEnabled']) if (key in input) {
    if (typeof input[key] !== 'boolean') throw new Error('Invalid setting: '+key);
    patch[key] = input[key];
  }
  for (const [key,values] of Object.entries({mode:['rehearsal','live'],cameraMode:['canon','folder','webcam'],model:imageModels})) if (key in input) {
    if (!values.includes(input[key])) throw new Error('Invalid setting: '+key);
    patch[key] = input[key];
  }
  for (const key of ['quality','size']) if (key in input) patch[key] = input[key];
  const config = { ...current,...patch };
  if (!qualityOptions(config.model).includes(config.quality) || !sizeOptions(config.model).includes(config.size)) throw new Error('Choose a quality and size supported by this model.');
  if (config.mode === 'live' && !hasKey) throw new Error('Add OPENAI_API_KEY to Vercel and redeploy before enabling live AI.');
  if ('frameColor' in input) { if (!/^#[a-f0-9]{6}$/i.test(input.frameColor)) throw new Error('Invalid frame colour.'); patch.frameColor = input.frameColor; }
  for (const [key,min,max] of [['displaySeconds',5,120],['retentionDays',1,90]]) if (key in input) {
    if (!Number.isInteger(input[key]) || input[key]<min || input[key]>max) throw new Error('Invalid setting: '+key);
    patch[key] = input[key];
  }
  return patch;
}
