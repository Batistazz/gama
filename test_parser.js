/* Teste de regressão do parser. Roda: node test_parser.js  */
const P = require('./parser.js');
const fs = require('fs');
const path = require('path');
const fixtureDir = path.join(__dirname,'laudos_amostra');

const amostraSecao5 = `HEMOGRAMA

Material: sangue total
Método: impedância

Hemoglobina ............. 10,8 g/dL
Valor de referência ..... 13,0 - 17,0

Hematócrito ............. 32,1 %
Valor de referência ..... 40 - 50

Leucócitos .............. 13.200 /mm³

Plaquetas ............... 188.000 /mm³

Responsável técnico: ...

CREATININA

Resultado ............... 1,7 mg/dL
Referência .............. 0,7 - 1,3 mg/dL

Método: cinético

UREIA

Resultado: 68 mg/dL

SÓDIO
Resultado: 138 mEq/L

POTÁSSIO
Resultado: 5,2 mEq/L`;

let fails = 0, passes = 0;
function check(cond, msg){ if(cond){passes++;} else {fails++; console.log('  ✗ FALHOU: '+msg);} }
function get(res, key){ return res.find(r=>r.exam_name_normalized===key); }

console.log('== Amostra Seção 5 ==');
const out = P.parseLabText(amostraSecao5);
const byKey = {};
out.results.forEach(r=> byKey[r.exam_name_normalized]=r);

const esperado = {
  hemoglobina:{v:10.8, rmin:13, rmax:17},
  hematocrito:{v:32.1, rmin:40, rmax:50},
  leucocitos:{v:13200},
  plaquetas:{v:188000},
  creatinina:{v:1.7, rmin:0.7, rmax:1.3},
  ureia:{v:68},
  sodio:{v:138},
  potassio:{v:5.2},
};
Object.keys(esperado).forEach(k=>{
  const r = byKey[k], e = esperado[k];
  check(!!r, 'extraiu '+k);
  if(r){
    check(r.value_numeric===e.v, `${k} valor ${e.v} (veio ${r?r.value_numeric:'—'})`);
    if(e.rmin!=null){ check(r.reference_min===e.rmin && r.reference_max===e.rmax, `${k} referência ${e.rmin}-${e.rmax} (veio ${r.reference_min}-${r.reference_max})`); }
  }
});
// não deve inventar exames a partir de ruído
check(out.results.length===8, 'exatamente 8 resultados (veio '+out.results.length+')');
console.log(`  extraídos: ${out.results.map(r=>r.exam_name_normalized+'='+ (r.value_numeric)).join(', ')}`);

console.log('== Casos-limite ==');
// censurado
const cens = P.parseLabText('PCR\nResultado: <0,1 mg/L');
const pcr = get(cens.results,'pcr');
check(pcr && pcr.value_type==='less_than' && pcr.value_numeric===0.1, 'PCR <0,1 vira less_than/0.1 (veio '+(pcr?pcr.value_type+'/'+pcr.value_numeric:'nada')+')');
// valor implausível deve marcar warn
const impl = P.parseLabText('Potássio ...... 61 mEq/L');
const k = get(impl.results,'potassio');
check(k && k.confidence==='warn', 'K=61 marca confiança warn (veio '+(k?k.confidence:'nada')+')');
// inline nome+valor+ref
const inline = P.parseLabText('Hemoglobina 9,2 g/dL (12,0-16,0)');
const hb = get(inline.results,'hemoglobina');
check(hb && hb.value_numeric===9.2 && hb.reference_min===12, 'inline Hb 9,2 ref 12-16 (veio '+(hb?hb.value_numeric+'/'+hb.reference_min:'nada')+')');
// qualitativo
const qual = P.parseLabText('Cultura ... \nHemoglobina: incontáveis');
// só checa que não quebra
check(true, 'não quebrou em qualitativo');
// data
const dt = P.parseLabText('Coleta: 18/08/2026 06:30\nCreatinina 1,2 mg/dL');
check(dt.dateISO && new Date(dt.dateISO).getDate()===18, 'detectou data 18/08 (veio '+dt.dateISO+')');

console.log('== parsePatientInfo (cabeçalho do prontuário) ==');
const pi = P.parsePatientInfo(`Paciente: JOÃO DA SILVA          Prontuário: 123456
Sexo: Masculino
Data de Nascimento: 12/03/1958
Leito: 12A
Data de Internação: 05/08/2026
Setor: Clínica Médica`);
check(pi.name==='JOÃO DA SILVA', 'nome, cortando coluna do prontuário (veio '+pi.name+')');
check(pi.sex==='M', 'sexo M (veio '+pi.sex+')');
check(pi.birth_date==='1958-03-12', 'nascimento 1958-03-12 (veio '+pi.birth_date+')');
check(pi.admission_date==='2026-08-05', 'internação 2026-08-05 (veio '+pi.admission_date+')');
check(pi.bed==='12A', 'leito 12A (veio '+pi.bed+')');
check(pi.unit==='Clínica Médica', 'setor Clínica Médica (veio '+pi.unit+')');
// feminino, separador por espaço, ano 2-dígitos (nascimento → 19xx), leito sem dois-pontos
const pi2 = P.parsePatientInfo(`Nome: MARIA SANTOS
Sexo F
Nascimento 09/09/70
Leito 07
Unidade: UTI Adulto`);
check(pi2.name==='MARIA SANTOS', 'nome sem coluna (veio '+pi2.name+')');
check(pi2.sex==='F', 'sexo F (veio '+pi2.sex+')');
check(pi2.birth_date==='1970-09-09', 'nascimento 2-díg → 1970-09-09 (veio '+pi2.birth_date+')');
check(pi2.bed==='07', 'leito 07 sem dois-pontos (veio '+pi2.bed+')');
check(pi2.unit==='UTI Adulto', 'unidade UTI Adulto (veio '+pi2.unit+')');
// não inventa: texto sem rótulos → objeto vazio
const pi3 = P.parsePatientInfo('bom dia, tudo certo por aqui');
check(Object.keys(pi3).length===0, 'sem rótulos → nada reconhecido (veio '+JSON.stringify(pi3)+')');

console.log('== detectKind (roteamento do import) ==');
check(P.detectKind('UROCULTURA COM ANTIBIOGRAMA\nEscherichia coli 100.000 UFC/mL')==='culture','urocultura → culture');
check(P.detectKind('TOMOGRAFIA DE ABDOME\nIMPRESSÃO: sem alterações')==='imaging','TC → imaging');
check(P.detectKind(amostraSecao5)==='lab','hemograma → lab');

