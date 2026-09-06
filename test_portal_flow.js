// Exercita a sincronização e a gravação reais do app com portal simulado.
// Nenhum dado de paciente real, credencial ou acesso externo é utilizado.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const Portal=require('./portal.js');
const Parser=require('./parser.js');

function app(){
  const nodes=new Map(),storage=new Map();
  function node(id){
    if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:id==='fltPeriodo'?'all':id==='fltRows'?'painel':'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},querySelectorAll(){return [];},addEventListener(){},setAttribute(){}});
    return nodes.get(id);
  }
  const context=vm.createContext({console,Date,Math,Map,Set,URL,Uint8Array,Parser,
    window:{Parser,PortalLab:Portal},
    document:{getElementById:node,querySelectorAll:()=>[],addEventListener(){}},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    setTimeout:(fn,ms)=>{if(ms===0)queueMicrotask(fn);return 1;},clearTimeout(){},
  });
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  const code=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
  vm.runInContext(code,context);
  vm.runInContext(`DB={patients:[{id:'p',name:'Paciente Sintético',portal_access:{code:'12345678',password:'TESTONLY',portal_name:'Paciente Sintético'}}],encounters:[{id:'e',patient_id:'p',admission_date:'2025-01-01T08:00:00.000Z',portal_protocols:[]}],observations:[],events:[]};curPat=DB.patients[0];curEnc=DB.encounters[0];portalPdfText=async text=>({text,ocrPages:0});`,context);
  return {context,node,run:code=>vm.runInContext(code,context)};
}
const lab=date=>`KN CONTROLLAB
DATA DA COLETA.: ${date}
CREATININA
RESULTADO: 1,2 mg/dL
VALOR DE REFERÊNCIA: 0,7 a 1,3 mg/dL
UREIA
RESULTADO: 40 mg/dL
VALOR DE REFERÊNCIA: 15 a 45 mg/dL`;

