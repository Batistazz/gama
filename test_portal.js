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

console.log(`${passes} teste(s) do portal passaram; ${failures} falharam.`);
if(failures)process.exit(1);