console.log('== parseCultura A (rótulos + palavra) ==');
const cA = P.parseCulture(`UROCULTURA COM ANTIBIOGRAMA
Material: Urina jato médio
Data da coleta: 12/08/2026
Resultado: Cultura positiva
Contagem de colônias: 100.000 UFC/mL
Microrganismo isolado: Escherichia coli

ANTIBIOGRAMA
Antimicrobiano            Resultado
Amicacina                 Sensível
Ampicilina                Resistente
Cefepima                  Sensível
Nitrofurantoína           Sensível
Sulfametoxazol-Trimetoprima  Resistente`);
check(cA.title==='Urocultura','A título Urocultura (veio '+cA.title+')');
check(cA.material==='Urina jato médio','A material (veio '+cA.material+')');
check(cA.growth==='positivo','A positivo (veio '+cA.growth+')');
check(cA.organism==='Escherichia coli','A germe (veio '+cA.organism+')');
check(/100\.000/.test(cA.cfu||'')&&/UFC/i.test(cA.cfu||''),'A UFC (veio '+cA.cfu+')');
check(cA.antibiogram.length===5,'A 5 antibióticos (veio '+cA.antibiogram.length+')');
const abA={}; cA.antibiogram.forEach(a=>abA[P.norm(a.antibiotic)]=a.result);
check(abA['amicacina']==='S','A amicacina S (veio '+abA['amicacina']+')');
check(abA['ampicilina']==='R','A ampicilina R (veio '+abA['ampicilina']+')');
check(cA.confidence==='ok','A confiança ok (veio '+cA.confidence+'/'+cA.confidence_reason+')');
check(cA.dateISO && new Date(cA.dateISO).getDate()===12,'A data 12 (veio '+cA.dateISO+')');

console.log('== parseCultura B (coluna CIM + palavra) ==');
const cB = P.parseCulture(`Urocultura
Espécime: urina
Cultura: positiva - > 100.000 UFC/mL
Agente isolado: Klebsiella pneumoniae
Antibiograma:
Antibiótico            CIM        Interpretação
Amicacina              <=2        Sensível
Meropenem              <=0,25     Sensível
Ceftriaxona            >=64       Resistente`);
check(cB.organism==='Klebsiella pneumoniae','B germe (veio '+cB.organism+')');
check(cB.growth==='positivo','B positivo (veio '+cB.growth+')');
check(cB.antibiogram.length===3,'B 3 antibióticos apesar do CIM (veio '+cB.antibiogram.length+')');
const abB={}; cB.antibiogram.forEach(a=>abB[P.norm(a.antibiotic)]=a.result);
check(abB['meropenem']==='S'&&abB['ceftriaxona']==='R','B meropenem S / ceftriaxona R');

console.log('== parseCultura C (letras S/R + "Gram negativo" não é negativo) ==');
const cC = P.parseCulture(`Hemocultura (frasco aeróbio)
Material: sangue periférico
Resultado: positivo
Bacilo Gram negativo: Pseudomonas aeruginosa
Antibiograma
Piperacilina/Tazobactam S
Cefepima S
Meropenem S
Ciprofloxacino R`);
check(cC.title==='Hemocultura','C título Hemocultura');
check(cC.growth==='positivo','C positivo apesar de "Gram negativo" (veio '+cC.growth+')');
check(cC.organism==='Pseudomonas aeruginosa','C germe (veio '+cC.organism+')');
check(cC.antibiogram.length===4,'C 4 antibióticos por letra sob cabeçalho (veio '+cC.antibiogram.length+')');
const abC={}; cC.antibiogram.forEach(a=>abC[P.norm(a.antibiotic)]=a.result);
check(abC['ciprofloxacino']==='R','C ciprofloxacino R');

console.log('== parseCultura D (negativo) ==');
const cD = P.parseCulture(`UROCULTURA
Material: urina
Resultado: Ausência de crescimento bacteriano após 48h de incubação.`);
check(cD.growth==='negativo','D negativo (veio '+cD.growth+')');
check(cD.organism===null,'D sem germe (veio '+cD.organism+')');
check(cD.antibiogram.length===0,'D sem antibiograma (veio '+cD.antibiogram.length+')');

console.log('== exame fora do catálogo (atípico → "Outros", warn) ==');
const gEx = P.parseLabText(`Fosfatemia: 2,1 mg/dL
Página: 2
Método: colorimétrico
Aldolase ............. 5,8 U/L
Glicemia ...... 320 mg/dL`);
const gFos = gEx.results.find(r=>r.exam_name_normalized==='fosfatemia');
const gAld = gEx.results.find(r=>r.exam_name_original==='Aldolase');
const gGli = gEx.results.find(r=>r.exam_name_original==='Glicemia');
check(gFos && gFos.value_numeric===2.1, 'capta Fosfatemia 2,1 fora do catálogo (veio '+(gFos?gFos.value_numeric:'nada')+')');
check(gAld && gAld.value_numeric===5.8, 'capta Aldolase 5,8 (leader de pontos) (veio '+(gAld?gAld.value_numeric:'nada')+')');
check(gGli && gGli.value_numeric===320, 'capta Glicemia 320 (veio '+(gGli?gGli.value_numeric:'nada')+')');
check(gFos && gFos.confidence==='warn', 'genérico entra warn (veio '+(gFos?gFos.confidence:'nada')+')');
check(!gEx.results.some(r=>/pagina|metodo/.test(r.exam_name_normalized)), 'NÃO capta ruído Página/Método (veio '+gEx.results.map(r=>r.exam_name_normalized).join(',')+')');
// não pode ter quebrado a amostra numérica canônica (segue 8)
check(P.parseLabText(amostraSecao5).results.length===8, 'amostra canônica segue com 8 resultados');

console.log('== correções de ingestão (regressão) ==');
// referência na MESMA linha do exame (não pode descartar o exame por causa do "VR")
const inl = P.parseLabText('HEMOGRAMA\nHemoglobina  9,8 g/dL   VR 12,0-16,0\nPlaquetas 200.000 /mm3');
const hbInl = get(inl.results,'hemoglobina');
check(hbInl && hbInl.value_numeric===9.8, 'Hb com VR inline capturada (veio '+(hbInl?hbInl.value_numeric:'nada')+')');
check(hbInl && hbInl.reference_min===12 && hbInl.reference_max===16, 'VR inline 12-16 (veio '+(hbInl?hbInl.reference_min+'-'+hbInl.reference_max:'nada')+')');
// linha de coleta/data NÃO vira exame
const dl = P.parseLabText('Creatinina: 1,2 mg/dL\nColeta: 20/08/2026 06:00\nLiberado em: 21/08/2026');
check(!dl.results.some(r=>/coleta|liber/.test(r.exam_name_normalized)), 'linha de data não vira exame (veio '+dl.results.map(r=>r.exam_name_normalized).join(',')+')');
check(dl.results.length===1, 'só a creatinina entrou (veio '+dl.results.length+')');