async function main(){
  const {context,node,run}=app();
  const protocols=[
    {codigo:'30123456',dataHora:'2025-01-10T08:00:00',percExameProcessado:100},
    {codigo:'30123457',dataHora:'2026-08-16T08:00:00',percExameProcessado:100},
    {codigo:'30123458',dataHora:'2026-08-17T08:00:00',percExameProcessado:0},
  ];
  let downloads=0,queried;
  const client={patient:async()=>({NomePaciente:'Paciente Sintético'}),protocols:async(remote,start,end)=>{queried={start,end};return protocols;},pdf:async(remote,p)=>{downloads++;return lab(p.codigo==='30123456'?'10/01/2025':'16/08/2026');}};
  context.prepared={client,range:Portal.dateRange('2025-01-01','2026-09-05')};
  run(`DB.encounters[0].portal_protocols=[{protocol:'30-123456',version:'2025-01-10T08:00:00',added:0},{protocol:'30-123457',version:'2026-08-16T08:00:00',added:0}];`);
  await run(`runPortalSync('p','e',prepared)`);
  assert.equal(downloads,2,'ficha vazia relê protocolos marcados como processados');
  assert.equal(run('DB.observations.length'),4,'dois exames por laudo gravados');
  assert.match(node('importReviewBlock').innerHTML,/ainda não tem resultados liberados/,'protocolo sem liberação fica em nota');
  assert.equal(queried.start.getFullYear(),2025,'período longo chega ao portal');
  assert.match(node('folhaBody').innerHTML,/10\/01\/25/,'data antiga visível no quadro');
  assert.match(node('folhaBody').innerHTML,/16\/08\/26/,'data recente visível no quadro');
  const saved=JSON.parse(run('JSON.stringify(DB.observations)'));
  assert.deepEqual(saved.map(o=>[o.exam_name_normalized,o.value_numeric]),[['creatinina',1.2],['ureia',40],['creatinina',1.2],['ureia',40]]);
  await run(`runPortalSync('p','e',prepared)`);
  assert.equal(downloads,2,'atualização íntegra não baixa novamente');
  run(`DB.observations.splice(0,1)`);
  await run(`runPortalSync('p','e',prepared)`);
  assert.equal(downloads,3,'perda parcial recupera somente protocolo afetado');
  assert.equal(run('DB.observations.length'),4);
  run(`upsertManual('sodio','2026-08-16T08:00:00','139')`);
  const manual=run(`JSON.stringify(DB.observations.find(o=>o.source_type==='manual'))`);
  context.prepared={...context.prepared,force:true};
  await run(`runPortalSync('p','e',prepared)`);
  assert.equal(downloads,5,'reimportar todos baixa ambos os concluídos');
  assert.equal(run('DB.observations.length'),5,'reimportação não duplica valores');
  assert.equal(run(`JSON.stringify(DB.observations.find(o=>o.source_type==='manual'))`),manual,'valor manual preservado exatamente');
  client.pdf=async()=>{downloads++;return 'Documento incompatível';};
  await run(`runPortalSync('p','e',prepared)`);
  context.prepared={...context.prepared,force:false};
  await run(`runPortalSync('p','e',prepared)`);
  assert.equal(downloads,9,'recusa de leitura continua elegível para nova tentativa');
  assert.equal(run('DB.observations.length'),5,'recusa não apaga resultados existentes');
  client.pdf=async()=>{throw new Error('Falha simulada');};
  await run(`runPortalSync('p','e',prepared)`);
  assert.match(node('portalJobs').innerHTML,/2 falha/,'falhas visíveis e sem falso sucesso');

  // Liberação parcial -> repetição parcial -> completa, sem mudar versão.
  const partial=app();
  const partialProtocol={codigo:'30999999',dataHora:'2026-08-16T08:00:00',percExameProcessado:50};
  let partialDownloads=0;
  partial.context.prepared={client:{patient:client.patient,protocols:async()=>[partialProtocol],pdf:async()=>{partialDownloads++;return partialProtocol.percExameProcessado<100?lab('16/08/2026').split('\nUREIA')[0]+'\nLISTA DE EXAMES PENDENTES\nUREIA\nPrevisão de entrega: 17/08/2026':lab('16/08/2026');}}};
  await partial.run(`runPortalSync('p','e',prepared)`);
  assert.equal(partial.run('DB.observations.length'),1,'50% importa o único resultado liberado');
  assert.equal(partial.run('DB.observations[0].value_numeric'),1.2);
  assert.match(partial.node('importReviewBlock').innerHTML,/parcialmente liberado \(50%\)/,'nota de pendência visível');
  await partial.run(`runPortalSync('p','e',prepared)`);
  assert.equal(partial.run('DB.observations.length'),1,'repetir PDF parcial não duplica exame');
  partialProtocol.percExameProcessado=100;
  await partial.run(`runPortalSync('p','e',prepared)`);
  assert.equal(partialDownloads,3,'busca completa o protocolo sem exigir nova versão');
  assert.equal(partial.run('DB.observations.length'),2,'novo exame liberado entra');
  assert.equal(partial.run(`DB.observations.find(o=>o.exam_name_normalized==='ureia').value_numeric`),40,'valor vem do resultado, não da previsão');
  assert.equal(partial.node('importReviewBlock').innerHTML,'','nota desaparece após conclusão sem bloqueios');
  await partial.run(`runPortalSync('p','e',prepared)`);
  assert.equal(partialDownloads,3,'protocolo concluído íntegro deixa de ser baixado');
  partial.context.prepared.force=true;
  const workingPdf=partial.context.prepared.client.pdf;
  partial.context.prepared.client.pdf=async()=>{throw new Error('Erro transitório');};
  await partial.run(`runPortalSync('p','e',prepared)`);
  partial.context.prepared.force=false;
  partial.context.prepared.client.pdf=workingPdf;
  await partial.run(`runPortalSync('p','e',prepared)`);
  assert.equal(partialDownloads,4,'falha ao reimportar protocolo concluído permanece recuperável');
  assert.equal(partial.run('DB.observations.length'),2);

  // Mais de 20 páginas: não truncar o histórico de internações longas.
  const paging=new Portal.Client({code:'12345678',password:'TESTONLY'});paging.headers={};
  const pages=[];
  paging.request=async(route)=>{if(route.includes('FiltroPaginacao'))return {registros:[{paginas:21}]};const page=Number(new URL('https://test.invalid/'+route).searchParams.get('pagina'));pages.push(page);return {registros:[{codigo:String(page)}]};};
  const records=await paging.protocols({PacienteId:'p',InstituicaoId:'i'},new Date(2025,0,1),new Date(2026,8,5));
  assert.equal(records.length,21);assert.equal(pages.at(-1),21);
  paging.request=async()=>{throw new Error('Falha na paginação');};
  await assert.rejects(()=>paging.protocols({PacienteId:'p',InstituicaoId:'i'},new Date(),new Date()),/Falha na paginação/);
  console.log('Fluxo aprovado: ficha vazia, perda parcial, internação longa, liberação 50% → 100% sem duplicatas, notas de pendência, manuais preservados, recusas/falhas recuperáveis e paginação completa.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
