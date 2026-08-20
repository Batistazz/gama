/* =========================================================================
   FOLHÃO LAGOA SANTA — parser.js
   Parser determinístico de laudo (texto colado ou texto extraído de PDF).
   Sem IA. Módulo puro e testável (roda no navegador e no Node).
   Princípio: nunca chutar. Na dúvida, marca confiança 'warn'.
   ========================================================================= */
(function (root) {
  'use strict';

  /* ---------- utilidades ---------- */
  function stripAccents(s){ return (s||'').normalize('NFD').replace(/[̀-ͯ]/g,''); }
  function norm(s){ return stripAccents(String(s||'').toLowerCase()); }

  // Número no padrão BR: vírgula decimal, ponto de milhar.
  function parseNumBR(s){
    if(s==null) return null;
    s = String(s).trim();
    if(/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g,'').replace(',','.'); // 188.000 / 1.234,5
    else if(/^\d+,\d+$/.test(s)) s = s.replace(',','.');                                // 10,8
    else if(/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g,'');                      // 13.200
    const n = parseFloat(s.replace(',','.'));
    return isNaN(n) ? null : n;
  }

  /* ---------- catálogo de exames (tabela de apelidos editável, semeada) ----------
     ref = faixa de referência adulto (PADRÃO, editável — não é do seu serviço).
     plaus = faixa fisiológica ampla; fora dela → 'warn' (provável erro de extração). */
  var CATALOG = [
    // Hemograma
    {key:'hemoglobina',label:'Hemoglobina',grupo:'Hemograma',unit:'g/dL',dec:1,ref:[12,17],plaus:[2,25],aliases:['hemoglobina','hemoglob','hb','hgb']},
    {key:'hematocrito',label:'Hematócrito',grupo:'Hemograma',unit:'%',dec:1,ref:[36,52],plaus:[6,75],aliases:['hematocrito','ht','hct']},
    {key:'hemacias',label:'Hemácias',grupo:'Hemograma',unit:'milhões/mm³',dec:2,ref:[4.0,6.0],plaus:[1,8],aliases:['hemacias','eritrocitos','rbc']},
    {key:'vcm',label:'VCM',grupo:'Hemograma',unit:'fL',dec:1,ref:[80,100],plaus:[50,140],aliases:['vcm','mcv']},
    {key:'hcm',label:'HCM',grupo:'Hemograma',unit:'pg',dec:1,ref:[27,32],plaus:[15,45],aliases:['hcm','mch']},
    {key:'chcm',label:'CHCM',grupo:'Hemograma',unit:'g/dL',dec:1,ref:[32,36],plaus:[25,40],aliases:['chcm','mchc']},
    {key:'rdw',label:'RDW',grupo:'Hemograma',unit:'%',dec:1,ref:[11.5,14.5],plaus:[8,30],aliases:['rdw']},
    {key:'leucocitos',label:'Leucócitos',grupo:'Hemograma',unit:'/mm³',dec:0,ref:[4000,11000],plaus:[100,200000],aliases:['leucocitos','leucograma','leuco','wbc','globulos brancos']},
    {key:'neutrofilos',label:'Neutrófilos',grupo:'Hemograma',unit:'/mm³',dec:0,ref:[1800,7000],plaus:[0,180000],aliases:['neutrofilos','segmentados','neutro']},
    {key:'bastoes',label:'Bastões',grupo:'Hemograma',unit:'%',dec:0,ref:[0,5],plaus:[0,60],aliases:['bastoes','bastonetes','bast']},
    {key:'linfocitos',label:'Linfócitos',grupo:'Hemograma',unit:'/mm³',dec:0,ref:[1000,4000],plaus:[0,90000],aliases:['linfocitos','linfo','lymph']},
    {key:'monocitos',label:'Monócitos',grupo:'Hemograma',unit:'/mm³',dec:0,ref:[200,1000],plaus:[0,40000],aliases:['monocitos','mono']},
    {key:'eosinofilos',label:'Eosinófilos',grupo:'Hemograma',unit:'/mm³',dec:0,ref:[0,500],plaus:[0,40000],aliases:['eosinofilos','eosino','eos']},
    {key:'basofilos',label:'Basófilos',grupo:'Hemograma',unit:'/mm³',dec:0,ref:[0,200],plaus:[0,10000],aliases:['basofilos','baso']},
    {key:'plaquetas',label:'Plaquetas',grupo:'Hemograma',unit:'/mm³',dec:0,ref:[150000,450000],plaus:[1000,2000000],aliases:['plaquetas','plaqueta','plt','plaq']},
    // Função renal
    {key:'creatinina',label:'Creatinina',grupo:'Função renal',unit:'mg/dL',dec:2,ref:[0.6,1.3],plaus:[0.1,30],aliases:['creatinina','creat','crea','cr']},
    {key:'ureia',label:'Ureia',grupo:'Função renal',unit:'mg/dL',dec:0,ref:[15,45],plaus:[2,400],aliases:['ureia','ur']},
    // Eletrólitos
    {key:'sodio',label:'Sódio',grupo:'Eletrólitos',unit:'mEq/L',dec:0,ref:[135,145],plaus:[90,190],aliases:['sodio','natremia','na']},
    {key:'potassio',label:'Potássio',grupo:'Eletrólitos',unit:'mEq/L',dec:1,ref:[3.5,5.1],plaus:[1,9],aliases:['potassio','calemia','k']},
    {key:'calcio',label:'Cálcio',grupo:'Eletrólitos',unit:'mg/dL',dec:1,ref:[8.5,10.5],plaus:[3,18],aliases:['calcio total','calcio','ca']},
    {key:'magnesio',label:'Magnésio',grupo:'Eletrólitos',unit:'mg/dL',dec:1,ref:[1.6,2.6],plaus:[0.5,6],aliases:['magnesio','mg']},
    {key:'fosforo',label:'Fósforo',grupo:'Eletrólitos',unit:'mg/dL',dec:1,ref:[2.5,4.5],plaus:[0.5,12],aliases:['fosforo','fosfato','p']},
    {key:'cloro',label:'Cloro',grupo:'Eletrólitos',unit:'mEq/L',dec:0,ref:[98,107],plaus:[70,140],aliases:['cloro','cloreto','cl']},
    // Inflamatórios
    {key:'pcr',label:'PCR',grupo:'Inflamatórios',unit:'mg/L',dec:1,ref:[0,5],plaus:[0,600],aliases:['proteina c reativa','pcr']},
    {key:'vhs',label:'VHS',grupo:'Inflamatórios',unit:'mm/h',dec:0,ref:[0,20],plaus:[0,150],aliases:['vhs','hemossedimentacao','esr']},
    {key:'procalcitonina',label:'Procalcitonina',grupo:'Inflamatórios',unit:'ng/mL',dec:2,ref:[0,0.5],plaus:[0,100],aliases:['procalcitonina','pct']},
    // Hepático
    {key:'ast',label:'AST/TGO',grupo:'Hepático',unit:'U/L',dec:0,ref:[0,40],plaus:[2,10000],aliases:['aspartato','tgo','ast']},
    {key:'alt',label:'ALT/TGP',grupo:'Hepático',unit:'U/L',dec:0,ref:[0,41],plaus:[2,10000],aliases:['alanina','tgp','alt']},
    {key:'fosfatase_alcalina',label:'Fosfatase alcalina',grupo:'Hepático',unit:'U/L',dec:0,ref:[40,129],plaus:[10,2000],aliases:['fosfatase alcalina','fal','alp']},
    {key:'ggt',label:'GGT',grupo:'Hepático',unit:'U/L',dec:0,ref:[8,61],plaus:[2,3000],aliases:['gama gt','gama-gt','glutamil','ggt']},
    {key:'bilirrubina_total',label:'Bilirrubina total',grupo:'Hepático',unit:'mg/dL',dec:2,ref:[0.2,1.2],plaus:[0,60],aliases:['bilirrubina total','bilirrubinas totais','bt']},
    {key:'bilirrubina_direta',label:'Bilirrubina direta',grupo:'Hepático',unit:'mg/dL',dec:2,ref:[0,0.3],plaus:[0,40],aliases:['bilirrubina direta','bd']},
    {key:'bilirrubina_indireta',label:'Bilirrubina indireta',grupo:'Hepático',unit:'mg/dL',dec:2,ref:[0,0.9],plaus:[0,40],aliases:['bilirrubina indireta','bi']},
    {key:'albumina',label:'Albumina',grupo:'Hepático',unit:'g/dL',dec:1,ref:[3.5,5.2],plaus:[0.5,7],aliases:['albumina','alb']},
    {key:'proteinas_totais',label:'Proteínas totais',grupo:'Hepático',unit:'g/dL',dec:1,ref:[6,8],plaus:[2,12],aliases:['proteinas totais','ptn totais']},
    // Coagulação
    {key:'inr',label:'INR/RNI',grupo:'Coagulação',unit:'',dec:2,ref:[0.9,1.2],plaus:[0.5,12],aliases:['razao normalizada','inr','rni']},
    {key:'tp',label:'TP (protrombina)',grupo:'Coagulação',unit:'s',dec:1,ref:[10,13],plaus:[5,120],aliases:['tempo de protrombina','protrombina','tap','tp']},
    {key:'ttpa',label:'TTPa',grupo:'Coagulação',unit:'s',dec:1,ref:[25,37],plaus:[15,200],aliases:['tempo de tromboplastina','ttpa','aptt','ptt']},
    {key:'fibrinogenio',label:'Fibrinogênio',grupo:'Coagulação',unit:'mg/dL',dec:0,ref:[200,400],plaus:[30,1200],aliases:['fibrinogenio']},
  ];

  var FIXED_PANEL = ['hemoglobina','hematocrito','leucocitos','bastoes','plaquetas','ureia','creatinina','sodio','potassio','calcio','magnesio','fosforo','pcr'];
  var GRUPOS = ['Hemograma','Função renal','Eletrólitos','Inflamatórios','Hepático','Coagulação','Outros'];

  // índice de apelidos: {alias, key, isWord}
  var ALIAS_INDEX = [];
  CATALOG.forEach(function(c){
    c.aliases.forEach(function(a){
      var an = norm(a);
      ALIAS_INDEX.push({alias:an, key:c.key, isWord:(an.length>=3 || an.indexOf(' ')>=0)});
    });
  });
  ALIAS_INDEX.sort(function(a,b){ return b.alias.length - a.alias.length; }); // mais longo primeiro

  var UNITS = ['mg/dl','g/dl','meq/l','mmol/l','ng/ml','u/l','mm/h','mmhg','/mm3','mil/mm3','10^3/ul','x10^3/ul','x10^6/ul','fl','pg','mg/l','%','s'];

  function catByKey(k){ return CATALOG.find(function(c){return c.key===k;}); }
  function escRe(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

  /* ---------- detecção de linhas ---------- */
  function isReferenceLine(ln){ return /refer[eê]nc|valor(es)? de ref|\bvr\b|v\.r\b|intervalo de ref/.test(ln); }
  // linha que COMEÇA com rótulo de referência → é referência (não exame), mesmo que cite um exame depois
  function isReferenceHeader(ln){ return /^\s*(valor(es)? de refer|refer[eê]ncia\b|vr[:.\s]|v\.?\s?r\.?[:.\s]|intervalo de refer)/.test(ln); }
  function isNoiseLine(ln){ return /m[eé]todo|material|respons[aá]vel|\bcr[bm]m\b|crbm|conselho|assinatura|laborat[oó]rio|hospital|paciente|solicitante|conv[eê]nio|atendimento|\bcpf\b|\bc\.i\b|idade|sexo|libera[cç][aã]o|p[aá]gina|rodap[eé]|observa[cç]|coleta|data\b|hor[aá]rio|hora\b|\bnegro\b|filtra[cç][aã]o glomerular|ckd-?epi/.test(ln); }

  // Acha a âncora de exame na linha; retorna {key, isWord, matchText} ou null.
  // Regra anti-erro: sigla curta (Na, K, Cr, Mg...) só é exame se aparecer ANTES
  // do primeiro número (rótulo precede valor) e não for parte de unidade (mg/dL).
  function findAnchor(l){
    var ln = norm(l);
    var firstDigit = ln.search(/[0-9]/);
    for(var i=0;i<ALIAS_INDEX.length;i++){
      var a = ALIAS_INDEX[i];
      var re = new RegExp('(^|[^a-z0-9])'+escRe(a.alias)+'([^a-z0-9]|$)','g');
      var m;
      while((m = re.exec(ln))!==null){
        var pos = m.index + m[1].length;
        var after = ln.charAt(pos + a.alias.length);
        if(a.isWord){
          return {key:a.key, isWord:true, matchText:a.alias};
        } else {
          if(firstDigit !== -1 && pos < firstDigit && after !== '/')
            return {key:a.key, isWord:false, matchText:a.alias};
        }
        if(re.lastIndex === m.index) re.lastIndex++;   // evita loop infinito
      }
    }
    return null;
  }

  var QUALITATIVOS = ['nao reagente','não reagente','nao detectado','não detectado','indetectavel','indetectável','incontaveis','incontáveis','reagente','detectado','negativo','positivo','ausente','presente'];

  // Extrai valor de uma linha. Retorna {value_type,value_numeric,value_text,unit,reference} ou null.
  function extractValue(l){
    var ln = norm(l);
    // referência inline entre parênteses/colchetes (guarda antes de tirar)
    var reference = null;
    var mref = l.match(/[\(\[]\s*(-?\d[\d.]*(?:,\d+)?)\s*(?:[-a–]|at[eé])\s*(-?\d[\d.]*(?:,\d+)?)\s*[\)\]]/);
    if(mref){ reference = [parseNumBR(mref[1]), parseNumBR(mref[2])]; }
    // parte "valor": remove parentéticos pra não pegar a referência como valor
    var valuePart = l.replace(/\([^)]*\)/g,' ').replace(/\[[^\]]*\]/g,' ');
    var vpn = norm(valuePart);

    // censurado (<0,1 / >100)
    var mc = valuePart.match(/([<>])\s*=?\s*(\d[\d.]*(?:,\d+)?)/);
    if(mc){
      return {value_type: (mc[1]==='<'?'less_than':'greater_than'),
              value_numeric: parseNumBR(mc[2]), value_text: mc[1]+mc[2].replace(/\s/g,''),
              unit: findUnit(valuePart), reference: reference};
    }
    // diferencial de leucócitos: "79,0 % 12395 /mm³" → usa o ABSOLUTO (/mm³), não a porcentagem
    var mdiff = valuePart.match(/\d[\d.]*(?:,\d+)?\s*%\s+(\d[\d.]*(?:,\d+)?)\s*\/?\s*mm/i);
    if(mdiff){
      return {value_type:'numeric', value_numeric: parseNumBR(mdiff[1]), value_text: mdiff[1], unit:'/mm3', reference: reference};
    }
    // numérico
    var mn = valuePart.match(/-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+,\d+|-?\d+\.\d+|-?\d+/);
    if(mn){
      return {value_type:'numeric', value_numeric: parseNumBR(mn[0]), value_text: mn[0],
              unit: findUnit(valuePart), reference: reference};
    }
    // qualitativo (só se não houver número)
    for(var i=0;i<QUALITATIVOS.length;i++){
      if(vpn.indexOf(norm(QUALITATIVOS[i]))>=0)
        return {value_type:'qualitative', value_numeric:null, value_text:QUALITATIVOS[i], unit:null, reference:reference};
    }
    return null;
  }

  function findUnit(l){
    var ln = norm(l).replace(/³/g,'3').replace(/²/g,'2').replace(/[µμ]/g,'u');
    var d = ln.search(/\d/); if(d>0) ln = ln.slice(d);   // ignora o NOME do exame (antes do 1º número) → não pega o "s" de "plaquetas"
    ln = ln.replace(/\s+/g,'');
    for(var i=0;i<UNITS.length;i++){ if(ln.indexOf(UNITS[i].replace(/\s+/g,''))>=0) return UNITS[i]; }
    return null;
  }

  // Exame FORA do catálogo (atípico): linha "Rótulo: valor [unidade]" que não é ruído nem
  // referência e não casou âncora. Retorna {label,val} ou null. Nunca inventa a partir de ruído.
  // "Resultado/Valor" são portadores do valor do exame-cabeçalho anterior, não exame novo.
  var CARRIER_RE = /^(resultado|resultados|valor|valores|dosagem|concentra|nivel|niveis)\b/;
  function genericExam(l){
    var ln = norm(l);
    if(isNoiseLine(ln) || isReferenceLine(ln)) return null;
    var m = l.match(/^\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9()\/\-\s]{1,40}?)(?:\s*[:._–-]+\s*|\s{2,}|\t+)([<>]?\s*=?\s*-?\d[\d.,]*.*)$/);
    if(!m) return null;
    if(/^\s*\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}/.test(m[2])) return null;   // valor é data → não é exame
    if(/^\s*[<>]?\s*=?\s*-?\d[\d.,]*\s*(?:a|at[eé]|[-–])\s+/i.test(m[2])) return null;   // valor é FAIXA (referência)
    var label = m[1].replace(/[\s._:–-]+$/,'').trim();
    if(!/[a-zà-ÿ]{3,}/i.test(label)) return null;
    var val = extractValue(m[2]);
    if(!val || (val.value_type!=='numeric' && val.value_type!=='less_than' && val.value_type!=='greater_than')) return null;
    // inteiro grande SEM unidade = nº de atendimento/registro/CPF (ou nome + nº), não exame
    if(val.value_type==='numeric' && !val.unit && Number.isInteger(val.value_numeric) && Math.abs(val.value_numeric)>=1000) return null;
    return { label: label, val: val };
  }

  // Detecta uma data (dd/mm/aaaa [hh:mm]) no texto. Prioriza "coleta".
  function detectDate(text){
    var coleta = text.match(/coleta[^0-9]{0,15}(\d{2})\/(\d{2})\/(\d{2,4})(?:[^0-9]{0,6}(\d{2}):(\d{2}))?/i);
    var m = coleta || text.match(/(\d{2})\/(\d{2})\/(\d{2,4})(?:[^0-9]{0,6}(\d{2}):(\d{2}))?/);
    if(!m) return null;
    var y = m[3].length===2 ? '20'+m[3] : m[3];
    var hh = m[4]||'08', mi = m[5]||'00';
    var d = new Date(+y, +m[2]-1, +m[1], +hh, +mi);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  /* ---------- cabeçalho do paciente (colar do prontuário → preencher cadastro) ----------
     Determinístico, rótulo-a-rótulo. Só devolve o que reconhece; nunca chuta.
     Datas viram 'YYYY-MM-DD' (pronto p/ <input type=date>); sexo vira 'M'/'F'. */
  function pivotYear(yy){ yy=+yy; var cur=new Date().getFullYear()%100; return (yy<=cur ? 2000+yy : 1900+yy); }
  function toISODate(s){
    var m=String(s||'').match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if(!m) return null;
    var y = m[3].length<=2 ? pivotYear(m[3]) : +m[3];
    var mo=+m[2], da=+m[1];
    if(mo<1||mo>12||da<1||da>31) return null;
    return y+'-'+String(mo).padStart(2,'0')+'-'+String(da).padStart(2,'0');
  }
  function grabField(text, labelRe){
    var re=new RegExp('(?:^|\\n)[ \\t]*(?:'+labelRe+')(?:[ \\t]*[:\\-–][ \\t]*|[ \\t]+)([^\\n]+)','i');
    var m=text.match(re);
    return m ? m[1].trim() : null;
  }
  function firstCol(s){ return String(s||'').split(/\s{2,}|\t/)[0].replace(/[\s.;,\-]+$/,'').trim(); }
  function parsePatientInfo(text){
    text=String(text||'');
    var out={};
    var name=grabField(text,'nome\\s+do\\s+paciente|nome\\s+completo|paciente|nome');
    if(name){ name=firstCol(name); if(name) out.name=name; }
    var sexv=grabField(text,'sexo|g[eê]nero');
    if(sexv){ if(/masc/i.test(sexv)||/^\s*m\b/i.test(sexv)) out.sex='M'; else if(/femin/i.test(sexv)||/^\s*f\b/i.test(sexv)) out.sex='F'; }
    var birth=grabField(text,'data\\s+de\\s+nascimento|nascimento|nasc\\.?|d\\.?\\s?n\\.?');
    if(birth){ var bi=toISODate(birth); if(bi) out.birth_date=bi; }
    var adm=grabField(text,'data\\s+de\\s+interna[çc][ãa]o|data\\s+de\\s+admiss[ãa]o|data\\s+de\\s+entrada|interna[çc][ãa]o|admiss[ãa]o|entrada');
    if(adm){ var ai=toISODate(adm); if(ai) out.admission_date=ai; }
    var bed=grabField(text,'leito|cama');
    if(bed){ bed=firstCol(bed); if(bed) out.bed=bed; }
    var unit=grabField(text,'unidade|setor|cl[íi]nica|ala|enfermaria|servi[çc]o|especialidade');
    if(unit){ unit=firstCol(unit); if(unit) out.unit=unit; }
    var age=grabField(text,'idade');
    if(age){ var am=age.match(/\d{1,3}/); if(am) out.age=+am[0]; }
    return out;
  }

  /* ---------- microbiologia: cultura + antibiograma (evento, NÃO vai na grade) ----------
     Determinístico. Estrutura o que reconhece (material, germe, UFC, S/I/R); resto marca warn. */
  var GENERA=['escherichia coli','klebsiella pneumoniae','klebsiella oxytoca','klebsiella','proteus mirabilis','proteus','pseudomonas aeruginosa','pseudomonas','enterococcus faecalis','enterococcus faecium','enterococcus','staphylococcus aureus','staphylococcus saprophyticus','staphylococcus epidermidis','staphylococcus coagulase negativa','staphylococcus','streptococcus agalactiae','streptococcus','enterobacter cloacae','enterobacter','serratia marcescens','serratia','acinetobacter baumannii','acinetobacter','morganella morganii','morganella','citrobacter freundii','citrobacter','providencia','candida albicans','candida','staphylococcus haemolyticus'];
  function abResult(w){ w=norm(w); if(/^sensivel/.test(w)||w==='s')return'S'; if(/^intermediari/.test(w)||w==='i')return'I'; if(/^resistente/.test(w)||w==='r')return'R'; return null; }
  function extractAntibiogram(text){
    var lines=String(text||'').split(/\r?\n/);
    var hdrIdx=text.search(/antibiograma|antimicrobiano|perfil de sensibilidade|teste de sensibilidade/i);
    var begin=0, onlyWords=(hdrIdx===-1);
    if(hdrIdx!==-1) begin=text.slice(0,hdrIdx).split(/\r?\n/).length-1;
    var out=[], seen={};
    for(var i=begin;i<lines.length;i++){
      var ln=lines[i].trim(); if(!ln) continue;
      if(/^(antibi[oó]tico|antimicrobiano|resultado|interpreta|cim|mic|amostra|material)\b/i.test(ln) && !/(sens|resist|intermed)/i.test(ln)) continue;
      var m=ln.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9()\/+\-\s]{2,40}?)[\s.:_]+(?:(?:cim|mic)?\s*[<>=≤≥]*\s*[\d.,]+\s+)?(sens[íi]vel|intermedi[áa]rio|resistente|[SIR])\s*$/i);
      if(!m) continue;
      if(onlyWords && /^[sir]$/i.test(m[2])) continue;
      var res=abResult(m[2]); if(!res) continue;
      var name=m[1].replace(/[\s._:\-]+$/,'').trim(); if(name.length<3) continue;
      var k=norm(name); if(seen[k]) continue; seen[k]=1;
      out.push({antibiotic:name, result:res});
    }
    return out;
  }
  function detectKind(text){
    var t=norm(text);
    if(/urocultura|hemocultura|coprocultura|antibiograma|antimicrobiano|\bufc\b|unidades formadoras/.test(t)) return 'culture';
    // imagem = precisa de uma MODALIDADE de fato (não confundir com "IMPRESSÃO:" de data de laudo)
    if(/tomografia|radiograf|ultrassonograf|ultra-?som|\busg\b|ressonancia magnetica|resson[âa]ncia|densitometria|mamografia|ecocardiograma|\bdoppler\b|cintilografia|angiotomografia|colonoscopia|\bendoscopia\b|\braio-?\s?x\b/.test(t)) return 'imaging';
    return 'lab';
  }
  function parseCulture(text){
    text=String(text||''); var t=norm(text);
    var out={kind:'culture', dateISO:detectDate(text), title:'Cultura', material:null, growth:null, organism:null, cfu:null, antibiogram:[], source_text:text.trim()};
    if(/urocultura/.test(t)) out.title='Urocultura';
    else if(/hemocultura/.test(t)) out.title='Hemocultura';
    else if(/coprocultura/.test(t)) out.title='Coprocultura';
    else { var mt=text.match(/cultura\s+de\s+([a-zà-ÿ\/ ]{3,30})/i); if(mt) out.title='Cultura de '+mt[1].trim(); }
    var mat=grabField(text,'material|esp[ée]cime|esp[ée]cimen|amostra');
    if(mat) out.material=firstCol(mat);
    else if(out.title==='Urocultura') out.material='urina';
    else if(out.title==='Hemocultura') out.material='sangue';
    else if(out.title==='Coprocultura') out.material='fezes';
    var mc=text.match(/[<>≥≤]?\s*\d[\d.]*(?:\s*x\s*10\^?\d+)?\s*ufc\s*\/?\s*m?l/i);
    if(mc) out.cfu=mc[0].replace(/\s+/g,' ').trim();
    // negativo específico — NÃO confundir com "Gram negativo" (que descreve o germe)
    if(/aus[eê]ncia de crescimento|sem crescimento|cultura negativa|nao houve crescimento|resultado\s*:?\s*negativ/.test(t)) out.growth='negativo';
    var org=grabField(text,'microrganismo isolado|micro-?organismo isolado|germe isolado|agente isolado|bact[ée]ria isolada|microrganismo|micro-?organismo|germe|agente etiol[óo]gico|identifica[çc][ãa]o');
    if(org){ org=firstCol(org); if(org && !/negativ|aus[eê]ncia|nao houve/i.test(org)) out.organism=org; }
    if(!out.organism){ for(var i=0;i<GENERA.length;i++){ var re=new RegExp('\\b'+GENERA[i].replace(/ /g,'\\s+')+'\\b','i'); var mm=text.match(re); if(mm){ out.organism=mm[0].replace(/\s+/g,' '); break; } } }
    out.antibiogram=extractAntibiogram(text);
    if(out.organism && out.growth!=='negativo') out.growth='positivo';
    if((out.cfu||out.antibiogram.length) && !out.growth) out.growth='positivo';
    var mot=[];
    if(!out.growth) mot.push('resultado indefinido');
    if(out.growth==='positivo' && !out.organism) mot.push('sem germe identificado');
    if(out.growth==='positivo' && !out.antibiogram.length) mot.push('sem antibiograma');
    out.confidence=mot.length?'warn':'ok'; out.confidence_reason=mot.join('; ');
    return out;
  }

  /* ---------- pipeline principal ---------- */
  function parseLabText(text){
    var lines = String(text||'').split(/\r?\n/).map(function(s){return s.replace(/\s+/g,' ').trim();}).filter(Boolean);
    var results = [];
    var current = null; // {result, hasValue}

    function finalizeConfidence(r){
      var c = catByKey(r.exam_name_normalized);
      var conf = 'ok', motivos = [];
      if(!c){ conf='warn'; motivos.push('exame fora do catálogo — confira'); }
      if(r.matched_symbol_only){ conf='warn'; motivos.push('reconhecido só por sigla'); }
      if(r.value_type==='numeric'){
        if(c && c.unit && !r.unit){ conf='warn'; motivos.push('sem unidade'); }   // só cobra unidade de exame que tem unidade (INR não tem)
        if(c && (r.value_numeric < c.plaus[0] || r.value_numeric > c.plaus[1])){ conf='warn'; motivos.push('valor fora da faixa fisiológica'); }
      }
      if(r.reference_min!=null && r.reference_max!=null && r.reference_min > r.reference_max){ conf='warn'; motivos.push('referência invertida'); r.reference_min=r.reference_max=null; }
      r.confidence = conf; r.confidence_reason = motivos.join('; ');
    }

    for(var i=0;i<lines.length;i++){
      var l = lines[i], ln = norm(l);

      // linha de REFERÊNCIA (começa com "Valor de referência"/"VR"…) → aplica ao exame anterior, nunca vira exame
      if(isReferenceHeader(ln)){
        if(current && current.result){
          var mr = l.match(/(-?\d[\d.]*(?:,\d+)?)\s*(?:[-a–]|at[eé])\s*(-?\d[\d.]*(?:,\d+)?)/);
          if(mr){ current.result.reference_min = parseNumBR(mr[1]); current.result.reference_max = parseNumBR(mr[2]); }
        }
        continue;
      }

      var anchor = findAnchor(l);
      var val = extractValue(l);

      if(anchor){
        var cat = catByKey(anchor.key);
        var base = {
          exam_name_original: l.split(/(?=[<>]?\s*-?\d)/)[0].replace(/[.·:]+\s*$/,'').trim() || cat.label,
          exam_name_normalized: anchor.key,
          category:'laboratory',
          value_type:null, value_numeric:null, value_text:null, unit:null,
          reference_min:null, reference_max:null, reference_text:null,
          matched_symbol_only: !anchor.isWord,
          source_text: l
        };
        if(val){
          applyVal(base, val);
          if(base.reference_min==null){   // referência na MESMA linha do exame ("... VR 12,0-16,0")
            var mri = l.match(/(?:vr|v\.?\s?r\.?|refer[eê]ncia|valor(?:es)? de ref[^:]*)[:\s]*\(?\s*(-?\d[\d.]*(?:,\d+)?)\s*(?:[-a–]|at[eé])\s*(-?\d[\d.]*(?:,\d+)?)/i);
            if(mri){ base.reference_min = parseNumBR(mri[1]); base.reference_max = parseNumBR(mri[2]); }
          }
          results.push(base); finalizeConfidence(base);
          current = {result: base, hasValue:true};
        } else {
          current = {result: base, hasValue:false};
        }
      } else {
        var g = genericExam(l);
        var carrier = g && CARRIER_RE.test(norm(g.label));
        if(g && !carrier){
          // exame fora do catálogo (atípico) → grupo "Outros", entra warn/amarelo
          var gkey = norm(g.label).replace(/\s+/g,'_');
          var gbase = {
            exam_name_original: g.label, exam_name_normalized: gkey, category:'laboratory',
            value_type:null, value_numeric:null, value_text:null, unit:null,
            reference_min:null, reference_max:null, reference_text:null,
            matched_symbol_only:false, is_generic:true, source_text: l
          };
          applyVal(gbase, g.val); results.push(gbase); finalizeConfidence(gbase);
          current = {result: gbase, hasValue:true};
        } else if(current && !current.hasValue && val && !isNoiseLine(ln)){
          // valor do exame-cabeçalho anterior (ex.: "RESULTADO: 0,98") — mas NUNCA de uma linha de ruído (data/coleta)
          current.result.source_text += ' | ' + l;
          applyVal(current.result, val); results.push(current.result); finalizeConfidence(current.result);
          current.hasValue = true;
        }
        // senão: ruído / valor órfão → ignorado (não inventa exame)
      }
    }

    return { results: results, dateISO: detectDate(text) };

    function applyVal(r, val){
      r.value_type = val.value_type;
      r.value_numeric = val.value_numeric;
      r.value_text = val.value_text;
      if(val.unit) r.unit = val.unit;
      if(!r.unit){ var c = catByKey(r.exam_name_normalized); if(c && c.unit) r.unit_expected = c.unit; }
      if(val.reference){ r.reference_min = val.reference[0]; r.reference_max = val.reference[1]; }
    }
  }

  /* ---------- API pública ---------- */
  var API = {
    parseLabText: parseLabText,
    parsePatientInfo: parsePatientInfo,
    detectKind: detectKind,
    parseCulture: parseCulture,
    detectDate: detectDate,
    parseNumBR: parseNumBR,
    norm: norm,
    CATALOG: CATALOG,
    FIXED_PANEL: FIXED_PANEL,
    GRUPOS: GRUPOS,
    catByKey: catByKey
  };
  root.Parser = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis);