console.log('== laudo real: hemograma/bioquímica (regressão) ==');
// diferencial: usa o ABSOLUTO (/mm³), não a %
const dif = P.parseLabText('NEUTRÓFILOS SEGMENTADOS:   79,0   %   12395   /mm³   40,0   a   70,0   %   - 1.300   a   6.000   céls/mm³');
const neu = get(dif.results,'neutrofilos');
check(neu && neu.value_numeric===12395, 'diferencial usa absoluto 12395, não 79% (veio '+(neu?neu.value_numeric:'nada')+')');
// nome de exame numa linha, valor em "RESULTADO", com DATA DA COLETA no meio (não pode virar 18)
const sep = P.parseLabText('CREATININA\nDATA DA COLETA.: 18/08/2026\nMATERIAL.......: Sangue\nMÉTODO.........: Enzimático\nRESULTADO......: 0,98 mg/dL');
const cr = get(sep.results,'creatinina');
check(cr && cr.value_numeric===0.98, 'creatinina pega RESULTADO 0,98 e ignora a data (veio '+(cr?cr.value_numeric:'nada')+')');
check(sep.results.length===1, 'só 1 exame (data não virou exame) (veio '+sep.results.length+')');
// unidade /mm³ (superscrito) e não pega o "s" de "plaquetas"
const plq = P.parseLabText('PLAQUETAS..............:   275.900   /mm³   140.000   a   450.000   /mm³');
const pq = get(plq.results,'plaquetas');
check(pq && pq.value_numeric===275900 && pq.unit==='/mm3', 'plaquetas 275.900 unidade /mm3 (veio '+(pq?pq.value_numeric+'/'+pq.unit:'nada')+')');
// INR/RNI sem unidade não deve marcar "sem unidade"
const rni = get(P.parseLabText('RNI: 1,00').results,'inr');
check(rni && rni.confidence==='ok', 'INR 1,00 fica ok (não cobra unidade) (veio '+(rni?rni.confidence:'nada')+')');
// CRBM e nome do paciente não viram exame; "Valor de Referência: ... Protrombina ... 70%" também não
const noise = P.parseLabText('R.T Dra Katia - CRBM 20805\nPACIENTE................: FULANO DE TAL 30-438608\nValor de Referência: Atividade de Protrombina: Maior ou igual a 70 %\nCreatinina: 1,2 mg/dL');
check(!noise.results.some(r=>/crbm|fulano|protrombina|atividade/i.test(r.exam_name_original)), 'CRBM/nome/ref-protrombina não viram exame (veio '+noise.results.map(r=>r.exam_name_original).join(' | ')+')');
check(noise.results.length===1, 'só a creatinina entrou (veio '+noise.results.length+')');
// laudo de hemograma com "IMPRESSÃO: <data>" NÃO é imagem
check(P.detectKind('HEMOGRAMA COMPLETO\nIMPRESSÃO: 18/08/2026 07:05\nHEMOGLOBINA: 13,0 g/dL')==='lab', 'IMPRESSÃO:(data) não roteia como imagem');
// nome do paciente + nº de atendimento (inteiro grande sem unidade) não vira exame
const idl = P.parseLabText('RAIMUNDO JOSE DE OLIVEIRA 30-438608\nCreatinina: 1,1 mg/dL');
check(!idl.results.some(r=>/raimundo|oliveira|\d{4,}/.test(r.exam_name_original)), 'nome+atendimento não vira exame (veio '+idl.results.map(r=>r.exam_name_original).join('|')+')');
check(idl.results.length===1, 'só a creatinina entrou (veio '+idl.results.length+')');
// nome com dígito (PCO2/HCO3) → pega o valor, não o dígito do nome
const gaso = P.parseLabText('PCO2..........: 38,5 mmHg 35 a 45 mmHg\nHCO3..........: 29,8 mmol/L');
check(get(gaso.results,'pco2') && get(gaso.results,'pco2').value_numeric===38.5, 'PCO2 = 38,5 (não o 2 do nome) (veio '+(get(gaso.results,'pco2')||{}).value_numeric+')');
check(get(gaso.results,'hco3') && get(gaso.results,'hco3').value_numeric===29.8, 'HCO3 = 29,8 (veio '+(get(gaso.results,'hco3')||{}).value_numeric+')');
// LINFÓCITOS REATIVOS / NEUTRÓFILOS BASTONETES não colidem com os principais
const difc = P.parseLabText('LINFÓCITOS.............: 12,0 % 1883 /mm³\nLINFÓCITOS REATIVOS....: 0,0 % 0 /mm³\nNEUTRÓFILOS BASTONETES.: 2,0 % 300 /mm³\nNEUTRÓFILOS SEGMENTADOS: 79,0 % 12395 /mm³');
check(get(difc.results,'linfocitos').value_numeric===1883, 'linfócitos = 1883 (reativos não zeram)');
check(get(difc.results,'linfocitos_reativos').value_numeric===0, 'linfócitos reativos separados');
check(get(difc.results,'bastoes').value_numeric===300, 'bastonetes → bastões 300 (não neutrófilos)');
check(get(difc.results,'neutrofilos').value_numeric===12395, 'segmentados → neutrófilos 12395');
// laudo multi-data (uma colagem, várias datas de coleta do mesmo paciente)
const md = P.parseLabText('COLETA...:19/08/2026\nHEMOGLOBINA............: 13,0 g/dL\nCREATININA......: 0,98 mg/dL\nCOLETA...:16/08/2026\nHEMOGLOBINA............: 11,0 g/dL\nCREATININA......: 1,50 mg/dL');
const d19=md.results.filter(r=>(r.collection_dateISO||'').slice(0,10)==='2026-08-19');
const d16=md.results.filter(r=>(r.collection_dateISO||'').slice(0,10)==='2026-08-16');
check(d19.length===2 && d16.length===2, 'multi-data: 2 exames por data (veio 19:'+d19.length+' 16:'+d16.length+')');
check(get(d19,'hemoglobina').value_numeric===13 && get(d16,'hemoglobina').value_numeric===11, 'Hb 13 em 19/08 e 11 em 16/08 (colunas distintas)');

