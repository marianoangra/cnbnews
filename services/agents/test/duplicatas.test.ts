import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lerGravadas, mancheteRepetida, parecido } from '../src/duplicatas.ts';

test('duplicatas: pares reais de 26-27/11 e falso positivo do IBGE', () => {
  // mesma pauta, títulos quase iguais
  assert.ok(parecido('Raio atinge plataforma Petrobras a 200 km da costa do Rio', 'Raio atinge plataforma Petrobras P-77 a 200 km da costa do Rio') >= 0.6);
  assert.ok(parecido('Turismo estrangeiro movimentou R$ 53,8 bi em 2026', 'Turismo estrangeiro movimentou R$ 53,8 bilhões no Brasil em 2026') >= 0.6);
  // duas matérias DIFERENTES sobre o mesmo relatório: não pode barrar
  assert.ok(parecido('Expectativa de vida das mulheres no Brasil supera 80 anos', 'Expectativa de vida no Brasil sobe para 76,9 anos, diz IBGE') < 0.6);
});

test('duplicatas: lê front matter (site + fila) e respeita a janela de 48 h', () => {
  const d = mkdtempSync(join(tmpdir(), 'dup-'));
  const site = join(d, 'noticias'), fila = join(d, 'fila');
  mkdirSync(site); mkdirSync(fila);
  writeFileSync(join(site, '2026-11-26-raio.md'), '---\ntitle: "Raio atinge plataforma Petrobras a 200 km da costa do Rio"\nfonte_url: "https://agenciabrasil.ebc.com.br/x"\n---\n\ntexto\n');
  writeFileSync(join(fila, '2026-11-26-benedita.md'), '---\ntitle: "Deputada Benedita: 40 anos pioneira"\nfonte_url: "https://agenciabrasil.ebc.com.br/y"\n---\n');
  writeFileSync(join(site, '_index.md'), '---\ntitle: "Brasil"\n---\n');
  const g = lerGravadas(site, fila, join(d, 'nao-existe'));
  assert.deepEqual(g.map((x) => x.fonteUrl).sort(), ['https://agenciabrasil.ebc.com.br/x', 'https://agenciabrasil.ebc.com.br/y']);
  assert.ok(mancheteRepetida('Raio atinge plataforma Petrobras P-77 a 200 km da costa do Rio', g));
  assert.equal(mancheteRepetida('Dólar cai para R$ 5,51 com nova equipe econômica', g), undefined);
  // depois de 48 h, a mesma manchete pode voltar (fato novo do mesmo assunto)
  assert.equal(mancheteRepetida('Raio atinge plataforma Petrobras P-77 a 200 km da costa do Rio', g, Date.now() + 49 * 3600_000), undefined);
});
