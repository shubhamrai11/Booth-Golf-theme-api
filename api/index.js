import { getDeadline } from '@vercel/functions';
import { TemporaryGeneration } from '../server/temporary-generation.mjs';
const booth=new TemporaryGeneration({key:process.env.OPENAI_API_KEY||'',getDeadline});
export default {fetch:request=>booth.handle(request)};