// laudo REAL Controllab/Santa Casa (regressão): nome do exame como cabeçalho + "RESULTADO:" portador,
// hemograma diferencial %/absoluto, eGFR (NÃO NEGRO/NEGRO) suprimido, referência inline "De X a Y",
// bloco "VALORES DE REFERÊNCIA" multi-linha que NÃO pode virar exame.
console.log('== laudo real Controllab (regressão) ==');
const controllab = `PACIENTE...............: FULANO DE TAL SILVA DATA: 24/08/2026 IDADE/SEXO 75 anos-Masculino
SOLICITANTE Dr(a): Dra Ciclana de Tal ATENDIMENTO: 30-000000 CPF: 00000000000
CONVÊNIO...............: SANTA CASA - SANTA CASA S IMPRESSÃO: 25/08/2026 07:36:00 C.I
HEMOGRAMA COMPLETO
COLETA.:25/08/2026
MATERIAL.:Sangue
VALOR DE REFERÊNCIA:
HEMOGLOBINA............: 13,5 g/dL 13,0 a 18,0 g/dL
HEMATÓCRITO............: 42,2 % 38,0 a 52,0 %
LEUCÓCITOS - GLOBAL....: 6.380 céls/mm³ 4.000 a 11.000 céls/mm3
NEUTRÓFILOS BASTONETES.: 0,0 % 0 /mm³ Até 1.000 céls/mm³
NEUTRÓFILOS SEGMENTADOS: 83,0 % 5295 /mm³ 40,0 a 70,0 % - 1.300 a 6.000 céls/mm³
LINFÓCITOS.............: 9,0 % 574 /mm³ 20,0 a 45,0 % - 1.000 a 3.500 céls/mm³
PLAQUETAS..............: 269.200 /mm³ 140.000 a 450.000 /mm³
CREATININA
DATA DA COLETA.: 25/08/2026
MÉTODO.........: Enzimático
RESULTADO......: 0,85 mg/dL
VALORES DE REFERÊNCIA:
Recem-nascidos..: 0.30 a 1.00 mg/dL
Homens..........: 0.60 a 1.30 mg/dL
Mulheres........: 0.60 a 1.30 mg/dL
RITMO DE FILTRAÇÃO GLOMERULAR
MÉTODO: CÁLCULO PELA FÓRMULA CKD-EPI
NÃO NEGRO......: 85,84 mL/min/1,73 m2
NEGRO..........: 99,48 mL/min/1,73 m2
PROTEÍNA C REATIVA QUANTITATIVA
MÉTODO.........: IMUNO-TURBIDIMETRIA
RESULTADO......: 109,37 mg/dL
VALOR DE REFERÊNCIA: INFERIOR A 5 mg/dL
POTÁSSIO
MÉTODO.........: Eletrodo Seletivo
RESULTADO......: 4,80 mEq/L
VALOR DE REFERÊNCIA: De 3,5 a 5,1 mEq/L
SÓDIO
MÉTODO.........: Eletrodo Seletivo
RESULTADO......: 147,6 mEq/L
VALOR DE REFERÊNCIA: De 136 a 145 mEq/L
EXAME REAVALIADO.
URÉIA
RESULTADO...........: 109,20 mg/dL
VALOR DE REFERÊNCIA.: De 9 a 40 mg/dL`;
const cl = P.parseLabText(controllab);
const clv = {};
cl.results.forEach(r=> clv[r.exam_name_normalized]=r);
const clEsp = {
  hemoglobina:{v:13.5}, hematocrito:{v:42.2}, leucocitos:{v:6380},
  bastoes:{v:0}, neutrofilos:{v:5295}, linfocitos:{v:574}, plaquetas:{v:269200},
  creatinina:{v:0.85}, pcr:{v:109.37}, potassio:{v:4.8}, sodio:{v:147.6}, ureia:{v:109.2},
};
Object.keys(clEsp).forEach(k=>{
  const r=clv[k], e=clEsp[k];
  check(!!r, 'Controllab extraiu '+k);
  if(r) check(r.value_numeric===e.v, 'Controllab '+k+' = '+e.v+' (veio '+r.value_numeric+')');
});
// referência inline "De 136 a 145" capturada no sódio
check(clv.sodio && clv.sodio.reference_min===136 && clv.sodio.reference_max===145, 'sódio referência 136-145 (veio '+(clv.sodio?clv.sodio.reference_min+'-'+clv.sodio.reference_max:'nada')+')');
// eGFR (NÃO NEGRO/NEGRO) NÃO entra como exame
check(!cl.results.some(r=>r.value_numeric===85.84||r.value_numeric===99.48), 'eGFR não vira exame');
// nada de ruído/referência virando exame
check(!cl.results.some(r=>/negro|resultado|recem|homens|mulheres|material|impress|atendimento|filtra|reavaliado|refer|paciente|solicitante/i.test(r.exam_name_original)), 'sem exame-fantasma (veio '+cl.results.map(r=>r.exam_name_original).join(' | ')+')');
check(cl.results.length===12, 'Controllab: exatamente 12 exames (veio '+cl.results.length+')');
check(cl.results.every(r=>r.confidence==='ok'), 'Controllab: todos com confiança ok (warns: '+cl.results.filter(r=>r.confidence==='warn').map(r=>r.exam_name_normalized+':'+r.confidence_reason).join(', ')+')');
// todos amarrados na data de coleta 25/08
check(cl.results.every(r=>(r.collection_dateISO||'').slice(0,10)==='2026-08-25'), 'Controllab: tudo em 25/08');

// RUÍDO DE OCR (regressão): laudo-imagem passado por OCR vira "pontilhado" grudado em inteiro-lixo
// ("HEMÁCIAS...ci221022022..1 3,95") e unidade corrompida (³→?, %→8). O parser deve pegar o VALOR
// (número colado na unidade / após limpar o pontilhado), nunca o inteiro-lixo do leader.
console.log('== ruído de OCR (pontilhado vira inteiro-lixo) ==');
const ocrNoise = P.parseLabText(`HEMÁCIAS...ci221022022..1 3,95 milhões/mm?
HEMOGLOBINA....1212212102201 12,1 qg/dL 12,0 a 16,0 qg/dL
HEMATÓCRITO.....1..222..1..12 36,8 8 35,0 a 47,0 &
PLAQUETAS. ...12220020222..1 216.900 /mm?
HCO3...12110200t 22,8 mmol/L 21 a 28 mmol/L`);
const onv = {}; ocrNoise.results.forEach(r=> onv[r.exam_name_normalized]=r);
check(onv.hemacias && onv.hemacias.value_numeric===3.95, 'OCR: hemácias 3,95 (não o inteiro-lixo) (veio '+(onv.hemacias||{}).value_numeric+')');
check(onv.hemoglobina && onv.hemoglobina.value_numeric===12.1, 'OCR: hemoglobina 12,1 (veio '+(onv.hemoglobina||{}).value_numeric+')');
check(onv.hematocrito && onv.hematocrito.value_numeric===36.8, 'OCR: hematócrito 36,8 (veio '+(onv.hematocrito||{}).value_numeric+')');
check(onv.plaquetas && onv.plaquetas.value_numeric===216900, 'OCR: plaquetas 216.900 (veio '+(onv.plaquetas||{}).value_numeric+')');
check(onv.hco3 && onv.hco3.value_numeric===22.8, 'OCR: HCO3 22,8 mmol/L pela unidade (não o "3" do nome nem o leader) (veio '+(onv.hco3||{}).value_numeric+')');
// nenhum inteiro-lixo gigante (do pontilhado) sobrou como valor
check(!ocrNoise.results.some(r=>r.value_numeric>1000000), 'OCR: nenhum inteiro-lixo virou valor (veio '+ocrNoise.results.map(r=>r.value_numeric).filter(v=>v>1000000).join(',')+')');

// Rótulos-ruído de OCR / sublabels de referência NÃO podem virar exame (poluíam a grade).
console.log('== rótulo-ruído de OCR não vira exame ==');
const junk = P.parseLabText(`dA 2) e PRN: 8,84 FL
Cordao: 2,0 mg/dL
Adultos: 2.3 a 4.7 mg/dL
Homens..........: 0.60 a 1.30 mg/dL
Recem-nascidos..: 0.30 a 1.00 mg/dL
Aldolase ............. 5,8 U/L`);
check(!junk.results.some(r=>/prn|cordao|adultos|homens|recem/i.test(r.exam_name_normalized)), 'ruído/demografia não vira exame (veio '+junk.results.map(r=>r.exam_name_normalized).join(',')+')');
check(junk.results.some(r=>r.exam_name_original==='Aldolase' && r.value_numeric===5.8), 'exame atípico legítimo (Aldolase 5,8) ainda entra');

console.log('== triagem conservadora ==');
const safeTriage = P.triageConservative(`COLETA: 29/08/2026 07:30
Hemoglobina: 10,8 g/dL
Creatinina: 1,20 mg/dL
Sódio: 138 mEq/L`);
check(safeTriage.accepted.length===3 && safeTriage.blocked.length===0, 'triagem aceita somente painel seguro completo');
check(safeTriage.accepted.every(r=>r.collection_dateISO), 'triagem segura exige e preserva data');

const wrongUnit = P.triageConservative('COLETA: 29/08/2026\nSódio: 138 mg/dL');
check(wrongUnit.accepted.length===0 && wrongUnit.blocked.some(r=>r.reasons.includes('unidade incompatível')), 'unidade incompatível bloqueia importação');

const knownAdditional = P.triageConservative('COLETA: 29/08/2026\nTGO: 42 U/L');
check(knownAdditional.accepted.length===1 && knownAdditional.accepted[0].exam_name_normalized==='ast', 'todo exame conhecido do catálogo entra automaticamente');

