(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.PortalLab=api;
})(typeof self!=='undefined'?self:this,function(){
  'use strict';

  const API_BASE='https://app.wmi.solutions/ws/api/laudos/api/';
  const QR_HOSTS=new Set(['app.lifesys.com.br','laudos.autolac.com.br']);

  function base64Encode(value){
    if(typeof btoa==='function')return btoa(unescape(encodeURIComponent(String(value))));
    return Buffer.from(String(value),'utf8').toString('base64');
  }
  function base64Decode(value){
    try{
      if(typeof atob==='function')return decodeURIComponent(escape(atob(String(value))));
      return Buffer.from(String(value),'base64').toString('utf8');
    }catch(e){ return ''; }
  }
  function normalizeName(value){
    return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  }
  function samePatientName(localName,portalName){
    const a=normalizeName(localName),b=normalizeName(portalName);
    if(!a||!b)return false;
    if(a===b)return true;
    const ignored=new Set(['da','das','de','do','dos','e']);
    const words=s=>s.split(' ').filter(x=>x&&!ignored.has(x));
    const aw=words(a),bw=words(b);
    if(aw.length<2||bw.length<2)return false;
    return aw[0]===bw[0]&&aw[aw.length-1]===bw[bw.length-1];
  }
  function normalizeProtocol(value){
    const digits=String(value==null?'':value).replace(/\D/g,'');
    if(digits.length<3)return String(value||'').trim();
    return digits.slice(0,2)+'-'+digits.slice(2);
  }
  function parseQrUrl(raw){
    let url;
    try{ url=new URL(String(raw||'')); }catch(e){ throw new Error('QR inválido.'); }
    if(!QR_HOSTS.has(url.hostname.toLowerCase()))throw new Error('Este QR não pertence ao portal de laudos.');
    const hashQuery=url.hash.includes('?')?url.hash.slice(url.hash.indexOf('?')+1):'';
    const params=new URLSearchParams(hashQuery||url.search.slice(1));
    const code=base64Decode(params.get('codigo')||'').trim();
    const password=base64Decode(params.get('senha')||'').trim();
    if(!/^\d{8,10}$/.test(code)||!/^[A-Za-z0-9]{4,20}$/.test(password))throw new Error('O QR não contém um acesso de paciente válido.');
    return {code,password};
  }
  function protocolVersion(item){
    return String(item&&(
      item.dataHora||item.dataHoraLiberacao||item.dataLiberacao||item.dataHoraSolicitacao||item.codigo
    )||'');
  }
  function isComplete(item){
    return Number(item&&item.percExameProcessado)>=100&&String(item&&item.visualizadoPaciente||'').toLowerCase()!=='expirado';
  }
  function canImport(item){
    return Number(item&&item.percExameProcessado)>0&&String(item&&item.visualizadoPaciente||'').toLowerCase()!=='expirado';
  }
  function needsImport(protocol,encounter,observations,force){
    if(!canImport(protocol))return false;
    // O portal pode liberar novos resultados sem mudar a versão do protocolo.
    if(force||!isComplete(protocol))return true;
    const code=normalizeProtocol(protocol.codigo),version=protocolVersion(protocol);
    const record=(encounter.portal_protocols||[]).find(x=>x.protocol===code&&x.version===version);
    if(!record)return true;
    const count=observations.filter(o=>o.encounter_id===encounter.id&&o.source_type==='import'&&o.source_protocol===code).length;
    // O histórico de tentativas não prova que os resultados continuam na ficha.
    return count===0||record.pending>0||record.result_count==null||count<record.result_count;
  }
  function dateRange(start,end){
    function parse(value){
      const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if(!m)throw new Error('Preencha as duas datas.');
      const date=new Date(+m[1],+m[2]-1,+m[3]);
      if(date.getFullYear()!==+m[1]||date.getMonth()!==+m[2]-1||date.getDate()!==+m[3])throw new Error('Data inválida.');
      return date;
    }
    const startDate=parse(start),endDate=parse(end);
    if(startDate>endDate)throw new Error('A data inicial deve ser anterior ou igual à final.');
    return {start:startDate,end:endDate};
  }
  function formatApiDate(date,endOfDay){
    const d=date instanceof Date?date:new Date(date);
    if(Number.isNaN(d.getTime()))throw new Error('Período de busca inválido.');
    const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day} ${endOfDay?'23:59:59':'00:00:00'}`;
  }
  function decodePdfBase64(value){
    const clean=String(value||'').replace(/^(?:data:application\/pdf;base64,)/i,'').replace(/(?:\\[rn]|[\r\n]+)+/g,'');
    if(!clean)throw new Error('O portal não devolveu o PDF deste protocolo.');
    return clean;
  }

  class Client{
    constructor(access){
      if(!access||!access.code||!access.password)throw new Error('Acesso do QR ausente.');
      this.access={code:String(access.code),password:String(access.password)};
      this.headers=null;
    }
    async request(path,options){
      let response;
      try{ response=await fetch(API_BASE+path,{mode:'cors',...(options||{})}); }
      catch(e){ throw new Error('O navegador não conseguiu acessar o portal. Verifique a internet.'); }
      if(!response.ok)throw new Error(`O portal respondeu com erro ${response.status}.`);
      const text=await response.text();
      if(!text)return null;
      try{return JSON.parse(text);}catch(e){throw new Error('O portal devolveu uma resposta inválida.');}
    }
    async authenticate(){
      const body=new URLSearchParams({
        grant_type:'password',client_id:'LifeSysLaudos',client_secret:base64Encode('4ut0m3tr1c2'),
        username:base64Encode(this.access.code),password:base64Encode(this.access.password),tipo:'paciente'
      }).toString();
      const auth=await this.request('Autenticar',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
      if(!auth||!auth.access_token||!auth.token_id)throw new Error('O portal não aceitou o acesso deste QR.');
      this.headers={Authorization:`${auth.token_type} ${auth.access_token}`,TokenId:auth.token_id,'Access-Control-Allow-Headers':auth.token_id};
      return true;
    }
    async patient(){
      if(!this.headers)await this.authenticate();
      const data=await this.request(`Paciente/Laudos?codigo=${encodeURIComponent(this.access.code)}&psw=${encodeURIComponent(this.access.password)}`,{headers:this.headers});
      if(!data||!data.PacienteId||!data.InstituicaoId)throw new Error('O portal não localizou o paciente deste QR.');
      return data;
    }
    async protocols(patient,startDate,endDate){
      if(!this.headers)await this.authenticate();
      const filter={dataInicio:formatApiDate(startDate,false),dataFim:formatApiDate(endDate,true),novos:false,paciente:null,pacienteCpf:null};
      const common={method:'POST',headers:{...this.headers,'Content-Type':'application/json'},body:JSON.stringify(filter)};
      const pagination=await this.request(`Paciente/${encodeURIComponent(patient.PacienteId)}/Laudos/FiltroPaginacao?idInstituicao=${encodeURIComponent(patient.InstituicaoId)}&quantidade=50`,common);
      const info=pagination&&Array.isArray(pagination.registros)?pagination.registros[0]:null;
      const total=Number(info&&info.paginas);
      if(!info||!Number.isSafeInteger(total)||total<0)throw new Error('Não consegui confirmar todas as páginas de exames. Tente consultar o período novamente.');
      const pages=Math.max(1,total);
      const all=[];
      for(let page=1;page<=pages;page++){
        const data=await this.request(`Paciente/${encodeURIComponent(patient.PacienteId)}/Laudos?IdInstituicao=${encodeURIComponent(patient.InstituicaoId)}&pagina=${page}&quantidade=50`,common);
        if(Array.isArray(data&&data.registros))all.push(...data.registros);
      }
      return all;
    }
    async pdf(patient,protocol){
      if(!this.headers)await this.authenticate();
      try{
        const data=await this.request(`Paciente/${encodeURIComponent(patient.PacienteId)}/Laudos/${encodeURIComponent(protocol.id)}`,{headers:this.headers});
        const row=data&&Array.isArray(data.registros)?data.registros[0]:null;
        return decodePdfBase64(row&&(row.laudo||row.stream));
      }catch(firstError){
        const data=await this.request(`laudo/baixarlaudosunificadospaciente?id=${encodeURIComponent(protocol.id)}`,{headers:this.headers});
        if(data&&Array.isArray(data.Falhas)&&data.Falhas.length)throw firstError;
        return decodePdfBase64(data&&data.Pdf);
      }
    }
  }

  return {API_BASE,Client,parseQrUrl,normalizeName,samePatientName,normalizeProtocol,protocolVersion,isComplete,canImport,needsImport,dateRange,formatApiDate,decodePdfBase64};
});
