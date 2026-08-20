# Gama — acompanhamento longitudinal de exames

Artefato web autocontido (abre no navegador, **offline**, dados só no `localStorage` do próprio
navegador) que transforma resultados de exames dispersos numa **visão longitudinal da internação**.
Voltado a acadêmicos e residentes.

> **Não é prontuário eletrônico. Sem interpretação diagnóstica. Nenhum dado sai do navegador.**

## Arquivos
- `index.html` — o app (painel de exames, ingestão por colar/PDF, culturas, impressão do prontuário).
- `parser.js` — parser determinístico, **fonte da verdade**. Testes: `node test_parser.js`.
- `vendor/` — pdf.js local (leitura de PDF offline).

## Como usar
Publicado como site estático (GitHub Pages). Cada navegador guarda os **próprios** dados localmente;
use **Backup / Restaurar** para mover os dados entre computadores. Sem login, sem servidor de dados.
