# Gama — acompanhamento longitudinal de exames

Artefato web autocontido (abre no navegador, **offline**, dados só no `localStorage` do próprio
navegador) que transforma resultados de exames dispersos numa **visão longitudinal da internação**.
Voltado a acadêmicos e residentes.

> **Não é prontuário eletrônico. Sem interpretação diagnóstica. Nenhum dado sai do navegador.**

## Arquivos
- `index.html` — o app (painel, importação conservadora de texto/PDF, arquivo de PDF/foto por data e impressão).
- `parser.js` — parser determinístico, **fonte da verdade**. Testes: `node test_parser.js`.
- `vendor/` — pdf.js local (leitura de PDF offline).

## Como usar
Publicado como site estático (GitHub Pages). Cada navegador guarda os **próprios** dados localmente;
use **Backup / Restaurar** para mover os dados entre computadores. O backup v2 inclui também os
PDFs e fotos arquivados em “Exames por data” (backups antigos, sem anexos, continuam aceitos).
Sem login, sem servidor de dados.

## Importação conservadora
- PDF laboratorial: extrai o texto ou usa OCR local quando a página é escaneada e preenche automaticamente o painel numérico seguro.
- Exame laboratorial fora do painel ou linha duvidosa: identifica e não inclui no quadro.
- O paciente aberto é definido pelo fluxo do hospital; o importador não compara nomes do laudo.
- Fotos e exames de imagem não fazem parte do fluxo inicial.
- “Exames por data” continua sendo o lugar para guardar o arquivo original, sem extrair valores.
