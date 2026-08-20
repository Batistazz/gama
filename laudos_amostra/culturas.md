# Formatos de laudo de cultura (referência p/ o parser)

Levantado por pesquisa (não temos laudo real anonimizado ainda). Convenções confirmadas em fontes
brasileiras. Quando o usuário conseguir 1 laudo real anonimizado (urocultura + antibiograma), colar aqui
e virar fixture — endurece o parser contra o layout real do HIS de vocês.

Fontes: Medway, Tua Saúde, MD Saúde (ver histórico da conversa).

## Convenções
- **Contagem:** `UFC/mL` (unidades formadoras de colônia). Positivo geralmente `> 100.000 UFC/mL`;
  `10.000–100.000` = correlação clínica; `< 10.000` = contaminação.
- **Germe isolado:** rótulos `Microrganismo isolado`, `Agente isolado`, `Germe`, ou vem na linha do Resultado.
- **Antibiograma:** por antibiótico → **Sensível (S) / Intermediário (I) / Resistente (R)**. Às vezes com
  coluna **CIM/MIC** antes (ex.: `<=2`, `>=64`, `4`). Traço `-` = não testado.
- **Negativo:** `Ausência de crescimento`, `Cultura negativa`, `Não houve crescimento`.
- **Pegadinha:** `Bacilo Gram negativo` descreve o germe (positivo!) — NÃO é cultura negativa.

## Formato A — rótulos + palavra (Hermes Pardini/DB-like)
```
UROCULTURA COM ANTIBIOGRAMA
Material: Urina jato médio
Resultado: Cultura positiva
Contagem de colônias: 100.000 UFC/mL
Microrganismo isolado: Escherichia coli

ANTIBIOGRAMA
Antimicrobiano            Resultado
Amicacina                 Sensível
Ampicilina                Resistente
Cefepima                  Sensível
Nitrofurantoína           Sensível
Sulfametoxazol-Trimetoprima  Resistente
```

## Formato B — coluna CIM/MIC + palavra (Fleury-like)
```
Urocultura
Espécime: urina
Cultura: positiva - > 100.000 UFC/mL
Agente isolado: Klebsiella pneumoniae
Antibiograma:
Antibiótico            CIM        Interpretação
Amicacina              <=2        Sensível
Meropenem              <=0,25     Sensível
Ceftriaxona            >=64       Resistente
```

## Formato C — letras S/I/R sob cabeçalho (HIS MV/Tasy-like)
```
Hemocultura (frasco aeróbio)
Material: sangue periférico
Resultado: positivo
Bacilo Gram negativo: Pseudomonas aeruginosa
Antibiograma
Piperacilina/Tazobactam S
Cefepima S
Meropenem S
Ciprofloxacino R
```

## Formato D — negativo
```
UROCULTURA
Material: urina
Resultado: Ausência de crescimento bacteriano após 48h de incubação.
```
