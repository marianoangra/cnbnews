/** Roda UM ciclo de produção e sai. Uso: npm run gerar -- [limite] */
import 'dotenv/config';
import { gpuConfigurada } from './ffmpeg.ts';
import { EdgeLocutor } from './locutor.ts';
import { cicloProducao } from './producao.ts';

const limite = Number(process.argv[2] ?? Infinity);
const inicio = Date.now();
const r = await cicloProducao(new EdgeLocutor(), gpuConfigurada(), Number.isFinite(limite) ? limite : Infinity);
console.log(JSON.stringify(r), `${Math.round((Date.now() - inicio) / 1000)} s`);
