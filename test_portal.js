const A=require('./portal.js');

let passes=0,failures=0;
function check(condition,message){
  if(condition)passes++;
  else{failures++;console.error('✗ '+message);}
}

const code='12345678',password='00654321';
const qr='https://app.lifesys.com.br/laudos/#/loginAutolac?codigo='+Buffer.from(code).toString('base64')+'&senha='+Buffer.from(password).toString('base64');
const parsed=A.parseQrUrl(qr);
check(parsed.code===code&&parsed.password===password,'lê código e senha do QR oficial');
check(A.samePatientName('Maria Souza','MARIA DE SOUZA'),'aceita partículas diferentes no nome');
check(!A.samePatientName('Maria Souza','Maria Oliveira'),'bloqueia pacientes diferentes');
check(!A.samePatientName('Maria','Maria Souza'),'nome curto não confirma identidade sozinho');
check(A.normalizeProtocol('30439749')==='30-439749','formata protocolo');
check(A.isComplete({percExameProcessado:100,visualizadoPaciente:'Novo'}),'aceita protocolo concluído');
check(!A.isComplete({percExameProcessado:90,visualizadoPaciente:'Novo'}),'recusa protocolo incompleto');
check(!A.isComplete({percExameProcessado:100,visualizadoPaciente:'Expirado'}),'recusa protocolo expirado');
check(A.formatApiDate(new Date(2026,7,12),false)==='2026-08-12 00:00:00','formata início do período');

let rejected=false;
try{A.parseQrUrl('https://exemplo.com/?codigo=abc&senha=def');}catch(e){rejected=true;}
check(rejected,'recusa QR de outro site');

const protocol={codigo:'30123456',dataHora:'2026-08-16T08:00:00',percExameProcessado:100};
const encounter={id:'e',portal_protocols:[{protocol:'30-123456',version:protocol.dataHora,result_count:2,pending:0}]};
const observations=[1,2].map(id=>({id,encounter_id:'e',source_type:'import',source_protocol:'30-123456'}));
check(A.needsImport(protocol,encounter,[],false),'ficha vazia recupera protocolo já registrado');
check(A.needsImport(protocol,encounter,observations.slice(0,1),false),'resultado apagado torna o protocolo elegível novamente');
check(!A.needsImport(protocol,encounter,observations,false),'busca incremental não repete protocolo íntegro');
check(A.needsImport(protocol,encounter,observations,true),'reimportação explícita relê protocolo íntegro');
check(A.needsImport({...protocol,percExameProcessado:90},encounter,observations,false),'protocolo parcial é consultado mesmo sem mudar versão');
check(!A.needsImport({...protocol,percExameProcessado:0},encounter,[],true),'protocolo sem resultados liberados não baixa PDF');
check(!A.needsImport({...protocol,visualizadoPaciente:'Expirado'},encounter,[],true),'reimportação não libera protocolo expirado');
check(A.needsImport(protocol,{...encounter,portal_protocols:[{protocol:'30-123456',version:protocol.dataHora,pending:1}]},observations,false),'protocolo com pendência pode ser tentado novamente');
check(A.needsImport(protocol,encounter,observations.map(o=>({...o,encounter_id:'outra'})),false),'outra internação não impede recuperação');
check(A.dateRange('2025-01-01','2026-09-05').start.getFullYear()===2025,'período aceita internação longa');
for(const dates of [['2026-09-06','2026-09-05'],['2026-02-30','2026-03-01'],['','2026-09-05']]){
  let blocked=false;try{A.dateRange(...dates);}catch(e){blocked=true;}
  check(blocked,'rejeita período inválido '+dates.join(' / '));
}

// QR de um laudo só: o portal devolve o laudo com PacienteId nulo (dados sintéticos).
const avulso={InstituicaoId:7,PacienteId:null,Id:991,Codigo:'30123456',PercExameProcessado:100,
  NomePaciente:'Paciente Sintético',DataHoraSolicitacao:'2026-09-15T11:52:00',DataUltimoEnvio:'2026-09-16T07:51:19'};
check(A.isSingleReport(avulso),'reconhece QR de laudo avulso');
check(!A.isSingleReport({...avulso,PacienteId:55}),'QR com paciente continua usando o histórico');
const unico=A.singleReportProtocol(avulso);
check(unico.id===991&&A.normalizeProtocol(unico.codigo)==='30-123456'&&A.isComplete(unico)&&unico.single_report,'laudo avulso vira um protocolo importável');
check(A.protocolVersion(unico)==='2026-09-16T07:51:19','reenvio do laudo muda a versão');
check(!A.isComplete(A.singleReportProtocol({...avulso,PercExameProcessado:40}))&&A.canImport(A.singleReportProtocol({...avulso,PercExameProcessado:40})),'laudo avulso parcial entra como parcial');

async function simulated(){
  const calls=[];
  const replies={
    'Autenticar':{access_token:'t',token_id:'i',token_type:'Bearer'},
    'Paciente/Laudos':avulso,
    'Laudo/Get':{Validade:'2056-09-16T00:00:00',Base64:'JVBERi0xLjQK',Stream:'JVBERi0xLjQK'}
  };
  global.fetch=async url=>{
    const path=url.slice(A.API_BASE.length);calls.push(path);
    const key=Object.keys(replies).find(k=>path.startsWith(k));
    if(!key)return {ok:false,status:404,text:async()=>''};
    return {ok:true,status:200,text:async()=>JSON.stringify(replies[key])};
  };
  const client=new A.Client({code,password});
  const remote=await client.patient();
  check(remote.Id===991,'patient() aceita o laudo avulso em vez de recusar o QR');
  const all=await client.protocols(remote,new Date(2026,8,1),new Date(2026,8,16));
  check(all.length===1&&all[0].id===991,'protocols() devolve o próprio laudo sem consultar lista por paciente');
  check(!calls.some(c=>/FiltroPaginacao|Paciente\/null/.test(c)),'nenhuma chamada com PacienteId nulo');
  check((await client.protocols(remote,new Date(2026,8,17),new Date(2026,8,20))).length===0,'laudo fora do período não aparece');
  const pdf=await client.pdf(remote,all[0]);
  const get=calls.find(c=>c.startsWith('Laudo/Get'));
  check(pdf==='JVBERi0xLjQK','pdf() baixa o laudo avulso');
  check(get&&get.includes('codigo='+encodeURIComponent(Buffer.from(code).toString('base64')))&&get.includes('historico=false'),'Laudo/Get usa o acesso do QR, sem histórico');
  replies['Paciente/Laudos']={...avulso,Id:null};
  let refused=false;try{await client.patient();}catch(e){refused=/não localizou/.test(e.message);}
  check(refused,'resposta sem paciente e sem laudo continua recusada');
}

simulated().then(()=>{
  console.log(`${passes} teste(s) do portal passaram; ${failures} falharam.`);
  if(failures)process.exit(1);
}).catch(e=>{console.error(e);process.exit(1);});
