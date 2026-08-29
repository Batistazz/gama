/* Teste de regressão do parser. Roda: node test_parser.js  */
const P = require('./parser.js');

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

console.log(`\n== RESULTADO: ${passes} ok, ${fails} falhas ==`);
process.exit(fails>0 ? 1 : 0);