const mixed = P.triageConservative(`COLETA: 29/08/2026
Hemoglobina: 10,8 g/dL
UROCULTURA COM ANTIBIOGRAMA
Escherichia coli 100.000 UFC/mL`);
check(mixed.accepted.length===1 && mixed.notices.some(n=>n.code==='culture') && mixed.kind==='mixed', 'documento misto importa seguro e sinaliza cultura manual');

const urineMixed = P.triageConservative(`Controllab
CONTROLE DE QUALIDADE
PACIENTE: PACIENTE TESTE
HEMOGRAMA COMPLETO
COLETA: 25/08/2026
HEMOGLOBINA: 12,1 g/dL
PACIENTE: PACIENTE TESTE
URINA TIPO 1 (URINA ROTINA)
DATA COLETA: 25/08/2026
MATERIAL: Urina Jato Médio
MÉTODO: Fita Reagente / Microscopia Ótica
VOLUME: 12 mL
pH: 5,5
GLICOSE: AUSENTE
HEMOGLOBINA/HEMÁCIAS: AUSENTES
LEUCÓCITOS: 11 POR CAMPO
HEMÁCIAS: 2 POR CAMPO
CÉLULAS EPITELIAIS: NUMEROSAS POR CAMPO
PACIENTE: PACIENTE TESTE
CREATININA
DATA DA COLETA: 25/08/2026
RESULTADO: 0,73 mg/dL
PACIENTE: PACIENTE TESTE
GRAM, Bacterioscopia
Data Coleta: 25/08/2026
Material: Urina
Resultado: PRESENÇA DE NUMEROSOS BASTONETES GRAM NEGATIVO.`);
check(urineMixed.accepted.some(r=>r.exam_name_normalized==='hemoglobina'&&r.value_numeric===12.1), 'hemoglobina do sangue continua entrando antes do EAS');
check(urineMixed.accepted.some(r=>r.exam_name_normalized==='creatinina'&&r.value_numeric===0.73), 'exame de sangue após o EAS continua entrando');
check(!urineMixed.accepted.some(r=>['ph','glicose','leucocitos','hemacias','bastoes'].includes(r.exam_name_normalized)&&/urina|por campo|gram negativo/i.test(r.source_text||'')), 'itens de Urina/EAS e Gram não entram como exames de sangue');
check(!urineMixed.blocked.some(r=>['pH','Glicose','Hemoglobina','Leucócitos','Hemácias','Bastões','VOLUME','CÉLULAS EPITELIAIS'].includes(r.label)), 'EAS não gera alertas falsos por analito');
check(urineMixed.notices.some(n=>n.code==='urinalysis'&&/Urina\/EAS identificada/.test(n.message)), 'Urina/EAS permanece visível como pendência clara');
check(urineMixed.notices.some(n=>/Bacterioscopia\/Gram identificada/.test(n.message)), 'Bacterioscopia/Gram permanece visível como pendência clara');

const qualitative = P.triageConservative('COLETA: 29/08/2026\nHemoglobina: negativo');
check(qualitative.accepted.length===0 && qualitative.blocked.some(r=>r.reasons.includes('resultado não numérico')), 'resultado qualitativo não entra na grade');

const implausibleSafe = P.triageConservative('COLETA: 29/08/2026\nPotássio: 61 mEq/L');
check(implausibleSafe.accepted.length===0 && implausibleSafe.blocked.some(r=>r.reasons.some(x=>/plausível|fisiológica/.test(x))), 'valor implausível é bloqueado');
check(implausibleSafe.blocked.every(r=>r.reasons.filter(x=>/faixa plausível/.test(x)).length<=1), 'alerta de faixa plausível não aparece duplicado');

const noDate = P.triageConservative('Hemoglobina: 10,8 g/dL');
const withFallback = P.triageConservative('Hemoglobina: 10,8 g/dL','2026-08-29T08:00:00.000Z');
check(noDate.accepted.length===1 && noDate.needsDate, 'resultado seguro sem data pede uma data uma única vez');
check(withFallback.accepted.length===1 && !withFallback.needsDate && withFallback.accepted[0].collection_dateISO, 'data informada destrava o resultado seguro');

const collectionWins = P.triageConservative(`DATA: 24/08/2026
CREATININA
DATA DA COLETA.: 25/08/2026
RESULTADO......: 0,85 mg/dL`);
check(collectionWins.accepted.length===1 && collectionWins.accepted[0].collection_dateISO.slice(0,10)==='2026-08-25', 'DATA DA COLETA prevalece sobre a data do cabeçalho');

const literalPcr = P.triageConservative(`DATA DA COLETA.: 25/08/2026
PROTEÍNA C REATIVA QUANTITATIVA
RESULTADO......: 109,37 mg/dL`);
check(literalPcr.accepted.length===1 && literalPcr.accepted[0].value_numeric===109.37 && P.unitsCompatible(literalPcr.accepted[0].unit,'mg/dL'), 'PCR preserva exatamente valor e unidade impressos no laudo (veio '+JSON.stringify(literalPcr.accepted[0]||literalPcr.blocked)+')');

check(P.unitsCompatible('/mm³','/mm3') && P.unitsCompatible('mEq/L','meq/l') && !P.unitsCompatible('mg/dL','mg/L'), 'normalização de unidade é estrita mas tolera grafia equivalente');
check(P.unitsCompatible('mil/mm3','milhões/mm³'), 'unidade de hemácias abreviada equivale à unidade extensa');
const ocrCountUnit=P.triageConservative(`DATA DA COLETA: 25/08/2026
PLAQUETAS........: 216.900 /mm?`);
check(ocrCountUnit.accepted.length===1 && ocrCountUnit.accepted[0].unit==='/mm3', 'OCR de sobrescrito em /mm? é normalizado contextualmente');
const unitFromReference=P.triageConservative(`PLAQUETAS
DATA DA COLETA: 25/08/2026
RESULTADO: 216.900
VALOR DE REFERÊNCIA: 150.000 a 450.000 /mm3`);
check(unitFromReference.accepted.length===1 && unitFromReference.accepted[0].unit==='/mm3', 'unidade ausente no resultado é herdada da referência imediata');
const wrongCountDimension=P.triageConservative(`DATA DA COLETA: 25/08/2026
SÓDIO: 138 /mm?`);
check(wrongCountDimension.accepted.length===0 && wrongCountDimension.blocked.some(r=>r.reasons.includes('unidade incompatível')), 'unidade celular corrompida não libera analito de dimensão incompatível');
const ocrBandColumns=P.triageConservative(`DATA DA COLETA: 25/08/2026
NEUTRÓFILOS BASTONETES.: 0,0 8% O /mm? Até 1.000 céls/mm?`);
check(ocrBandColumns.accepted.length===0 && ocrBandColumns.blocked.some(r=>r.key==='bastoes'&&r.reasons.includes('unidade incompatível')), 'unidade da coluna absoluta não é aplicada ao número percentual de bastões');

