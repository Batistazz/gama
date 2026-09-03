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
  function editDistance(a,b){
    a=String(a||''); b=String(b||'');
    var prev=[],cur=[],i,j;
    for(j=0;j<=b.length;j++) prev[j]=j;
    for(i=1;i<=a.length;i++){
      cur[0]=i;
      for(j=1;j<=b.length;j++) cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
      prev=cur; cur=[];
    }
    return prev[b.length];
  }
  function assessHospitalLabText(text){
    var t=norm(text), tokens=t.match(/[a-z0-9]{7,12}/g)||[];
    // O logotipo é uma região especialmente sujeita a OCR. Aceitamos até
    // duas trocas/omissões em "Controllab", mas nunca usamos só o logotipo:
    // o restante do formulário também precisa fornecer evidência estrutural.
    var brand=tokens.some(function(x){return editDistance(x,'controllab')<=2;});
    var evidence={
      quality:/controle de qualidade/.test(t),
      address:/rua maria gertrudes/.test(t),
      hospital:/santa casa/.test(t),
      panel:/hemograma completo|gasometria (?:arterial|venosa)|coagulograma/.test(t),
      collection:/data da coleta|coleta\s*:/.test(t),
      resultReference:/resultado[\s\S]{0,900}valor(?:es)? de referencia/.test(t),
      method:/citometria de fluxo|imuno-?turbidimetria/.test(t)
    };
    var structural=Object.keys(evidence).filter(function(k){return evidence[k];});
    var accepted=(brand&&structural.length>=1)
      ||(evidence.address&&evidence.panel&&evidence.collection)
      ||(evidence.quality&&evidence.panel&&evidence.collection&&(evidence.hospital||evidence.method||evidence.address));
    return {
      accepted:accepted,
      confidence:accepted?(brand?'confirmed':'probable'):'none',
      brandMatched:brand,
      evidence:structural
    };
  }
  function isHospitalLabText(text){ return assessHospitalLabText(text).accepted; }

  // Limpa o "pontilhado" (leaders "..........:") que o OCR transforma em INTEIRO-LIXO grudado
  // no rótulo/valor (ex.: "HEMÁCIAS...ci221022022..1 3,95" ou "PLAQUETAS. ...12220020222..1 216.900").
  // Só age em token com >=2 pontos SEGUIDOS (número BR de milhar tem ponto único, nunca "..") →
  // seguro p/ laudo limpo. NOME+pontilhado vira "NOME:"; pontilhado-lixo solto é removido.
  function cleanLeaders(line){
    return line.split(/(\s+)/).map(function(tok){
      if(tok.indexOf('..') < 0) return tok;                          // sem pontilhado duplo → intacto (preserva 216.900)
      var m = tok.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ]+)\.{2,}(.*)$/);    // NOME grudado no pontilhado
      if(m) return m[2].charAt(0)===':' ? m[1]+m[2] : m[1]+':';      // "COLETA...:19/08"→"COLETA:19/08" ; "HEMÁCIAS...ci22..1"→"HEMÁCIAS:"
      if(/^\.{2,}[.\dA-Za-zÀ-ÿ]*$/.test(tok)) return '';             // pontilhado-lixo que COMEÇA com pontos → some (não apaga nome grudado tipo HCO3...)
      return tok;
    }).join('');
  }

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
    {key:'hemoglobina',label:'Hemoglobina',grupo:'Hemograma',unit:'g/dL',dec:1,ref:[12,17],plaus:[2,25],aliases:['hemoglobina','hemoclobina','hemoglob','hb','hgb']},
    {key:'hematocrito',label:'Hematócrito',grupo:'Hemograma',unit:'%',dec:1,ref:[36,52],plaus:[6,75],aliases:['hematocrito','ht','hct']},
    {key:'hemacias',label:'Hemácias',grupo:'Hemograma',unit:'milhões/mm³',dec:2,ref:[4.0,6.0],plaus:[1,8],aliases:['hemacias','eritrocitos','rbc']},
    {key:'vcm',label:'VCM',grupo:'Hemograma',unit:'fL',dec:1,ref:[80,100],plaus:[50,140],aliases:['vcm','mcv']},
    {key:'hcm',label:'HCM',grupo:'Hemograma',unit:'pg',dec:1,ref:[27,32],plaus:[15,45],aliases:['hcm','mch']},
    {key:'chcm',label:'CHCM',grupo:'Hemograma',unit:'%',dec:1,ref:[31,36],plaus:[25,40],aliases:['chcm','mchc']},
    {key:'rdw',label:'RDW',grupo:'Hemograma',unit:'%',dec:1,ref:[11.5,14.5],plaus:[8,30],aliases:['rdw','rdwh']},
    {key:'leucocitos',label:'Leucócitos',grupo:'Hemograma',unit:'/mm³',dec:0,ref:[4000,11000],plaus:[100,200000],aliases:['leucocitos','leucograma','leuco','wbc','globulos brancos']},
    {key:'neutrofilos',label:'Neutrófilos',grupo:'Hemograma',unit:'/mm³',dec:0,ref:[1800,7000],plaus:[0,180000],aliases:['neutrofilos segmentados','segmentados','neutrofilos','neutro']},
    {key:'bastoes',label:'Bastões',grupo:'Hemograma',unit:'/mm³',dec:0,ref:[0,700],plaus:[0,60000],aliases:['neutrofilos bastonetes','bastonetes','bastoes','bast']},
    {key:'linfocitos',label:'Linfócitos',grupo:'Hemograma',unit:'/mm³',dec:0,ref:[1000,4000],plaus:[0,90000],aliases:['linfocitos','linfo','lymph']},
    {key:'linfocitos_reativos',label:'Linfócitos reativos',grupo:'Hemograma',unit:'/mm³',dec:0,ref:[0,100],plaus:[0,20000],aliases:['linfocitos reativos','linfocitos atipicos']},
    {key:'monocitos',label:'Monócitos',grupo:'Hemograma',unit:'/mm³',dec:0,ref:[200,1000],plaus:[0,40000],aliases:['monocitos','mono']},
    {key:'eosinofilos',label:'Eosinófilos',grupo:'Hemograma',unit:'/mm³',dec:0,ref:[0,500],plaus:[0,40000],aliases:['eosinofilos','eosino','eos']},
    {key:'basofilos',label:'Basófilos',grupo:'Hemograma',unit:'/mm³',dec:0,ref:[0,200],plaus:[0,10000],aliases:['basofilos','baso']},
    {key:'metamielocitos',label:'Metamielócitos',grupo:'Hemograma',unit:'/mm³',dec:0,ref:[0,0],plaus:[0,20000],aliases:['metamielocitos','meiamielocitos','metiamielocitos']},
    {key:'mielocitos',label:'Mielócitos',grupo:'Hemograma',unit:'/mm³',dec:0,ref:[0,0],plaus:[0,20000],aliases:['mielocitos','mielociios','mielocitios']},
    {key:'promielocitos',label:'Promielócitos',grupo:'Hemograma',unit:'/mm³',dec:0,ref:[0,0],plaus:[0,20000],aliases:['promielocitos']},
    {key:'blastos',label:'Blastos',grupo:'Hemograma',unit:'/mm³',dec:0,ref:[0,0],plaus:[0,200000],aliases:['blastos','blasto']},
    {key:'celulas_atipicas',label:'Células atípicas',grupo:'Hemograma',unit:'/mm³',dec:0,ref:[0,0],plaus:[0,200000],aliases:['celulas atipicas','celula atipica']},
    {key:'plaquetas',label:'Plaquetas',grupo:'Hemograma',unit:'/mm³',dec:0,ref:[150000,450000],plaus:[1000,2000000],aliases:['plaquetas','plaqueta','plt','plaq']},
    {key:'vpm',label:'VPM',grupo:'Hemograma',unit:'fL',dec:2,ref:[9,13],plaus:[4,25],aliases:['vpm','vepm','volume plaquetario medio','mpv']},
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
    // Metabólico
    {key:'glicose',label:'Glicose',grupo:'Metabólico',unit:'mg/dL',dec:0,ref:[70,99],plaus:[10,1500],aliases:['glicemia','glicose','glucose']},
    {key:'acido_urico',label:'Ácido úrico',grupo:'Metabólico',unit:'mg/dL',dec:1,ref:[3.5,7.2],plaus:[0.5,25],aliases:['acido urico','ac urico','urato']},
    {key:'ldh',label:'DHL (LDH)',grupo:'Metabólico',unit:'U/L',dec:0,ref:[120,246],plaus:[50,10000],aliases:['lactato desidrogenase','desidrogenase latica','ldh','dhl']},
    {key:'amilase',label:'Amilase',grupo:'Metabólico',unit:'U/L',dec:1,ref:[28,100],plaus:[1,5000],aliases:['amilase']},
    {key:'lipase',label:'Lipase',grupo:'Metabólico',unit:'U/L',dec:1,ref:[6,51],plaus:[1,5000],aliases:['lipase']},
    {key:'ckmb',label:'CK-MB',grupo:'Metabólico',unit:'U/L',dec:1,ref:[0,25],plaus:[0,1000],aliases:['creatinofosfoquinase mb isoenzima','creatinofosoquinase mb isoenzima','creatinofosfoquinase mb','creatinofosoquinase mb','ck-mb','ckmb']},
    {key:'cpk',label:'CPK total',grupo:'Metabólico',unit:'U/L',dec:1,ref:[30,200],plaus:[1,100000],aliases:['creatinofosfoquinase cpk total','creatinofosfoquinase - cpk total','cpk total','cpk']},
    {key:'troponina_i',label:'Troponina I',grupo:'Metabólico',unit:'',dec:2,ref:null,plaus:[0,100000],qualitative:true,aliases:['troponina cardiaca-i','troponina cardiaca i','troponina i']},
    // Inflamatórios
    {key:'pcr',label:'PCR',grupo:'Inflamatórios',unit:'mg/dL',dec:2,ref:[0,5],plaus:[0,500],aliases:['proteina c reativa','pcr']},
    {key:'vhs',label:'VHS',grupo:'Inflamatórios',unit:'mm/h',dec:0,ref:[0,20],plaus:[0,150],aliases:['vhs','hemossedimentacao','esr']},
    {key:'procalcitonina',label:'Procalcitonina',grupo:'Inflamatórios',unit:'ng/mL',dec:2,ref:[0,0.5],plaus:[0,100],aliases:['procalcitonina','pct']},
    // Hepático
    {key:'ast',label:'AST/TGO',grupo:'Hepático',unit:'U/L',dec:0,ref:[0,40],plaus:[2,10000],aliases:['aspartato','tgo','ast']},
    {key:'alt',label:'ALT/TGP',grupo:'Hepático',unit:'U/L',dec:0,ref:[0,41],plaus:[2,10000],aliases:['alanina','tgp','alt']},
    {key:'fosfatase_alcalina',label:'Fosfatase alcalina',grupo:'Hepático',unit:'U/L',dec:0,ref:[40,129],plaus:[10,2000],aliases:['fosfatase alcalina','fal','alp']},
    {key:'ggt',label:'GGT',grupo:'Hepático',unit:'U/L',dec:0,ref:[8,61],plaus:[2,3000],aliases:['gama gt','gama-gt','glutamil','ggt']},
    {key:'bilirrubina_total',label:'Bilirrubina total',grupo:'Hepático',unit:'mg/dL',dec:2,ref:[0.2,1.2],plaus:[0,60],aliases:['bilirrubina total','bilirrubinas totais','bt']},
    {key:'bilirrubina_direta',label:'Bilirrubina direta',grupo:'Hepático',unit:'mg/dL',dec:2,ref:[0,0.3],plaus:[0,40],aliases:['bilirrubina direta','direta','bd']},
    {key:'bilirrubina_indireta',label:'Bilirrubina indireta',grupo:'Hepático',unit:'mg/dL',dec:2,ref:[0,0.9],plaus:[0,40],aliases:['bilirrubina indireta','indireta','bi']},
    {key:'albumina',label:'Albumina',grupo:'Hepático',unit:'g/dL',dec:1,ref:[3.5,5.2],plaus:[0.5,7],aliases:['albumina','alb']},
    {key:'proteinas_totais',label:'Proteínas totais',grupo:'Hepático',unit:'g/dL',dec:1,ref:[6,8],plaus:[2,12],aliases:['proteinas totais','ptn totais']},
    // Coagulação
    {key:'inr',label:'INR/RNI',grupo:'Coagulação',unit:'',dec:2,ref:[0.9,1.2],plaus:[0.5,12],aliases:['razao normalizada','inr','rni','brni']},
    {key:'tp',label:'TP (protrombina)',grupo:'Coagulação',unit:'s',dec:1,ref:[10,13],plaus:[5,120],aliases:['tempo de protrombina','protrombina','tap','tp']},
    {key:'ttpa',label:'TTPa',grupo:'Coagulação',unit:'s',dec:1,ref:[25,37],plaus:[15,200],aliases:['tempo de tromboplastina','ttpa','aptt','ptt']},
    {key:'fibrinogenio',label:'Fibrinogênio',grupo:'Coagulação',unit:'mg/dL',dec:0,ref:[200,400],plaus:[30,1200],aliases:['fibrinogenio']},
    // Gasometria
    {key:'ph',label:'pH',grupo:'Gasometria',unit:'',dec:3,ref:[7.35,7.45],plaus:[6.5,8],aliases:['ph sanguineo','ph']},
    {key:'pco2',label:'pCO₂',grupo:'Gasometria',unit:'mmHg',dec:1,ref:[35,45],plaus:[10,120],aliases:['pco2','paco2','pcoz']},
    {key:'po2',label:'pO₂',grupo:'Gasometria',unit:'mmHg',dec:1,ref:[80,100],plaus:[20,600],aliases:['po2','pao2','poz']},
    {key:'hco3',label:'HCO₃',grupo:'Gasometria',unit:'mmol/L',dec:1,ref:[22,26],plaus:[3,50],aliases:['hco3','bicarbonato','eco3']},
    {key:'be',label:'Excesso de base',grupo:'Gasometria',unit:'mmol/L',dec:1,ref:[-3,3],plaus:[-30,30],aliases:['excesso de base','base excess','be ecf','be-b','be-d','be']},
    {key:'sato2',label:'SatO₂',grupo:'Gasometria',unit:'%',dec:1,ref:[95,100],plaus:[30,100],aliases:['saturacao de o2','sato2','so2c','s02c','502c','so2']},
    {key:'lactato',label:'Lactato',grupo:'Gasometria',unit:'mmol/L',dec:1,ref:[0.5,2],plaus:[0,30],aliases:['lactato','acido latico']},
    {key:'tco2',label:'CO₂ total',grupo:'Gasometria',unit:'mmol/L',dec:1,ref:[23,27],plaus:[3,50],aliases:['tco2','tcoz','co2 total']},
    {key:'anion_gap',label:'Ânion gap',grupo:'Gasometria',unit:'mmol/L',dec:1,ref:[8,16],plaus:[0,50],aliases:['anion gap','anion-gap','anion -gap']},
  ];

  var GASOMETRY_PANEL = ['ph','pco2','po2','hco3','tco2','be','sato2','anion_gap','lactato'];
  var FIXED_PANEL = ['hemoglobina','hematocrito','leucocitos','bastoes','plaquetas','ureia','creatinina','sodio','potassio','cloro','calcio','magnesio','fosforo','glicose','pcr'].concat(GASOMETRY_PANEL);
  // Todo exame laboratorial conhecido, numérico e com unidade válida pode ser importado.
  // Culturas e exames desconhecidos continuam fora do fluxo automático.
  var AUTO_IMPORT_KEYS = CATALOG.map(function(c){return c.key;});
  // Mantida para compatibilidade; resultados presentes nunca são ocultados do quadro.
  var SECONDARY = ['hemacias','hcm','chcm','monocitos','eosinofilos','basofilos','linfocitos_reativos','metamielocitos','mielocitos','promielocitos','blastos','celulas_atipicas','vpm'];
  // painel prevalente de clínica médica (usado na FOLHA EM BRANCO) — hemograma enxuto (9)
  var BLANK_PANEL = ['hemoglobina','hematocrito','vcm','rdw','leucocitos','neutrofilos','bastoes','linfocitos','plaquetas','ureia','creatinina','sodio','potassio','cloro','calcio','magnesio','fosforo','glicose','acido_urico','ldh','pcr','vhs','procalcitonina','ast','alt','fosfatase_alcalina','ggt','bilirrubina_total','bilirrubina_direta','bilirrubina_indireta','proteinas_totais','albumina'].concat(GASOMETRY_PANEL,['tp','inr','ttpa','fibrinogenio']);
  var GRUPOS = ['Hemograma','Função renal','Eletrólitos','Metabólico','Inflamatórios','Hepático','Gasometria','Coagulação','Outros'];

  // índice de apelidos: {alias, key, isWord}
  var ALIAS_INDEX = [];
  CATALOG.forEach(function(c){
    c.aliases.forEach(function(a){
      var an = norm(a);
      ALIAS_INDEX.push({alias:an, key:c.key, isWord:(an.length>=3 || an.indexOf(' ')>=0)});
    });
  });
  ALIAS_INDEX.sort(function(a,b){ return b.alias.length - a.alias.length; }); // mais longo primeiro

  var UNITS = ['mg/dl','g/dl','meq/l','mmol/l','ng/ml','u/l','mm/h','mmhg','/mm3','mil/mm3','10^3/ul','x10^3/ul','x10^6/ul','fl','pg','mg/l','%'];

  function catByKey(k){ return CATALOG.find(function(c){return c.key===k;}); }
  function escRe(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

  /* ---------- detecção de linhas ---------- */
  function isReferenceLine(ln){ return /refer[eê]nc|valor(es)? de ref|\bvr\b|v\.r\b|intervalo de ref/.test(ln); }
  // linha que COMEÇA com rótulo de referência → é referência (não exame), mesmo que cite um exame depois
  function isReferenceHeader(ln){ return /^\s*(valor(es)? de refer|refer[eê]ncia\b|vr[:.\s]|v\.?\s?r\.?[:.\s]|intervalo de refer)/.test(ln); }
  function isNoiseLine(ln){ return /m[eé]todo|material|respons[aá]vel|\bcr[bm]m\b|crbm|conselho|assinatura|laborat[oó]rio|hospital|paciente|solicitante|conv[eê]nio|atendimento|\bcpf\b|\bc\.i\b|idade|sexo|libera[cç][aã]o|p[aá]gina|rodap[eé]|observa[cç]|coleta|data\b|hor[aá]rio|hora\b|\bnegro\b|filtra[cç][aã]o glomerular|ckd-?epi|plasma\s+(examinado|controle)/.test(ln); }

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

  var QUALITATIVOS = ['nao reagente','não reagente','nao detectado','não detectado','indetectavel','indetectável','incontaveis','incontáveis','reagente','detectado','negativo','negativa','positivo','positiva','ausente','presente'];
  var GAS_OCR_ALIASES = {poz:1,pcoz:1,eco3:1,tcoz:1,s02c:1,'502c':1,'be-b':1,'be-d':1};

  // Extrai valor de uma linha. Retorna {value_type,value_numeric,value_text,unit,reference} ou null.
  var CONTROLLAB_SINGLE_COLUMN = {
    hemacias:1, hemoglobina:1, hematocrito:1, vcm:1, hcm:1, chcm:1, rdw:1,
    leucocitos:1, plaquetas:1, vpm:1
  };
  var CONTROLLAB_DIFFERENTIAL = {
    neutrofilos:1, bastoes:1, linfocitos:1, linfocitos_reativos:1, monocitos:1,
    eosinofilos:1, basofilos:1, metamielocitos:1, mielocitos:1, promielocitos:1,
    blastos:1, celulas_atipicas:1
  };

  // Extrai uma linha tabular do perfil KN/Controllab sem jamais procurar o valor
  // dentro da coluna de referência. Esse é o fail-safe que impede, por exemplo,
  // 450.000 (limite superior) de substituir o resultado real de plaquetas.
  function extractControllabTableValue(valuePart, key){
    if(CONTROLLAB_DIFFERENTIAL[key]){
      var diff=valuePart
        // OCR recorrente neste modelo: o símbolo % vira "5", às vezes colado
        // à última casa decimal ("0,05" = "0,0 %"). A correção só ocorre em
        // linhas de diferencial e somente quando há a contagem /mm³ logo depois.
        .replace(/\b[Oo]\s+Zum\b/gi,'0 /mm3')
        .replace(/(-?\d+[,.]\d)[58]\s+(?=[Oo0-9]+\s*[\/“”'’*]?\s*mm)/g,'$1 % ')
        .replace(/(-?\d+[,.]\d)\s+5\s+(?=[Oo0-9]+\s*[\/“”'’*]?\s*mm)/g,'$1 % ')
        .replace(/\b[Oo]\s*(?=[\/“”'’*]?\s*mm[?'’*º°³3])/g,'0 ')
        .replace(/[“”'’*]\s*(?=mm[?'’*º°³3])/g,'/');
      var md=diff.match(/^\s*(-?\d{1,3}(?:\.\d{3})*(?:,\d+)?|-?\d+(?:[.,]\d+)?)\s*(?:%|[&$])\s+(-?\d{1,3}(?:\.\d{3})*|-?\d+)\s*\/?\s*mm[?'’*º°³3]/i);
      if(md){
        return {value_type:'numeric',value_numeric:parseNumBR(md[2]),value_text:md[2],unit:'/mm3',reference:null,
                ocr_correction:/\b[Oo]\s*(?=\/?\s*mm)/.test(valuePart)?'O → 0 em contagem absoluta':null};
      }
      var mdNoPercent=diff.match(/^\s*(-?\d{1,3}(?:\.\d{3})*(?:,\d+)?|-?\d+(?:[.,]\d+)?)\s+(-?\d{1,3}(?:\.\d{3})*|-?\d+)\s*\/?\s*mm[?'’*º°³3]/i);
      if(mdNoPercent){
        return {value_type:'numeric',value_numeric:parseNumBR(mdNoPercent[2]),value_text:mdNoPercent[2],unit:'/mm3',reference:null,
                ocr_correction:'contagem absoluta recuperada apesar de % ausente no OCR'};
      }
      // Diferencial ambíguo: devolve somente a primeira métrica e sua unidade.
      // A triagem bloqueará porcentagem para analitos cuja dimensão esperada é /mm3.
      var firstDiff=valuePart.match(/^\s*(-?\d{1,3}(?:\.\d{3})*(?:,\d+)?|-?\d+(?:[.,]\d+)?)\s*(%|[&$])/);
      if(firstDiff){
        return {value_type:'numeric',value_numeric:parseNumBR(firstDiff[1]),value_text:firstDiff[1],unit:'%',reference:null,
                ocr_correction:firstDiff[2]==='%'?null:firstDiff[2]+' → %'};
      }
      // No laudo fixo KN, o resultado absoluto é a última contagem da coluna
      // antes do grande espaço que separa a referência. Recupera quando o OCR
      // perde simultaneamente o símbolo de porcentagem e o "/mm³".
      var diffGap=diff.search(/\s{3,}/), diffResult=diffGap>=0?diff.slice(0,diffGap):'';
      var diffNums=diffResult.match(/-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:[.,]\d+)?/g)||[];
      if(diffNums.length>=2){
        var absoluteText=diffNums[diffNums.length-1], absolute=parseNumBR(absoluteText);
        var diffCat=catByKey(key);
        if(absolute!=null && Number.isInteger(absolute) && diffCat && absolute>=diffCat.plaus[0] && absolute<=diffCat.plaus[1]){
          return {value_type:'numeric',value_numeric:absolute,value_text:absoluteText,unit:'/mm3',reference:null,
                  ocr_correction:'contagem absoluta recuperada pela coluna fixa KN'};
        }
      }
      return /\d/.test(valuePart)?{blocked_table_value:true}:null;
    }
    if(!CONTROLLAB_SINGLE_COLUMN[key]) return null;

    // Três ou mais espaços são a divisória visual entre RESULTADO e REFERÊNCIA
    // nesse modelo. Linha numérica sem essa divisória fica bloqueada (fail-closed).
    var gap=valuePart.search(/\s{3,}/);
    if(gap<0){
      // Texto copiado costuma perder as lacunas da tabela. Ainda é seguro quando
      // a unidade está colada ao PRIMEIRO número; nunca procuramos unidade adiante.
      var leading=valuePart.match(/^\s*(-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+,\d+|-?\d+\.\d+|-?\d+)/);
      if(!leading) return null;
      var leadingTail=valuePart.slice(leading.index+leading[0].length);
      var leadingUnit=unitAtStart(leadingTail,key==='hematocrito'||key==='chcm'||key==='rdw');
      if(!leadingUnit && (key==='vcm'||key==='vpm') && /^[e£f]\s*l\b/i.test(leadingTail.trim())) leadingUnit='fl';
      // Neste formulário fixo, a dimensão vem do próprio campo mapeado. Não
      // dependemos do OCR acertar fL, %, pg ou /mm³ para aceitar a célula.
      if(!leadingUnit){ var leadingCat=catByKey(key); if(leadingCat) leadingUnit=leadingCat.unit; }
      if(!leadingUnit && key!=='inr') return {blocked_table_value:true};
      var leadingRaw=leadingTail.trim();
      var leadingText=leading[1];
      if(key==='hematocrito' && /^-?\d{1,2}[.,]\d8$/.test(leadingText)) leadingText=leadingText.slice(0,-1);
      return {value_type:'numeric',value_numeric:parseNumBR(leadingText),value_text:leadingText,unit:leadingUnit,reference:null,
              ocr_correction:/^[&$](?:\s|$)/.test(leadingRaw)?leadingRaw.charAt(0)+' → %':null};
    }
    var resultPart=valuePart.slice(0,gap).trim();
    var referencePart=valuePart.slice(gap);
    var mn=resultPart.match(/-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+,\d+|-?\d+\.\d+|-?\d+/);
    if(!mn) return {blocked_table_value:true};
    var unit=findUnit(resultPart, key==='hematocrito'||key==='chcm'||key==='rdw');
    if(!unit && (key==='vcm'||key==='vpm') && /\d\s*[e£f]\s*l\b/i.test(resultPart)) unit='fl';
    if(!unit && (key==='chcm'||key==='rdw') && /\d[\d.,]*\s+a\s+\d[\d.,]*\s*[&$%3]/i.test(referencePart)) unit='%';
    if(!unit){ var fixedCat=catByKey(key); if(fixedCat) unit=fixedCat.unit; }
    var valueText=mn[0], correction=null;
    if(key==='rdw' && unit==='%'){
      var rdwNums=(resultPart.match(/-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+,\d+|-?\d+\.\d+|-?\d+/g)||[]);
      var rdwPlausible=rdwNums.filter(function(x){var n=parseNumBR(x);return n>=8&&n<=30;});
      if(rdwPlausible.length===1 && rdwPlausible[0]!==valueText){valueText=rdwPlausible[0];correction='inteiro-lixo antes do RDW removido';}
    }

    // Neste equipamento o hematócrito sai com uma casa decimal. Em uma ocorrência,
    // o Tesseract fundiu o símbolo % ao número como um "8": 37,7% → 37,78.
    // A correção só vale no perfil Controllab, só para hematócrito, só quando não há
    // unidade na coluna de resultado e a coluna de referência é inequivocamente %.
    if(key==='hematocrito'){
      var fused=valueText.match(/^(-?\d{1,2}[.,]\d)8$/);
      if(fused){
        valueText=fused[1]; unit='%'; correction='8 final → % no hematócrito Controllab';
      }
    }
    return {value_type:'numeric',value_numeric:parseNumBR(valueText),value_text:valueText,unit:unit,reference:null,
            ocr_correction:correction};
  }

  function extractValue(l, key, profile){
    var ln = norm(l);
    // referência inline entre parênteses/colchetes (guarda antes de tirar)
    var reference = null;
    var mref = l.match(/[\(\[]\s*(-?\d[\d.]*(?:,\d+)?)\s*(?:[-a–]|at[eé])\s*(-?\d[\d.]*(?:,\d+)?)\s*[\)\]]/);
    if(mref){ reference = [parseNumBR(mref[1]), parseNumBR(mref[2])]; }
    // parte "valor": remove parentéticos pra não pegar a referência como valor
    var valuePart = l.replace(/\([^)]*\)/g,' ').replace(/\[[^\]]*\]/g,' ');
    var ci = valuePart.indexOf(':');
    if(ci>=0 && /\d/.test(valuePart.slice(ci+1))) valuePart = valuePart.slice(ci+1);   // valor vem DEPOIS do ":" (não pega o dígito do nome, ex.: PCO2/HCO3/TCO2)
    var vpn = norm(valuePart);

    if(profile==='hospital_kn' && key && (CONTROLLAB_SINGLE_COLUMN[key]||CONTROLLAB_DIFFERENTIAL[key])){
      var tableValue=extractControllabTableValue(valuePart,key);
      if(tableValue){
        if(tableValue.blocked_table_value) return null;
        return tableValue;
      }
    }

    var gasPercent=key==='sato2';

    // censurado (<0,1 / >100)
    var mc = valuePart.match(/([<>])\s*=?\s*(\d[\d.]*(?:,\d+)?)/);
    if(mc){
      return {value_type: (mc[1]==='<'?'less_than':'greater_than'),
              value_numeric: parseNumBR(mc[2]), value_text: mc[1]+mc[2].replace(/\s/g,''),
              unit: findUnit(valuePart,gasPercent,gasPercent), reference: reference};
    }
    // diferencial de leucócitos: "79,0 % 12395 /mm³" → usa o ABSOLUTO (/mm³), não a porcentagem
    var mdiff = valuePart.match(/\d[\d.]*(?:,\d+)?\s*%\s+(\d[\d.]*(?:,\d+)?)\s*\/?\s*mm/i);
    if(mdiff){
      return {value_type:'numeric', value_numeric: parseNumBR(mdiff[1]), value_text: mdiff[1], unit:'/mm3', reference: reference};
    }
    // numérico. Em laudo LIMPO o valor é o 1º número; em texto de OCR o pontilhado
    // ("HEMÁCIAS...ci221022022..1 3,95 milhões/mm³") injeta um inteiro-lixo ANTES do valor.
    // Sinal robusto: o valor real é o número colado numa UNIDADE (3,95 milhões/mm³ / 22,8 mmol/L);
    // o lixo do pontilhado não tem unidade em seguida. Preferimos o 1º número seguido de unidade;
    // se nenhum tiver unidade (ex.: INR), caímos no 1º número (comportamento antigo).
    var numRe = /-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+,\d+|-?\d+\.\d+|-?\d+/g, nm, nums = [];
    while((nm = numRe.exec(valuePart)) !== null){ nums.push({t: nm[0], end: nm.index + nm[0].length}); }
    if(nums.length){
      var picked = null;
      for(var qi=0; qi<nums.length; qi++){ if(startsWithUnit(valuePart.slice(nums[qi].end),gasPercent,gasPercent)){ picked = nums[qi]; break; } }
      if(!picked) picked = nums[0];
      return {value_type:'numeric', value_numeric: parseNumBR(picked.t), value_text: picked.t,
              unit: unitAtStart(valuePart.slice(picked.end),gasPercent,gasPercent) || findUnit(valuePart,gasPercent,gasPercent), reference: reference};
    }
    // qualitativo (só se não houver número)
    for(var i=0;i<QUALITATIVOS.length;i++){
      if(vpn.indexOf(norm(QUALITATIVOS[i]))>=0)
        return {value_type:'qualitative', value_numeric:null, value_text:QUALITATIVOS[i], unit:null, reference:reference};
    }
    return null;
  }

  function findUnit(l, allowOcrPercent, allowOcrFivePercent){
    var raw = norm(l).replace(/³/g,'3').replace(/²/g,'2').replace(/[µμ]/g,'u');
    var d = raw.search(/\d/); if(d>0) raw = raw.slice(d);   // ignora o NOME do exame (antes do 1º número)
    // O Tesseract costuma trocar o sobrescrito ³ por ?, º ou °. Esse padrão é
    // específico de contagem celular e pode ser normalizado sem adivinhar dimensão.
    var ln = raw.replace(/\s+/g,'');
    if(/(?:milhoes?|milhao)\/mm[?'’*º°3]/.test(ln)) return 'mil/mm3';
    if(/\/mm[?'’*º°3]/.test(ln)) return '/mm3';
    if(/mm(?:iag|ilg|ig|ag)/.test(ln)) return 'mmhg';
    if(/meqg\/l/.test(ln)||/meg\/l/.test(ln)) return 'meq/l';
    if(allowOcrPercent && /(?:^|\s)[&$](?:\s|$)/.test(raw)) return '%';
    if(allowOcrFivePercent && /(?:^|\s)5(?:\s|$)/.test(raw)) return '%';
    for(var i=0;i<UNITS.length;i++){ if(ln.indexOf(UNITS[i].replace(/\s+/g,''))>=0) return UNITS[i]; }
    // Segundos só contam como token isolado; nunca como a letra "s" dentro de outra palavra.
    if(/\bs\b/.test(raw)) return 's';
    return null;
  }

  // Unidade imediatamente colada ao número escolhido. Evita usar, por exemplo,
  // o /mm3 de uma coluna absoluta quando o número selecionado pertence à coluna %.
  function unitAtStart(tail, allowOcrPercent, allowOcrFivePercent){
    var raw = norm(tail).replace(/³/g,'3').replace(/²/g,'2').replace(/[µμ]/g,'u').trim();
    var t = raw.replace(/\s+/g,'');
    if(/^(?:milhoes?|milhao)\/mm[?'’*º°3]/.test(t)) return 'mil/mm3';
    if(/^(?:cels?|celulas?)\/mm[?'’*º°3]/.test(t)) return '/mm3';
    if(/^\/mm[?'’*º°3]/.test(t)) return '/mm3';
    if(/^mm(?:iag|ilg|ig|ag)/.test(t)) return 'mmhg';
    if(/^meqg\/l/.test(t)||/^meg\/l/.test(t)) return 'meq/l';
    if(allowOcrPercent && /^[&$](?:\s|$)/.test(raw)) return '%';
    if(allowOcrFivePercent && /^5(?:\s|$)/.test(raw)) return '%';
    for(var i=0;i<UNITS.length;i++){
      var u=UNITS[i].replace(/\s+/g,'');
      if(t.indexOf(u)===0) return UNITS[i];
    }
    if(/^s(?:\b|$)/.test(raw)) return 's';
    return null;
  }

  // O trecho logo DEPOIS de um número começa com uma unidade? (usado p/ escolher o valor certo
  // entre vários números na linha — o valor real cola numa unidade; o lixo do pontilhado não.)
  function startsWithUnit(tail, allowOcrPercent, allowOcrFivePercent){
    return !!unitAtStart(tail,allowOcrPercent,allowOcrFivePercent);
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
    if(/[()]/.test(label)) return null;                       // rótulo com parêntese solto = ruído de OCR (ex.: "dA 2) e PRN")
    // sublabels de faixa de referência / demografia NUNCA são exame (ex.: "Adultos", "Homens", "Cordão")
    if(/^(adultos?|homens|mulheres|criancas?|crianca|recem[\s-]?nascidos?|lactentes?|adolescentes?|idosos?|gestantes?|neonatos?|prematuros?|cordao|meses|anos|dias|jejum)\b/.test(norm(label))) return null;
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

  // Data de coleta de UMA linha (só quando a linha diz "coleta") — usada p/ fatiar laudo multi-data
  function collectionDateOf(l){
    var m = String(l||'').match(/coleta[^0-9]{0,15}(\d{2})\/(\d{2})\/(\d{2,4})/i);
    if(!m) return null;
    var y = m[3].length===2 ? '20'+m[3] : m[3];
    var d = new Date(+y, +m[2]-1, +m[1], 8, 0);
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
    var rawText=String(text||'');
    var profileAssessment=assessHospitalLabText(rawText);
    var profile=profileAssessment.accepted?'hospital_kn':null;
    var lines = rawText.split(/\r?\n/).map(function(s){
      return {raw:cleanLeaders(s.replace(/\t/g,'    ').trim()),compact:cleanLeaders(s.replace(/\s+/g,' ').trim())};
    }).filter(function(x){return !!x.compact;});
    var results = [];
    var current = null; // {result, hasValue}
    var docDate = detectDate(text);   // data do documento (fallback)
    var curDate = null;               // data de coleta da SEÇÃO atual (laudo multi-data)
    var gasometrySection = false;
    var gasometrySample = null;       // arterial | venous | null
    var bilirubinSection = false;
    var pendingSection = false;

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
      var l = lines[i].compact, rawLine=lines[i].raw, ln = norm(l);

      // A página "Lista de Exames Pendentes" não contém resultados. Ignora o
      // bloco inteiro até o cabeçalho inequívoco de um novo laudo/página.
      if(/lista de exames pendentes|exames pendentes/.test(ln)){pendingSection=true;current=null;continue;}
      if(pendingSection){
        if(/controle de qualidade|hemograma completo|gasometria\s+(?:arterial|venos[ao])/.test(ln)) pendingSection=false;
        else continue;
      }

      // O painel de bilirrubinas traz três resultados seguidos de muitas faixas
      // pediátricas com os mesmos rótulos. Ele é extraído abaixo como bloco;
      // aqui ignoramos toda a seção para referências não virarem resultados.
      if(/bilirrubina total e frac/.test(ln)){bilirubinSection=true;current=null;continue;}
      if(bilirubinSection){
        if(/\bpaciente\b/.test(ln)) bilirubinSection=false;
        else {
          var nextPanelAnchor=findAnchor(l);
          if(nextPanelAnchor && nextPanelAnchor.key.indexOf('bilirrubina_')!==0) bilirubinSection=false;
          else continue;
        }
      }

      // TP e TTPa usam "Plasma examinado" como resultado. São extraídos como
      // blocos abaixo, nunca a partir do controle ou da atividade.
      if(/^tempo de (?:proto|trombo)/.test(ln)){current=null;continue;}

      // Cada página KN repete o cabeçalho do paciente. Ao encontrá-lo, fecha a
      // seção anterior para que aliases exclusivos da gasometria (como pE → pH)
      // não contaminem exames das páginas seguintes.
      if(gasometrySection && /^(?:controllab|controle de qualidade|paciente|solicitante)\b/.test(ln)){
        gasometrySection=false; gasometrySample=null;
      }
      if(/gasometria\s+arterial/.test(ln)){ gasometrySection=true; gasometrySample='arterial'; }
      else if(/gasometria\s+venos[ao]/.test(ln)){ gasometrySection=true; gasometrySample='venous'; }
      if(/material.*sangue\s+arterial/.test(ln)) gasometrySample='arterial';
      else if(/material.*sangue\s+venos[ao]/.test(ln)) gasometrySample='venous';
      else if(/^material[^a-z]*sangue\s*$/.test(ln)) gasometrySample=null;
      if(current && !current.hasValue){
        var pendingCat=catByKey(current.result.exam_name_normalized);
        if(pendingCat && pendingCat.grupo==='Gasometria') current.result.sample_type=gasometrySample;
      }

      // atualiza a data de coleta corrente (cada página do laudo tem a sua "COLETA: dd/mm/aaaa")
      var _cd = collectionDateOf(l); if(_cd){ curDate = _cd; if(current && !current.hasValue) current.result.collection_dateISO = _cd; }

      // linha de REFERÊNCIA (começa com "Valor de referência"/"VR"…) → aplica ao exame anterior, nunca vira exame
      if(isReferenceHeader(ln)){
        if(current && current.result){
          var mr = l.match(/(-?\d[\d.]*(?:,\d+)?)\s*(?:[-a–]|at[eé])\s*(-?\d[\d.]*(?:,\d+)?)/);
          if(mr){ current.result.reference_min = parseNumBR(mr[1]); current.result.reference_max = parseNumBR(mr[2]); }
          // Alguns laudos imprimem a unidade apenas na faixa de referência. Como a
          // linha é explicitamente a referência do exame corrente, essa herança é segura.
          if(current.hasValue && !current.result.unit){
            var currentCat=catByKey(current.result.exam_name_normalized);
            var referenceUnit=(!currentCat || currentCat.unit) ? findUnit(l) : null;
            if(referenceUnit){ current.result.unit=referenceUnit; finalizeConfidence(current.result); }
          }
        }
        continue;
      }

      var anchor = findAnchor(l);
      // Neste modelo o Tesseract lê "pH" como "pE". Só aceitamos essa troca
      // dentro de uma seção explicitamente marcada como gasometria.
      if(!anchor && gasometrySection && /^\s*pe(?:[^a-z0-9]|$)/.test(ln) && /\d/.test(l))
        anchor={key:'ph',isWord:true,matchText:'pe'};
      var val = extractValue(rawLine,anchor&&anchor.key,profile);
      if(anchor && anchor.key==='inr' && val) val.unit=null;
      if(anchor && val && profile==='hospital_kn'){
        var fixedValueCat=catByKey(anchor.key);
        // No laudo hospitalar identificado, a unidade é propriedade fixa do
        // campo quando o OCR a omite. Uma unidade presente e incompatível não
        // é sobrescrita: assim uma porcentagem sem contagem absoluta continua
        // bloqueada, em vez de virar artificialmente uma contagem /mm³.
        if(fixedValueCat && fixedValueCat.unit && !val.unit) val.unit=fixedValueCat.unit;
      }

      if(anchor){
        var cat = catByKey(anchor.key);
        var base = {
          // Neste formulário os nomes são controlados pelo hospital. Usar o
          // rótulo canônico também evita truncar siglas que contêm dígitos
          // (PCO2/HCO3) ao separar o nome do valor.
          exam_name_original: profile==='hospital_kn' ? cat.label : (l.split(/(?=[<>]?\s*-?\d)/)[0].replace(/[.·:]+\s*$/,'').trim() || cat.label),
          exam_name_normalized: anchor.key,
          category:'laboratory',
          value_type:null, value_numeric:null, value_text:null, unit:null,
          reference_min:null, reference_max:null, reference_text:null,
          matched_symbol_only: (!anchor.isWord||GAS_OCR_ALIASES[anchor.matchText]) && !(gasometrySection && cat.grupo==='Gasometria'),
          sample_type: cat.grupo==='Gasometria' ? gasometrySample : null,
          source_profile: profile,
          collection_dateISO: (curDate || docDate),
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
            matched_symbol_only:false, is_generic:true, collection_dateISO: (curDate || docDate), source_text: l
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

    appendStructuredPanels();
    return { results: results, dateISO: docDate, profile:profile, profileAssessment:profileAssessment };

    function appendStructured(key,valueText,unit,sourceText,valueType,sectionDate){
      var c=catByKey(key), r={
        exam_name_original:c.label,exam_name_normalized:key,category:'laboratory',
        value_type:valueType||'numeric',value_numeric:valueType==='qualitative'?null:parseNumBR(valueText),value_text:valueText,unit:unit||null,
        reference_min:null,reference_max:null,reference_text:null,matched_symbol_only:false,sample_type:null,
        source_profile:profile,collection_dateISO:sectionDate||docDate,source_text:sourceText
      };
      results.push(r);finalizeConfidence(r);
    }

    function appendStructuredPanels(){
      function nearestCollectionDate(index){
        var prefix=rawText.slice(Math.max(0,index-5000),index), re=/(?:data\s+(?:da\s+)?coleta|coleta)[^0-9]{0,20}\d{2}\/\d{2}\/\d{2,4}/gi, m, last=null;
        while((m=re.exec(prefix))!==null) last=m[0];
        return last ? detectDate(last) : docDate;
      }
      var biliHeading=/bilirrubina total e fra[cç][oõ]es/i.exec(rawText);
      if(biliHeading){
        // No formulário KN, os três valores ficam entre RESULTADO e VALORES DE
        // REFERÊNCIA. Recortar esse bloco impede capturar faixas pediátricas e
        // permite sobreviver quando o OCR perde a unidade em uma das linhas.
        var biliWindow=rawText.slice(biliHeading.index,biliHeading.index+1800);
        var resultStart=biliWindow.search(/resultado\s*:/i), referenceStart=biliWindow.search(/valores?\s+de\s+refer/i);
        var biliResult=resultStart>=0?biliWindow.slice(resultStart,referenceStart>resultStart?referenceStart:Math.min(biliWindow.length,resultStart+500)):'';
        var total=biliResult.match(/(?:^|\n)\s*total[^0-9]{0,40}(-?\d[\d.]*(?:,\d+)?)/i);
        var direct=biliResult.match(/(?:^|\n)\s*direta[^0-9]{0,40}(-?\d[\d.]*(?:,\d+)?)/i);
        var indirect=biliResult.match(/(?:^|\n)\s*indireta[^0-9]{0,40}(-?\d[\d.]*(?:,\d+)?)/i);
        if(total&&direct&&indirect){
          var biliDate=detectDate(biliWindow.slice(0,resultStart>=0?resultStart:500))||nearestCollectionDate(biliHeading.index);
          appendStructured('bilirrubina_total',total[1],'mg/dL','BILIRRUBINA TOTAL: '+total[1]+' mg/dL',null,biliDate);
          appendStructured('bilirrubina_direta',direct[1],'mg/dL','BILIRRUBINA DIRETA: '+direct[1]+' mg/dL',null,biliDate);
          appendStructured('bilirrubina_indireta',indirect[1],'mg/dL','BILIRRUBINA INDIRETA: '+indirect[1]+' mg/dL',null,biliDate);
        }
      }
      var tp=rawText.match(/tempo de protrombina[\s\S]{0,500}?plasma examinado[^0-9]{0,30}(-?\d[\d.]*(?:,\d+)?)\s*segundos/i);
      if(tp) appendStructured('tp',tp[1],'s','Plasma examinado: '+tp[1]+' segundos',null,nearestCollectionDate(tp.index));
      var ttpa=rawText.match(/tempo de tromboplastina parcial ativado[\s\S]{0,500}?plasma examinado[^0-9]{0,30}(-?\d[\d.]*(?:,\d+)?)\s*segundos/i);
      if(ttpa) appendStructured('ttpa',ttpa[1],'s','Plasma examinado: '+ttpa[1]+' segundos',null,nearestCollectionDate(ttpa.index));
    }

    function applyVal(r, val){
      r.value_type = val.value_type;
      r.value_numeric = val.value_numeric;
      r.value_text = val.value_text;
      if(val.unit) r.unit = val.unit;
      if(!r.unit){ var c = catByKey(r.exam_name_normalized); if(c && c.unit) r.unit_expected = c.unit; }
      if(val.reference){ r.reference_min = val.reference[0]; r.reference_max = val.reference[1]; }
      if(val.ocr_correction) r.ocr_correction = val.ocr_correction;
    }
  }

  /* ---------- triagem conservadora para importação automática ----------
     Erra por omissão: qualquer dúvida bloqueia a linha, mas ainda informa o que foi identificado. */
  function unitToken(unit){
    return norm(unit).replace(/³/g,'3').replace(/²/g,'2').replace(/[µμ]/g,'u').replace(/\s+/g,'')
      .replace(/milh(?:oes|ao)\/mm3/,'mil/mm3')
      .replace(/^\/mm[?'’*º°]$/,'/mm3')
      .replace(/^meqg\/l$/,'meq/l').replace(/^meg\/l$/,'meq/l');
  }
  function unitsCompatible(actual, expected){
    return !!actual && !!expected && unitToken(actual)===unitToken(expected);
  }
  function documentNotices(text){
    var t=norm(text), out=[];
    if(/urocultura|hemocultura|coprocultura|antibiograma|antimicrobiano|\bufc\b|unidades formadoras/.test(t))
      out.push({code:'culture',label:'Cultura/antibiograma',message:'Cultura identificada — anotar manualmente.'});
    if(/tomografia|radiograf|ultrassonograf|ultra-?som|\busg\b|ressonancia magnetica|densitometria|mamografia|ecocardiograma|\bdoppler\b|cintilografia|angiotomografia|colonoscopia|\bendoscopia\b|\braio-?\s?x\b/.test(t))
      out.push({code:'imaging',label:'Laudo de imagem',message:'Laudo de imagem identificado — anotar manualmente.'});
    if(/anatomopatol|histopatol|biopsia|biopsia|citopatol|citologia onc[oó]tica/.test(t))
      out.push({code:'pathology',label:'Anatomopatológico/citologia',message:'Laudo anatomopatológico/citológico identificado — anotar manualmente.'});
    var hasPending=/lista de exames pendentes|exames pendentes|previsao de entrega|previsão de entrega/.test(t);
    if(hasPending)
      out.push({code:'pending',label:'Exame pendente',message:'Exame ainda sem resultado identificado — anotar quando for liberado.'});
    if(/sorolog|anti[- ]?hiv|hbsag|anti[- ]?hcv|vdrl|\bigg\b|\bigm\b|nao reagente|não reagente/.test(t))
      out.push({code:'qualitative',label:'Sorologia/qualitativo',message:'Resultado qualitativo ou sorologia identificado — anotar manualmente.'});
    // Uma lista de pendências pode citar EAS/Gram sem trazer resultado. Retira
    // esse bloco antes de procurar exames laboratoriais realmente concluídos,
    // para não emitir ao mesmo tempo "pendente" e "fora do quadro".
    var completedText=t.replace(/(?:lista de exames pendentes|exames pendentes)[\s\S]*?(?=(?:controle de qualidade|hemograma completo|gasometria(?: arterial| venosa)?|coagulograma|bioquimica|bioquímica|$))/g,' ');
    if(/urina tipo 1|urina rotina|bacterioscopia|coloracao pelo gram|coloração pelo gram/.test(completedText))
      out.push({code:'other_lab',label:'Exame laboratorial fora do quadro',message:'Exame laboratorial fora do quadro identificado — não incluído.'});
    return out;
  }
  function triageConservative(text, fallbackDateISO){
    text=String(text||'');
    var parsed=parseLabText(text), accepted=[], blocked=[], needsDate=false;
    parsed.results.forEach(function(r){
      var c=catByKey(r.exam_name_normalized), reasons=[];
      var isQuantitative=['numeric','less_than','greater_than'].indexOf(r.value_type)>=0;
      var isKnownQualitative=!!c && c.qualitative===true && r.value_type==='qualitative';
      if(AUTO_IMPORT_KEYS.indexOf(r.exam_name_normalized)<0) reasons.push('exame fora do painel automático');
      if(!isQuantitative && !isKnownQualitative) reasons.push('resultado não numérico');
      if(isQuantitative && (r.value_numeric==null || !isFinite(r.value_numeric))) reasons.push('número ausente ou inválido');
      if(!c) reasons.push('exame fora do catálogo');
      if(c && c.unit && !unitsCompatible(r.unit,c.unit)) reasons.push(r.unit?'unidade incompatível':'unidade ausente');
      if(c && !c.unit && r.unit) reasons.push('unidade incompatível');
      if(r.confidence!=='ok') reasons.push(r.confidence_reason||'extração incerta');
      if(c && isQuantitative && r.value_numeric!=null && (r.value_numeric<c.plaus[0] || r.value_numeric>c.plaus[1])) reasons.push('valor fora da faixa plausível');
      var dateISO=r.collection_dateISO||fallbackDateISO||parsed.dateISO||null;
      if(reasons.length){
        var sourceNorm=norm(r.source_text||'');
        var cultureArtifact=/\bufc\b|escherichia|klebsiella|staphylococcus|streptococcus|enterococcus|pseudomonas|acinetobacter|proteus|serratia|candida/.test(sourceNorm);
        var pendingArtifact=/lista de exames pendentes|exames pendentes|previsao de entrega|previsão de entrega/.test(norm(text)) && !r.unit;
        blocked.push({key:r.exam_name_normalized,label:r.exam_name_original||(c&&c.label)||r.exam_name_normalized,reasons:reasons,source_text:r.source_text||'',culture_artifact:cultureArtifact,pending_artifact:pendingArtifact});
      }else{
        if(!dateISO) needsDate=true;
        var safe={}; Object.keys(r).forEach(function(k){safe[k]=r[k];}); safe.collection_dateISO=dateISO;
        accepted.push(safe);
      }
    });
    // Repetições idênticas do mesmo analito/data são comuns em pacotes com
    // hemograma + coagulograma: mantém uma só. Se os valores divergirem,
    // nenhum deles entra automaticamente.
    var groups={};
    accepted.forEach(function(r){
      var id=r.exam_name_normalized+'|'+(r.collection_dateISO||'')+'|'+(r.sample_type||'');
      (groups[id]=groups[id]||[]).push(r);
    });
    var uniqueAccepted=[];
    Object.keys(groups).forEach(function(id){
      var group=groups[id], signatures={};
      group.forEach(function(r){signatures[r.value_type+'|'+r.value_numeric+'|'+unitToken(r.unit)]=1;});
      if(Object.keys(signatures).length===1){ uniqueAccepted.push(group[0]); return; }
      group.forEach(function(r){
        blocked.push({key:r.exam_name_normalized,label:r.exam_name_original,reasons:['resultados conflitantes para o mesmo exame e data'],source_text:r.source_text||'',culture_artifact:false});
      });
    });
    accepted=uniqueAccepted;
    var notices=documentNotices(text);
    return {
      kind:(notices.length&&accepted.length)?'mixed':(notices.length?notices[0].code:'lab'),
      accepted:accepted, blocked:blocked, notices:notices, needsDate:needsDate,
      dateISO:parsed.dateISO, profile:parsed.profile, profileAssessment:parsed.profileAssessment, recognizedCount:parsed.results.length
    };
  }

  /* ---------- API pública ---------- */
  var API = {
    parseLabText: parseLabText,
    parsePatientInfo: parsePatientInfo,
    detectKind: detectKind,
    parseCulture: parseCulture,
    triageConservative: triageConservative,
    unitsCompatible: unitsCompatible,
    documentNotices: documentNotices,
    detectDate: detectDate,
    parseNumBR: parseNumBR,
    norm: norm,
    assessHospitalLabText: assessHospitalLabText,
    isHospitalLabText: isHospitalLabText,
    CATALOG: CATALOG,
    GASOMETRY_PANEL: GASOMETRY_PANEL,
    FIXED_PANEL: FIXED_PANEL,
    AUTO_IMPORT_KEYS: AUTO_IMPORT_KEYS,
    SECONDARY: SECONDARY,
    BLANK_PANEL: BLANK_PANEL,
    GRUPOS: GRUPOS,
    catByKey: catByKey
  };
  root.Parser = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis);
