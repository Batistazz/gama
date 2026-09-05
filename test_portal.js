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

console.log(`${passes} teste(s) do portal passaram; ${failures} falharam.`);
if(failures)process.exit(1);
