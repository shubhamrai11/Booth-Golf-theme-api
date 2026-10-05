export const imageModels = ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2', 'gpt-image-1.5'];
export const qualityOptions = model => model.startsWith('gpt-image-2.5-')
  ? ['max', 'xhigh', 'high', 'medium', 'low'] : ['high', 'medium', 'low'];
export const sizeOptions = model => model === 'gpt-image-1.5'
  ? ['1024x1536', '1536x1024', '1024x1024'] : ['1536x2304', '1024x1536', '1536x1024', '1024x1024'];