// Perfil KN/Controllab: a coluna de referência nunca pode fornecer o resultado.
console.log('== perfil Controllab: coluna de resultado isolada ==');
const controllabOcr=P.triageConservative(`Controllab
HEMOGRAMA COMPLETO
DATA DA COLETA: 21/08/2026
HEMOCLOBINA............: 13,7 g/dL              13,0 a 18,0 g/dL
HEMATÓCRITO............: 43,9 &         38,0 a 52,0 &
NEUTRÓFILOS BASTONETES.: 10,0 $ 3444 /mm?    Até 1.000 céls/mm'
PLAQUETAS..............: 306.400 /mm'          140.000 a 450.000 /mm?
SÓDIO
RESULTADO..............: 144,8 mEqg/L
VALOR DE REFERÊNCIA....: De 136 a 145 mEg/L`);
const ct={}; controllabOcr.accepted.forEach(r=>ct[r.exam_name_normalized]=r);
check(ct.hemoglobina&&ct.hemoglobina.value_numeric===13.7, 'OCR Controllab: HEMOCLOBINA é hemoglobina 13,7');
check(ct.hematocrito&&ct.hematocrito.value_numeric===43.9&&ct.hematocrito.unit==='%', 'OCR Controllab: & é % somente no hematócrito');
check(ct.bastoes&&ct.bastoes.value_numeric===3444&&ct.bastoes.unit==='/mm3', 'OCR Controllab: bastões usa contagem absoluta');
check(ct.plaquetas&&ct.plaquetas.value_numeric===306400, 'OCR Controllab: plaquetas usa resultado 306.400, nunca referência 450.000');
check(ct.sodio&&ct.sodio.value_numeric===144.8&&ct.sodio.unit==='meq/l', 'OCR Controllab: mEqg/L é normalizado estritamente');

// O PDF.js mantém vários espaços entre ":" e a coluna do resultado. Esses
// espaços iniciais não podem ser confundidos com a divisória resultado/VR.
const nativePdfHemogram=P.triageConservative(`CONTROLE DE QUALIDADE
SANTA CASA
HEMOGRAMA COMPLETO
COLETA...:02/09/2026
MÉTODO...:Sistema Automatizado - Citometria de Fluxo
HEMÁCIAS...............:   4,72   milhões/mm³   4,20 a 5,90 milhões/mm³
HEMOGLOBINA............:   13,7   g/dL   13,0 a 18,0 g/dL
HEMATÓCRITO............:   43,2   %   38,0 a 52,0 %
VCM....................:   91,5   fL   80,0 a 100,0 fL
HCM....................:   29,0   pg   27,0 a 31,0 pg
CHCM...................:   31,7   %   31,0 a 36,0 %
RDW....................:   16,2   %   10,0 a 16,0 %
LEUCÓCITOS - GLOBAL....:   9.400   céls/mm³   4.000 a 11.000 céls/mm³
PLAQUETAS..............:   314.500   /mm³   140.000 a 450.000 /mm³
VPM....................:   7,72   FL   9,2 a 12,6 FL`);
const nph={}; nativePdfHemogram.accepted.forEach(r=>nph[r.exam_name_normalized]=r);
[['hemacias',4.72],['hemoglobina',13.7],['hematocrito',43.2],['vcm',91.5],['hcm',29],['chcm',31.7],['rdw',16.2],['leucocitos',9400],['plaquetas',314500],['vpm',7.72]].forEach(([k,v])=>check(nph[k]&&nph[k].value_numeric===v,'PDF.js Controllab preserva '+k+' = '+v+' com espaços após dois-pontos'));

const fusedHct=P.triageConservative(`Controllab
HEMOGRAMA COMPLETO
DATA DA COLETA: 16/08/2026
HEMATÓCRITO............: 37,78          38,0 a 52,0 &
NEUTRÓFILOS BASTONETES.: 0,0 %      O /mmº    Até 1.000 céls/mmº`);
const fh={}; fusedHct.accepted.forEach(r=>fh[r.exam_name_normalized]=r);
check(fh.hematocrito&&fh.hematocrito.value_numeric===37.7&&fh.hematocrito.ocr_correction, 'OCR Controllab: 37,78 sem unidade recupera 37,7 % com rastreio');
check(fh.bastoes&&fh.bastoes.value_numeric===0&&fh.bastoes.unit==='/mm3', 'OCR Controllab: O /mmº recupera bastões absolutos 0');

const fullHemogramOcr=P.triageConservative(`Controllab
HEMOGRAMA COMPLETO
DATA DA COLETA: 20/08/2026
VCM........: 96,5 EL       80,0 a 100,0 £L
CHCM.......: 31,6 $        31,0 a 36,0 &
EOSINÓFILOS: 0,0 5     0 /mmº
BASÓFILOS..: 0,05      O /mm?
METAMIELÓCITOS: 2,0 5 505 /mm?
MIELOCIIOS: 1,05 252 mm?
PROMIELÓCITOS: 0,05 O /mm?
BLASTOS: 0,05 O “mm?
CÉLULAS ATÍPICAS: 0,05 O “mm?`);
const fhov={}; fullHemogramOcr.accepted.forEach(r=>fhov[r.exam_name_normalized]=r);
check(fhov.vcm&&fhov.vcm.value_numeric===96.5&&P.unitsCompatible(fhov.vcm.unit,'fL'), 'OCR Controllab: VCM com EL é recuperado como fL');
check(fhov.chcm&&fhov.chcm.value_numeric===31.6&&fhov.chcm.unit==='%', 'OCR Controllab: CHCM em % entra no quadro');
[['eosinofilos',0],['basofilos',0],['metamielocitos',505],['mielocitos',252],['promielocitos',0],['blastos',0],['celulas_atipicas',0]].forEach(([k,v])=>check(fhov[k]&&fhov[k].value_numeric===v,k+' com % corrompido pelo OCR preserva a contagem absoluta '+v));

const hospitalFixed=P.triageConservative(`Controllab
CONTROLE DE QUALIDADE
HEMOGRAMA COMPLETO
COLETA: 16/08/2026
HEMATÓCRITO: 37,78          38,0 a 52,0
VCM: 95,4                  80,0 a 100,0
CHCM: 31,8                 31,0 a 36,0
RDW: 15,3                  10,0 a 16,0
NEUTRÓFILOS BASTONETES: 8,0 2018          Até 1.000
CÉLULAS ATÍPICAS: 0,0 0                  0,0 a 0,0
GASOMETRIA ARTERIAL
PCOZ: 38,5
$S02C: 91,2
BILIRRUBINA TOTAL E FRAÇÕES
DATA DA COLETA: 16/08/2026
RESULTADO:
TOTAL: 0,56
DIRETA: 0,19
INDIRETA: 0,37
VALORES DE REFERÊNCIA:`);
const hfixed={};hospitalFixed.accepted.forEach(r=>hfixed[r.exam_name_normalized]=r);
check(P.isHospitalLabText('Controllab\nCONTROLE DE QUALIDADE\nGASOMETRIA ARTERIAL'),'perfil KN/Controllab do hospital é identificado');
check(!P.isHospitalLabText('Outro laboratório\nHEMOGRAMA COMPLETO'),'outro laboratório não recebe regras fixas KN');
check(P.isHospitalLabText('Contr0llab\nCONTROLE DE QUALIDADE\nHEMOGRAMA COMPLETO'),'erro pequeno de OCR no logotipo Controllab é tolerado com estrutura compatível');
const partialHospital=P.assessHospitalLabText(`CONTROLE DE QUALIDADE
SANTA CASA
HEMOGRAMA COMPLETO
DATA DA COLETA: 16/08/2026
RESULTADO: 10,8 g/dL
VALOR DE REFERÊNCIA: 12,0 a 16,0 g/dL`);
check(partialHospital.accepted&&partialHospital.confidence==='probable','perfil hospitalar parcialmente confirmado sobrevive à perda do logotipo');
check(!P.isHospitalLabText('HEMOGRAMA COMPLETO\nDATA DA COLETA: 16/08/2026\nHemoglobina: 10,8 g/dL'),'estrutura laboratorial genérica sem sinais KN continua recusada');
check(!P.isHospitalLabText('OUTRO LABORATÓRIO\nCONTROLE DE QUALIDADE\nHEMOGRAMA COMPLETO\nDATA DA COLETA: 16/08/2026\nRESULTADO: 10,8 g/dL\nVALOR DE REFERÊNCIA: 12,0 a 16,0 g/dL'),'outro laboratório com estrutura genérica completa continua recusado');
[['hematocrito',37.7],['vcm',95.4],['chcm',31.8],['rdw',15.3],['bastoes',2018],['celulas_atipicas',0],['pco2',38.5],['sato2',91.2],['bilirrubina_total',0.56],['bilirrubina_direta',0.19],['bilirrubina_indireta',0.37]].forEach(([k,v])=>check(hfixed[k]&&hfixed[k].value_numeric===v,'perfil hospitalar fixo recupera '+k+' = '+v+' sem depender da unidade OCR (veio '+(hfixed[k]||{}).value_numeric+')'));
check(['vcm','chcm','rdw','bastoes','celulas_atipicas','pco2','sato2','bilirrubina_total','bilirrubina_direta','bilirrubina_indireta'].every(k=>hfixed[k]&&hfixed[k].confidence==='ok'),'campos fixos hospitalares recuperados entram com confiança ok');

