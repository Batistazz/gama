# Folhão Lagoa Santa — Arquitetura & Decisões

**O que é:** artefato web autocontido (abre no navegador, offline, dado só no `localStorage`)
que transforma resultados de exames dispersos em uma **visão longitudinal** da internação —
o "folhão" de exames, muito mais funcional. Voltado a acadêmicos e residentes.
**Não** é prontuário eletrônico. Sem interpretação diagnóstica.

## Decisões travadas
- **Deploy = Opção A / "artefato":** um app HTML autocontido. Vira **link** só hospedando os
  arquivos num host estático grátis; cada pessoa usa o próprio navegador → mexe nos próprios
  pacientes, **sem login, sem servidor de dados** (LGPD leve). Login+nuvem (Caminho 2, Supabase+RLS)
  fica pra quando validar — o parser e o folhão são idênticos, migração sem reescrita.
- **Ingestão numérica = texto colado ou PDF laboratorial.** O pdf.js extrai texto e páginas escaneadas
  passam por OCR local; só o painel entra quando número, unidade, data, confiança e plausibilidade passam
  nos filtros. O paciente aberto é assumido como correto pelo fluxo hospitalar, sem comparar nomes.
  Exame laboratorial fora do quadro vira aviso e não é incluído. A aba “Exames por data” arquiva o original.
- **Parser determinístico**, sem IA. Nunca chuta; na dúvida marca confiança `warn`.
- **Modelo:** Paciente → Internação (Encounter) → Observação (registro individual, nunca coluna-por-dia).
- **Backup v2:** JSON autocontido com o banco e os blobs dos PDFs/fotos em data URL. A restauração
  repõe `localStorage` + `IndexedDB`; “Limpar tudo” apaga ambos. Backups v1 seguem compatíveis,
  com aviso quando metadados de arquivos vierem sem os anexos.
- **UX dinâmica:** cola/solta → folhão preenche na hora. Confiante entra normal; incerto entra
  **sinalizado** (amarelo), nunca em silêncio. Tudo editável na célula. Sem tela de revisão pesada.
- **Painel fixo** sempre visível (hemograma básico, função renal, eletrólitos, PCR); exame
  reconhecido fora dele auto-adiciona; não reconhecido, digita na célula.

## Arquivos
- `index.html` — o app (UI, folhão, ingestão, edição, backup, impressão, 3 pacientes fictícios).
- `parser.js` — parser determinístico (módulo puro, roda no navegador e no Node). **Fonte da verdade.**
- `test_parser.js` — teste de regressão. Roda `node test_parser.js`. **Estado: 25/25 verde.**
- `vendor/` — pdf.js local (offline).

## Parser — como funciona (peça linchpin)
Pipeline: classifica linhas → acha âncora de exame (dicionário de apelidos) → casa com o valor
(inline ou cabeçalho+valor, sempre **entre a âncora e a próxima**) → extrai valor/unidade/referência
→ marca confiança. Modelo de valor: `numeric | less_than | greater_than | qualitative`
(censurado `<0,1` é tipo explícito, nunca coagido a número). Guarda `source_text` de cada resultado (auditoria).
**Regra anti-erro chave:** sigla curta (Na, K, Cr, Mg) só vira exame se vier ANTES do número e
não for parte de unidade — foi o bug que o teste pegou (`mg/dL` sequestrava creatinina).

### Confiança
`ok` vs `warn`. Marca `warn` se: sem unidade, valor fora da faixa fisiológica, reconhecido só por
sigla, ou referência invertida. No folhão o `warn` aparece amarelo com aviso "confira".

## Limiares / referências
Faixas de referência adulto no catálogo são **PADRÃO de partida, não validadas pelo serviço** —
editar. A marcação de anormal usa a referência do laudo quando vem no texto; senão a do catálogo.

## Prior art aproveitado (varredura GitHub)
Nenhum drop-in; ideias/estrutura roubadas (todos MIT):
- **[lab-result-tools](https://github.com/ChristianGLucas/lab-result-tools)** — valor censurado como tipo explícito; veredito `indeterminado`.
- **[lablens](https://github.com/nicolerollo/lablens)** — tabela de apelidos (não dicionário no código); registro de formatos; fila de revisão; raw+normalizado lado a lado.
- **[CannabisCOA.Parser](https://github.com/LJrobinson/CannabisCOA.Parser)** — adaptadores por formato > regex genérico; fixtures + teste de regressão.
- **LOINC** — reservar `loinc_code` p/ interoperabilidade futura (não mapeado agora).

## Pendências / próximos passos
- **Endurecer o parser com colagens reais** do HIS de vocês (anonimizadas) como fixtures. É o que falta pra confiar no uso real.
- Tela de edição do catálogo/apelidos (adicionar sinônimo sem mexer no código).
- Futuro (spec Seções 28–31): sinais vitais, balanço, medicações, culturas, timeline, problemas clínicos; interoperabilidade (CSV/FHIR/LOINC).
- Se quiserem "link com login e conta de verdade": migrar pra Caminho 2 (Supabase auth + Postgres RLS) + tratar LGPD.