const bilirubinPdfLayout=P.triageConservative(`Controllab
CONTROLE DE QUALIDADE
BILIRRUBINA TOTAL E FRAÇÕES
DATA DA COLETA: 28/08/2026
RESULTADO:
0,66 mg/dL
TOTAL..........:
0,10 mg/dL
DIRETA.........:
INDIRETA.......: 0,56 mg/dL
VALORES DE REFERÊNCIA:`);
const bpl={}; bilirubinPdfLayout.accepted.forEach(r=>bpl[r.exam_name_normalized]=r);
[['bilirrubina_total',0.66],['bilirrubina_direta',0.10],['bilirrubina_indireta',0.56]].forEach(([k,v])=>check(bpl[k]&&bpl[k].value_numeric===v,'layout real do PDF preserva '+k+' = '+v));
const bilirubinMismatch=P.triageConservative(`Controllab
BILIRRUBINA TOTAL E FRAÇÕES
DATA DA COLETA: 28/08/2026
RESULTADO:
0,66 mg/dL
TOTAL: 0,40 mg/dL
DIRETA: 0,56 mg/dL
VALORES DE REFERÊNCIA:`);
check(!bilirubinMismatch.accepted.some(r=>/^bilirrubina_/.test(r.exam_name_normalized)),'bilirrubinas que não fecham matematicamente são bloqueadas');

const standaloneLithium=P.triageConservative(`CONTROLE DE QUALIDADE
SANTA CASA
RUA MARIA GERTRUDES DOS SANTOS, 218
LÍTIO
DATA DA COLETA: 30/08/2026
MATERIAL: Sangue
MÉTODO: ELETRODO ÍON SELETIVO
RESULTADO: 1,85 mmol/L
VALOR DE REFERÊNCIA: DE 0,50 A 1,20 mmol/L`);
check(standaloneLithium.profileAssessment.accepted,'laudo hospitalar unitário de lítio é reconhecido pela estrutura completa');
const sl=get(standaloneLithium.accepted,'litio');
check(sl&&sl.value_numeric===1.85&&sl.unit==='mmol/l','laudo unitário importa lítio 1,85 mmol/L');
const standaloneBilirubin=P.triageConservative(`CONTROLE DE QUALIDADE
SANTA CASA
RUA MARIA GERTRUDES DOS SANTOS, 218
BILIRRUBINA TOTAL E FRAÇÕES
DATA DA COLETA: 29/08/2026
RESULTADO:
0,47 mg/dL
TOTAL:
0,12 mg/dL
DIRETA:
INDIRETA: 0,35 mg/dL
VALORES DE REFERÊNCIA:`);
check(standaloneBilirubin.profileAssessment.accepted&&standaloneBilirubin.accepted.filter(r=>/^bilirrubina_/.test(r.exam_name_normalized)).length===3,'laudo hospitalar unitário importa as três bilirrubinas');
check(!P.assessHospitalLabText('OUTRO LABORATÓRIO\nLÍTIO\nDATA DA COLETA: 30/08/2026\nRESULTADO: 1,85 mmol/L\nVALOR DE REFERÊNCIA: 0,50 A 1,20').accepted,'lítio de outro laboratório continua recusado');

const differentialPercentOnly=P.triageConservative(`Controllab
CONTROLE DE QUALIDADE
HEMOGRAMA COMPLETO
COLETA: 16/08/2026
NEUTRÓFILOS SEGMENTADOS: 75,0 %          1.500 a 7.500 /mm3`);
check(!differentialPercentOnly.accepted.some(r=>r.exam_name_normalized==='neutrofilos'), 'diferencial sem contagem absoluta não converte porcentagem em /mm3');

const missingTableResult=P.triageConservative(`Controllab
HEMOGRAMA COMPLETO
DATA DA COLETA: 16/08/2026
PLAQUETAS:          140.000 a 450.000 /mm?`);
check(missingTableResult.accepted.length===0, 'Controllab: resultado ausente não importa número da referência');

const duplicateSame=P.triageConservative(`DATA DA COLETA: 16/08/2026
PLAQUETAS: 242.500 /mm3
PLAQUETAS
RESULTADO: 242.500
VALOR DE REFERÊNCIA: 150.000 a 450.000 /mm3`);
check(duplicateSame.accepted.length===1&&duplicateSame.accepted[0].value_numeric===242500, 'duplicata idêntica do mesmo dia é consolidada');
const duplicateConflict=P.triageConservative(`DATA DA COLETA: 16/08/2026
PLAQUETAS: 242.500 /mm3
PLAQUETAS: 450.000 /mm3`);
check(duplicateConflict.accepted.length===0&&duplicateConflict.blocked.some(r=>r.reasons.includes('resultados conflitantes para o mesmo exame e data')), 'duplicatas divergentes são todas bloqueadas');

console.log('== gasometria padronizada ==');
const gasometry=P.triageConservative(`Controllab
GASOMETRIA ARTERIAL
DATA DA COLETA: 18/08/2026
MATERIAL: Sangue Arterial
VALORES DE REFERÊNCIA
pE...........os    7,446                       7,35 a 7,45
POZ......0..0007    87,0   mmiÃg                  83 a 108 mmãg
PCOZ..........05    49,3   mmilg                  35 a 45 mmig
ECO3...sassasas      34,2     mmol/L                        21 a 28 mmol/L
TCOZ...sassasas      35,8     mmol/L                        24 a 31 mmol/L
BE-D....ass2..3     9,2     mmol/L                       DE -3,0 a +3,0 mmol/L
$S02C.........]    96,8   $                    95 a 99 &
ANION -GAP....:      10,4     mmol/L                           DÊ 10 A 14 mmol/L
ÁCIDO LÁTICO — LACTATO
MATERIAL: Sangue
RESULTADO: 1,0 mmol/L`);
const gv={}; gasometry.accepted.forEach(r=>gv[r.exam_name_normalized]=r);
const gasExpected={ph:7.446,po2:87,pco2:49.3,hco3:34.2,tco2:35.8,be:9.2,sato2:96.8,anion_gap:10.4,lactato:1};
check(gasometry.accepted.length===9, 'gasometria: nove resultados automáticos (veio '+gasometry.accepted.length+')');
Object.keys(gasExpected).forEach(k=>check(gv[k]&&gv[k].value_numeric===gasExpected[k], 'gasometria '+k+' = '+gasExpected[k]+' (veio '+(gv[k]||{}).value_numeric+')'));
check(gv.ph&&gv.ph.unit==null&&gv.po2.unit==='mmhg'&&gv.sato2.unit==='%', 'gasometria: unidades OCR normalizadas e pH sem unidade');
check(['ph','po2','pco2','hco3','tco2','be','sato2','anion_gap'].every(k=>gv[k]&&gv[k].sample_type==='arterial')&&gv.lactato.sample_type==null, 'gasometria: amostra arterial preservada sem rotular lactato sérico');
check(!gasometry.notices.some(n=>n.code==='other_lab'), 'gasometria padronizada não pede anotação manual');

const twoSamples=P.triageConservative(`GASOMETRIA VENOSA
DATA DA COLETA: 18/08/2026
MATERIAL: Sangue Venoso
pH: 7,350
GASOMETRIA ARTERIAL
DATA DA COLETA: 18/08/2026
MATERIAL: Sangue Arterial
pH: 7,440`);
check(twoSamples.accepted.length===2&&twoSamples.accepted.some(r=>r.sample_type==='venous')&&twoSamples.accepted.some(r=>r.sample_type==='arterial'), 'gasometrias arterial e venosa do mesmo dia não são deduplicadas entre si');

const mixedGasCulture=P.triageConservative(`HEMOCULTURA: ausência de crescimento
GASOMETRIA ARTERIAL
DATA DA COLETA: 18/08/2026
MATERIAL: Sangue Arterial
pH: 7,440`);
check(mixedGasCulture.accepted.length===1&&mixedGasCulture.notices.some(n=>n.code==='culture')&&mixedGasCulture.kind==='mixed', 'cultura fica manual sem bloquear gasometria do mesmo documento');

const gasAliasOutside=P.triageConservative(`DATA DA COLETA: 18/08/2026
POZ: 87,0 mmiÃg`);
check(gasAliasOutside.accepted.length===0&&gasAliasOutside.blocked.some(r=>r.key==='po2'), 'alias OCR POZ fora de seção de gasometria permanece bloqueado');

const gasSectionReset=P.parseLabText(`Controllab
GASOMETRIA ARTERIAL
DATA DA COLETA: 18/08/2026
pE: 7,440
CONTROLE DE QUALIDADE
PACIENTE: TESTE
BIOQUÍMICA
pE: 7,111`);
const resetPh=gasSectionReset.results.filter(r=>r.exam_name_normalized==='ph');
check(resetPh.length===1&&resetPh[0].value_numeric===7.44, 'alias pE → pH termina no cabeçalho da página seguinte');
check(resetPh[0]&&resetPh[0].exam_name_original==='pH', 'perfil hospitalar armazena nome canônico de sigla com dígito');

check(P.documentNotices('BIÓPSIA — anatomopatológico').some(n=>n.code==='pathology'), 'anatomopatológico é identificado como manual');
check(!P.documentNotices('GASOMETRIA ARTERIAL').some(n=>n.code==='other_lab'), 'gasometria não é mais classificada fora do quadro');
const pendingNotices=P.documentNotices('LISTA DE EXAMES PENDENTES\nEAS URINA TIPO 1\nGRAM, BACTERIOSCOPIA\nÁCIDO LÁTICO - LACTATO\nPREVISÃO DE ENTREGA 14/08/2026');
check(pendingNotices.some(n=>n.code==='pending'), 'exame pendente é avisado sem inventar resultado');
check(!pendingNotices.some(n=>n.code==='other_lab'), 'EAS/Gram apenas pendentes não geram aviso duplicado de exame fora do quadro');

const extendedPanels=P.triageConservative(`Controllab
DATA COLETA: 16/08/2026
COAGULOGRAMA COMPLETO
TEMPO DE PROTROMBINA
Plasma Controle do Dia: 13,5 segundos
Plasma Examinado: 13,5 segundos
RNI: 1,00
TEMPO DE TROMBOPLASTINA PARCIAL ATIVADO
Plasma Controle do Dia: 30,0 segundos
Plasma Examinado: 30,0 segundos
BILIRRUBINA TOTAL E FRAÇÕES
DATA DA COLETA: 16/08/2026
RESULTADO:
TOTAL: 0,56 mg/dL
DIRETA: 0,19 mg/dL
INDIRETA: 0,37 mg/dL
VALORES DE REFERÊNCIA:
BILIRRUBINA TOTAL
Adultos: 0,2 a 1,2 mg/dL
DIRETA: Inferior a 0,5 mg/dL
INDIRETA: Menor que 0,9 mg/dL
TROPONINA CARDÍACA-I
DATA COLETA: 16/08/2026
RESULTADO: NEGATIVA`);
const ep={};extendedPanels.accepted.forEach(r=>ep[r.exam_name_normalized]=r);
[['tp',13.5],['inr',1],['ttpa',30],['bilirrubina_total',0.56],['bilirrubina_direta',0.19],['bilirrubina_indireta',0.37]].forEach(([k,v])=>check(ep[k]&&ep[k].value_numeric===v&&(ep[k].collection_dateISO||'').slice(0,10)==='2026-08-16',k+' preserva valor e data da seção'));
check(ep.troponina_i&&ep.troponina_i.value_type==='qualitative'&&P.norm(ep.troponina_i.value_text)==='negativa','troponina qualitativa conhecida entra como negativa');

const fixtureExpected={laudo1_transcrito:26,laudo2_transcrito:29,laudo3_transcrito:29};
Object.keys(fixtureExpected).forEach(name=>{
  const fixture=path.join(fixtureDir,name+'.txt');
  if(!fs.existsSync(fixture)){
    console.log('  [local] '+name+' não disponível neste clone; validação confidencial ignorada');
    return;
  }
  const text=fs.readFileSync(fixture,'utf8');
  const report=P.triageConservative(text);
  check(report.accepted.length===fixtureExpected[name]&&!report.needsDate, name+' importa todos os exames conhecidos com data (veio '+report.accepted.length+': '+report.accepted.map(r=>r.exam_name_normalized).join(', ')+')');
});
const cultureFixturePath=path.join(fixtureDir,'culturas.md');
if(fs.existsSync(cultureFixturePath)){
  const cultureFixture=P.triageConservative(fs.readFileSync(cultureFixturePath,'utf8'));
  check(cultureFixture.accepted.length===0&&cultureFixture.notices.some(n=>n.code==='culture'), 'fixture de culturas é somente manual');
}else console.log('  [local] culturas.md não disponível neste clone; validação confidencial ignorada');

console.log(`\n== RESULTADO: ${passes} ok, ${fails} falhas ==`);
process.exit(fails>0 ? 1 : 0);
