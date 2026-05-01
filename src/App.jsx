import { useState, useEffect, useCallback, useRef } from "react";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CLIENT_ID  = "967483167289-m1ctc3ti8o12btnn44h63c94or34570d.apps.googleusercontent.com";
const API_KEY    = "AIzaSyALhdkEqgIVaW9wbWRpyDnB0ZEV2BFyrds";
const SCOPES     = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly";
const IMAGES_FOLDER = "1vfW6bExjG756ZSxSJ4Kn2-yx7DPRIB_6";

const SHEETS = {
  principal: "1CqmSrspUApYMlPmxogP1KhgybUK4yUQR",
  parceiros: {
    "Planet Kids Hair": "1-J32HhuPd0b3H8mKgkuB0APblydt8CwV0R82XECUoZU",
    "Ateliê Telma":     "1ZvloqW_edvgSLBp-5065D_c7XFElB9NEeQJra8NXCOA",
    "Bomboniere Lucia": "19ucXwNDz_x2yrrciinau6byMT-YLwmCfq6wnwr783N8",
    "Loja Big Net":     "1qVLvSQ2OiRE7VAhlz8uVb44FIiekDuDn2Fjd1cOKNVA",
    "Zancapel":         "1deStJmPAjBJhXoyh4qNtLXul_MCKbKAggVOzTEqRO6k",
  }
};

// ─── CUSTEIO (idêntico à planilha) ───────────────────────────────────────────
const CFG_GRAMA   = 0.08844;
const CUSTO_ARG   = 0.3681;
const TAXA_CEE    = 0.88;
const TAXA_TD     = 0.10;
const DEP_HORA    = 1.0;
const INVESTIMENTOS = { Equipamentos:6500, Instrumentos:251.03, Insumos:478.31, Filamentos:3803.06 };
const TOTAL_INV   = Object.values(INVESTIMENTOS).reduce((a,b)=>a+b,0);

function calcCusto(g, h, isChav=false) {
  const CFG = Number(g)*CFG_GRAMA;
  const TD  = CFG*TAXA_TD;
  const CEE = Number(h)*TAXA_CEE;
  const DEP = Number(h)*DEP_HORA;
  const adic= isChav ? CUSTO_ARG : 0;
  return { CFG, TD, CEE, DEP, adic, total: CFG+TD+CEE+DEP+adic };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const fmt = n => `R$\u00a0${Number(n||0).toFixed(2).replace(".",",").replace(/\B(?=(\d{3})+(?!\d))/g,".")}`;
const pct = n => `${(Number(n||0)*100).toFixed(1)}%`;
const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const TIPO_COR = { Chaveiro:"#7c3aed",Caixa:"#d97706",Vaso:"#059669",Utilidade:"#2563eb",Fidget:"#db2777",Estátua:"#9333ea",Brinquedo:"#dc2626",Letreiro:"#0891b2",Outros:"#6b7280",Enfeite:"#16a34a" };

function serialToDate(s) {
  const n = Number(s);
  if (!s || isNaN(n) || n < 1) return String(s||"");
  return new Date((n-25569)*86400*1000).toISOString().slice(0,10);
}

function rowsToObjects(rows) {
  if (!rows||rows.length<2) return [];
  const h = rows[0];
  return rows.slice(1).filter(r=>r.some(c=>c!=="")).map((r,i)=>{ const o={_row:i+2}; h.forEach((k,j)=>o[k]=r[j]??""); return o; });
}

function driveThumb(fileId, size=200) {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${size}`;
}

// ─── GOOGLE AUTH ──────────────────────────────────────────────────────────────
let tokenClient = null;
let accessToken = null;
let gapiReady   = false;
let gsiReady    = false;

function loadScript(src) {
  return new Promise(res => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = res;
    document.head.appendChild(s);
  });
}

async function initGapi() {
  await loadScript("https://apis.google.com/js/api.js");
  await new Promise(res => window.gapi.load("client", res));
  await window.gapi.client.init({ apiKey: API_KEY, discoveryDocs: ["https://sheets.googleapis.com/$discovery/rest?version=v4","https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"] });
  gapiReady = true;
}

async function initGsi() {
  await loadScript("https://accounts.google.com/gsi/client");
  gsiReady = true;
}

async function getToken() {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (resp) => {
          if (resp.error) { reject(resp.error); return; }
          accessToken = resp.access_token;
          window.gapi.client.setToken({ access_token: accessToken });
          resolve(accessToken);
        },
      });
    }
    if (accessToken) { resolve(accessToken); return; }
    tokenClient.requestAccessToken({ prompt: "" });
  });
}

// ─── SHEETS API (leitura e escrita) ──────────────────────────────────────────
async function readRange(sheetId, range) {
  await getToken();
  const res = await window.gapi.client.sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
  return res.result.values || [];
}

async function appendRow(sheetId, range, values) {
  await getToken();
  await window.gapi.client.sheets.spreadsheets.values.append({
    spreadsheetId: sheetId, range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    resource: { values: [values] }
  });
}

async function updateCell(sheetId, range, value) {
  await getToken();
  await window.gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId: sheetId, range,
    valueInputOption: "USER_ENTERED",
    resource: { values: [[value]] }
  });
}

// Busca arquivos de imagem na pasta do Drive
async function listDriveImages() {
  await getToken();
  const res = await window.gapi.client.drive.files.list({
    q: `'${IMAGES_FOLDER}' in parents and mimeType contains 'image/'`,
    fields: "files(id,name)",
    pageSize: 500
  });
  return res.result.files || [];
}

// ─── COMPONENTES BASE ─────────────────────────────────────────────────────────
const Badge = ({ label, color }) => {
  const C = { green:["#d1fae5","#065f46"],yellow:["#fef3c7","#92400e"],red:["#fee2e2","#991b1b"],blue:["#dbeafe","#1e40af"],gray:["#f3f4f6","#374151"],purple:["#ede9fe","#5b21b6"],orange:["#ffedd5","#9a3412"] }[color]||["#f3f4f6","#374151"];
  return <span style={{background:C[0],color:C[1],borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:700}}>{label}</span>;
};

const KPI = ({ label, value, sub, accent }) => (
  <div style={{background:"#fff",borderRadius:12,padding:"16px 20px",borderLeft:`4px solid ${accent}`,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
    <div style={{fontSize:10,color:"#9ca3af",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em"}}>{label}</div>
    <div style={{fontSize:22,fontWeight:900,color:"#111827",marginTop:3}}>{value}</div>
    {sub && <div style={{fontSize:11,color:"#9ca3af",marginTop:2}}>{sub}</div>}
  </div>
);

function Spin({ msg }) {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:60,gap:14}}>
      <div style={{width:36,height:36,border:"3px solid #e5e7eb",borderTop:"3px solid #4f46e5",borderRadius:"50%",animation:"sp 0.8s linear infinite"}}/>
      <div style={{fontSize:13,color:"#6b7280"}}>{msg||"Carregando..."}</div>
      <style>{`@keyframes sp{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function Err({ msg, onRetry }) {
  return (
    <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:12,padding:"18px 22px",margin:"16px 0"}}>
      <div style={{fontWeight:700,color:"#991b1b",marginBottom:6}}>⚠️ Erro ao carregar dados</div>
      <div style={{fontSize:13,color:"#7f1d1d",marginBottom:10}}>{msg}</div>
      <div style={{fontSize:12,color:"#9ca3af",marginBottom:12}}>Certifique-se de que a planilha está compartilhada como "Qualquer pessoa com o link pode visualizar".</div>
      {onRetry && <button onClick={onRetry} style={{padding:"7px 16px",borderRadius:8,border:"none",background:"#4f46e5",color:"#fff",fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Tentar novamente</button>}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#fff",borderRadius:18,padding:28,maxWidth:660,width:"100%",maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
          <h3 style={{margin:0,fontSize:17,fontWeight:800}}>{title}</h3>
          <button onClick={onClose} style={{border:"none",background:"#f3f4f6",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:16}}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type="text", options, required, half }) {
  const style = {width:"100%",padding:"8px 11px",borderRadius:9,border:"1px solid #d1d5db",fontSize:13,fontFamily:"inherit",boxSizing:"border-box",outline:"none"};
  return (
    <div style={{gridColumn:half?"span 1":"span 2"}}>
      {label && <label style={{display:"block",fontSize:12,fontWeight:600,color:"#374151",marginBottom:5}}>{label}{required&&<span style={{color:"#ef4444"}}> *</span>}</label>}
      {options
        ? <select value={value} onChange={e=>onChange(e.target.value)} style={style}><option value="">Selecione...</option>{options.map(o=><option key={o} value={o}>{o}</option>)}</select>
        : <input type={type} value={value} onChange={e=>onChange(e.target.value)} style={style}/>}
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function Login({ onLogin, loading }) {
  return (
    <div style={{minHeight:"100vh",background:"#18181b",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Segoe UI',-apple-system,sans-serif"}}>
      <div style={{background:"#27272a",borderRadius:24,padding:"48px 52px",textAlign:"center",maxWidth:420,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.4)"}}>
        <div style={{width:64,height:64,background:"linear-gradient(135deg,#4f46e5,#7c3aed)",borderRadius:18,margin:"0 auto 24px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>🖨️</div>
        <h1 style={{color:"#fff",fontWeight:900,fontSize:28,margin:"0 0 8px",letterSpacing:"-0.03em"}}>Amalello Design</h1>
        <p style={{color:"#71717a",fontSize:14,margin:"0 0 36px"}}>Sistema de gestão · Impressão 3D</p>
        <button onClick={onLogin} disabled={loading} style={{width:"100%",padding:"14px",borderRadius:12,border:"none",background:loading?"#3f3f46":"#4f46e5",color:"#fff",fontWeight:800,fontSize:15,cursor:loading?"not-allowed":"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
          {loading ? <><div style={{width:20,height:20,border:"2px solid rgba(255,255,255,0.3)",borderTop:"2px solid #fff",borderRadius:"50%",animation:"sp 0.8s linear infinite"}}/> Entrando...</> : <><svg width="20" height="20" viewBox="0 0 48 48"><path fill="#4285F4" d="M44.5 20H24v8.5h11.7C34.7 33.9 30 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/></svg>Entrar com Google</>}
        </button>
        <p style={{color:"#52525b",fontSize:12,marginTop:20}}>Acesso restrito · Eduardo & Isabela · Parceiros</p>
        <style>{`@keyframes sp{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ pedidos, loading, erro, onRetry, ultimaAtt }) {
  if (loading) return <Spin msg="Carregando pedidos da planilha..." />;
  if (erro) return <Err msg={erro} onRetry={onRetry} />;

  const ok     = pedidos.filter(p=>p.Realizado==="Sim"&&p.Entregue==="Sim"&&p.Pago==="Sim");
  const vendOK = ok.reduce((s,p)=>s+Number(p.Valor||0),0);
  const pot    = pedidos.filter(p=>p.Realizado==="Sim"&&(p.Entregue==="Sim"||p.Entregue==="Consignado")&&p.Pago==="Não");
  const valPot = pot.reduce((s,p)=>s+Number(p.Valor||0),0);
  const aProd  = pedidos.filter(p=>p.Realizado!=="Sim"&&p.Realizado!=="Lead"!==false).length;
  const aEnt   = pedidos.filter(p=>p.Realizado==="Sim"&&p.Entregue==="Não").length;
  const aCob   = pedidos.filter(p=>(p.Entregue==="Sim"||p.Entregue==="Consignado")&&p.Pago==="Não").length;
  const saldo  = vendOK - TOTAL_INV;
  const payPct = Math.min((vendOK/TOTAL_INV)*100, 100);

  const porMes = {};
  pedidos.forEach(p => {
    const d = serialToDate(p["Data Venda"]||"");
    if (!d||d.length<7) return;
    const m = new Date(d).getMonth();
    if (!porMes[m]) porMes[m]=0;
    if (p.Pago==="Sim") porMes[m]+=Number(p.Valor||0);
  });
  const mesE = Object.entries(porMes);
  const maxV = Math.max(...mesE.map(([,v])=>v),1);

  return (
    <div>
      <div style={{marginBottom:22}}>
        <h2 style={{fontSize:22,fontWeight:900,color:"#111827",margin:0}}>Dashboard</h2>
        <p style={{color:"#6b7280",marginTop:4,fontSize:13}}>{pedidos.length} pedidos · {ultimaAtt ? `Atualizado ${ultimaAtt}` : "Sincronizando..."}</p>
      </div>

      {/* Payback */}
      <div style={{background:saldo>=0?"#f0fdf4":"#fef2f2",borderRadius:14,padding:"18px 22px",marginBottom:18,border:`1px solid ${saldo>=0?"#bbf7d0":"#fecaca"}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div>
            <div style={{fontWeight:800,fontSize:15,color:saldo>=0?"#15803d":"#b91c1c"}}>{saldo>=0?"✅ Operação POSITIVA":"⚠️ Operação ainda no NEGATIVO"}</div>
            <div style={{fontSize:12,color:"#6b7280",marginTop:2}}>Investido: {fmt(TOTAL_INV)} · Recebido OK: {fmt(vendOK)} · Saldo: <strong style={{color:saldo>=0?"#15803d":"#b91c1c"}}>{fmt(saldo)}</strong></div>
          </div>
          <div style={{fontSize:24,fontWeight:900,color:saldo>=0?"#15803d":"#b91c1c"}}>{payPct.toFixed(0)}%</div>
        </div>
        <div style={{background:"rgba(0,0,0,0.08)",borderRadius:20,height:10}}>
          <div style={{width:`${payPct}%`,background:saldo>=0?"#16a34a":"#ef4444",height:"100%",borderRadius:20,transition:"width 0.6s"}}/>
        </div>
        <div style={{fontSize:11,color:"#9ca3af",marginTop:5}}>Payback: {payPct.toFixed(1)}% do investimento recuperado</div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(175px,1fr))",gap:12,marginBottom:18}}>
        <KPI label="Vendas Confirmadas" value={fmt(vendOK)} sub={`${ok.length} pedidos OK`} accent="#4f46e5"/>
        <KPI label="Potencial a Receber" value={fmt(valPot)} sub={`${pot.length} pendentes`} accent="#d97706"/>
        <KPI label="Total Investido" value={fmt(TOTAL_INV)} sub="Equip+Filam+Insumos" accent="#ef4444"/>
        <KPI label="Saldo Atual" value={fmt(saldo)} sub={saldo<0?"A recuperar":"Lucro líquido"} accent={saldo<0?"#ef4444":"#16a34a"}/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:22}}>
        {[["A Produzir",aProd,"#dc2626","#fef2f2"],["A Entregar",aEnt,"#d97706","#fffbeb"],["A Cobrar",aCob,"#7c3aed","#f5f3ff"]].map(([l,v,c,bg])=>(
          <div key={l} style={{background:bg,borderRadius:14,padding:"18px 20px",textAlign:"center"}}>
            <div style={{fontSize:36,fontWeight:900,color:c}}>{v}</div>
            <div style={{fontSize:12,fontWeight:700,color:c,opacity:0.8}}>{l}</div>
          </div>
        ))}
      </div>

      {mesE.length>0 && (
        <div style={{background:"#fff",borderRadius:14,padding:22,border:"1px solid #e5e7eb"}}>
          <div style={{fontWeight:700,fontSize:14,color:"#111827",marginBottom:14}}>Faturamento confirmado por mês</div>
          <div style={{display:"flex",alignItems:"flex-end",gap:10,height:110}}>
            {mesE.map(([m,v])=>(
              <div key={m} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                <div style={{fontSize:9,color:"#9ca3af"}}>{fmt(v).replace("R$\u00a0","")}</div>
                <div style={{width:"100%",background:"#4f46e5",borderRadius:"5px 5px 0 0",height:`${(v/maxV)*80}px`,minHeight:4}}/>
                <div style={{fontSize:11,color:"#6b7280"}}>{MESES[Number(m)]}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PEDIDOS ──────────────────────────────────────────────────────────────────
function Pedidos({ pedidos, loading, erro, onRetry, filter, onAddPedido, skus }) {
  const [busca, setBusca] = useState("");
  const [det,   setDet]   = useState(null);
  const [novo,  setNovo]  = useState(false);
  const [saving, setSaving] = useState(false);
  const [form,  setForm]  = useState({ data:"", pessoa:"", impressao:"", familia:"", cor:"", realizado:"Não", entregue:"Não", pago:"Não", qtd:1, preco:"" });

  if (loading) return <Spin msg="Carregando pedidos..." />;
  if (erro)    return <Err msg={erro} onRetry={onRetry} />;

  const titulo = {produzir:"A Produzir",entregar:"A Entregar",cobrar:"A Cobrar"}[filter]||"Todos os Pedidos";
  const filtrados = pedidos.filter(p => {
    const b = !busca||(p.Pessoa||"").toLowerCase().includes(busca.toLowerCase())||(p.Impressão||"").toLowerCase().includes(busca.toLowerCase());
    if (filter==="produzir") return b&&p.Realizado!=="Sim";
    if (filter==="entregar") return b&&p.Realizado==="Sim"&&p.Entregue==="Não";
    if (filter==="cobrar")   return b&&(p.Entregue==="Sim"||p.Entregue==="Consignado")&&p.Pago==="Não";
    return b;
  });

  const getBadge = p => {
    if (p.Realizado==="Lead")  return <Badge label="Lead" color="blue"/>;
    if (p.Realizado!=="Sim")   return <Badge label="Produzir" color="red"/>;
    if (p.Entregue==="Não")    return <Badge label="Entregar" color="yellow"/>;
    if (p.Pago==="Não")        return <Badge label="Cobrar" color="purple"/>;
    if (p.Pago==="Brinde")     return <Badge label="Brinde" color="orange"/>;
    return <Badge label="OK ✓" color="green"/>;
  };

  const salvarNovo = async () => {
    if (!form.data||!form.pessoa||!form.impressao) return;
    setSaving(true);
    const sku = skus.find(s=>(s.Impressão||s.nome||"")===form.impressao);
    const gramas = sku?.FilamentoUnitario||sku?.gramas||0;
    const horas  = sku?.TempoemHora||sku?.horas||0;
    const isChav = (sku?.Tipo||sku?.tipo||"")==="Chaveiro";
    const { total } = calcCusto(gramas, horas, isChav);
    const qtd = Number(form.qtd)||1;
    const preco = Number(form.preco)||0;
    const valor = preco * qtd;
    // linha para planilha: ordem das colunas da aba Pedidos
    const row = [
      form.data, form.pessoa, form.impressao, form.familia, form.cor,
      form.realizado, form.entregue, form.pago, form.pago==="Sim"&&form.entregue==="Sim"&&form.realizado==="Sim"?"OK":"Check",
      "", qtd, preco, valor, form.pago==="Sim"?valor:0,
      gramas, horas, total, 0,
    ];
    try {
      await appendRow(SHEETS.principal, "Pedidos!A:R", row);
      await onAddPedido();
      setNovo(false);
      setForm({ data:"",pessoa:"",impressao:"",familia:"",cor:"",realizado:"Não",entregue:"Não",pago:"Não",qtd:1,preco:"" });
    } catch(e) { alert("Erro ao salvar: "+e.message); }
    setSaving(false);
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18}}>
        <div>
          <h2 style={{fontSize:20,fontWeight:900,color:"#111827",margin:0}}>{titulo}</h2>
          <p style={{color:"#6b7280",marginTop:4,fontSize:13}}>{filtrados.length} pedido(s)</p>
        </div>
        <button onClick={()=>setNovo(true)} style={{padding:"9px 18px",borderRadius:9,border:"none",background:"#4f46e5",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>+ Novo Pedido</button>
      </div>

      <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar cliente ou produto..." style={{width:"100%",padding:"9px 14px",borderRadius:10,border:"1px solid #d1d5db",fontSize:13,fontFamily:"inherit",outline:"none",marginBottom:14,boxSizing:"border-box"}}/>

      <div style={{background:"#fff",borderRadius:14,border:"1px solid #e5e7eb",overflow:"hidden"}}>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr style={{background:"#f9fafb",borderBottom:"1px solid #e5e7eb"}}>
                {["Data","Cliente","Produto","Família","Cor","Qtd","Valor","Realiz.","Entreg.","Pago","Status",""].map(h=>(
                  <th key={h} style={{padding:"10px 12px",textAlign:"left",fontWeight:700,color:"#374151",fontSize:11,whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtrados.map((p,i)=>{
                const data = serialToDate(p["Data Venda"]||"");
                return (
                  <tr key={i} style={{borderBottom:"1px solid #f3f4f6",background:i%2===0?"#fff":"#fafafa"}}>
                    <td style={{padding:"8px 12px",color:"#6b7280",whiteSpace:"nowrap"}}>{data.slice(5)}</td>
                    <td style={{padding:"8px 12px",fontWeight:600,color:"#111827",maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.Pessoa}</td>
                    <td style={{padding:"8px 12px",color:"#374151",maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.Impressão}</td>
                    <td style={{padding:"8px 12px",color:"#6b7280"}}>{p.Familia}</td>
                    <td style={{padding:"8px 12px",color:"#6b7280"}}>{p.Cor}</td>
                    <td style={{padding:"8px 12px",textAlign:"center",fontWeight:700}}>{p.Qtdd||1}</td>
                    <td style={{padding:"8px 12px",fontWeight:800,color:"#4f46e5"}}>{fmt(p.Valor)}</td>
                    <td style={{padding:"8px 12px"}}><Badge label={p.Realizado||"?"} color={p.Realizado==="Sim"?"green":p.Realizado==="Lead"?"blue":"red"}/></td>
                    <td style={{padding:"8px 12px"}}><Badge label={p.Entregue||"?"} color={p.Entregue==="Sim"?"green":p.Entregue==="Consignado"?"blue":"yellow"}/></td>
                    <td style={{padding:"8px 12px"}}><Badge label={p.Pago||"?"} color={p.Pago==="Sim"?"green":p.Pago==="Brinde"?"orange":"yellow"}/></td>
                    <td style={{padding:"8px 12px"}}>{getBadge(p)}</td>
                    <td style={{padding:"8px 12px"}}><button onClick={()=>setDet(p)} style={{padding:"4px 10px",borderRadius:7,border:"none",background:"#f3f4f6",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>Ver</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtrados.length===0&&<div style={{padding:40,textAlign:"center",color:"#9ca3af",fontSize:13}}>Nenhum pedido encontrado</div>}
      </div>

      <div style={{marginTop:12,display:"flex",gap:20,fontSize:13,color:"#6b7280"}}>
        <span>Total: <strong style={{color:"#4f46e5"}}>{fmt(filtrados.reduce((s,p)=>s+Number(p.Valor||0),0))}</strong></span>
        <span>Recebido: <strong style={{color:"#16a34a"}}>{fmt(filtrados.filter(p=>p.Pago==="Sim").reduce((s,p)=>s+Number(p.Valor||0),0))}</strong></span>
      </div>

      {/* Modal novo pedido */}
      {novo && (
        <Modal title="Novo Pedido" onClose={()=>setNovo(false)}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            <Field label="Data" value={form.data} onChange={v=>setForm(p=>({...p,data:v}))} type="date" required half/>
            <Field label="Cliente" value={form.pessoa} onChange={v=>setForm(p=>({...p,pessoa:v}))} required half/>
            <Field label="Produto" value={form.impressao} onChange={v=>setForm(p=>({...p,impressao:v}))} options={skus.map(s=>s.Impressão||s.nome||"").filter(Boolean)} required/>
            <Field label="Família" value={form.familia} onChange={v=>setForm(p=>({...p,familia:v}))} options={["Utilidade","Enfeite","Caixa","Chaveiro","Vaso","Estátua","Fidget","Brinquedo","Letreiro","Outros"]} half/>
            <Field label="Cor" value={form.cor} onChange={v=>setForm(p=>({...p,cor:v}))} half/>
            <Field label="Quantidade" value={form.qtd} onChange={v=>setForm(p=>({...p,qtd:v}))} type="number" half/>
            <Field label="Preço unitário (R$)" value={form.preco} onChange={v=>setForm(p=>({...p,preco:v}))} type="number" half/>
            <Field label="Realizado" value={form.realizado} onChange={v=>setForm(p=>({...p,realizado:v}))} options={["Sim","Não","Lead"]} half/>
            <Field label="Entregue" value={form.entregue} onChange={v=>setForm(p=>({...p,entregue:v}))} options={["Sim","Não","Consignado"]} half/>
            <Field label="Pago" value={form.pago} onChange={v=>setForm(p=>({...p,pago:v}))} options={["Sim","Não","Brinde"]} half/>
          </div>
          {form.preco&&form.impressao&&(()=>{
            const sku = skus.find(s=>(s.Impressão||s.nome||"")===form.impressao);
            if (!sku) return null;
            const {total}=calcCusto(sku.FilamentoUnitario||0,sku.TempoemHora||0,(sku.Tipo||"")==="Chaveiro");
            const preco=Number(form.preco); const lucro=preco-total; const margem=preco>0?lucro/preco:0;
            return (
              <div style={{marginTop:14,background:"#f0fdf4",borderRadius:10,padding:"11px 16px",fontSize:13}}>
                Custo: <strong style={{color:"#dc2626"}}>{fmt(total)}</strong> · Lucro: <strong style={{color:lucro>0?"#16a34a":"#ef4444"}}>{fmt(lucro)}</strong> · Margem: <strong style={{color:"#4f46e5"}}>{pct(margem)}</strong> · Markup: <strong>×{(preco/total).toFixed(2)}</strong>
              </div>
            );
          })()}
          <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginTop:20}}>
            <button onClick={()=>setNovo(false)} style={{padding:"8px 16px",borderRadius:9,border:"none",background:"#f3f4f6",color:"#374151",fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Cancelar</button>
            <button onClick={salvarNovo} disabled={saving} style={{padding:"8px 20px",borderRadius:9,border:"none",background:saving?"#9ca3af":"#4f46e5",color:"#fff",fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              {saving?"Salvando na planilha...":"💾 Salvar no Google Sheets"}
            </button>
          </div>
        </Modal>
      )}

      {/* Modal detalhes */}
      {det&&(()=>{
        const isChav=(det.Familia||"")==="Chaveiro";
        const g=Number(det["Filamento (gramas)"]||det.FilamentoUnitario||0);
        const h=Number(det["Tempo (h)"]||det.TempoemHora||0);
        const {CFG,TD,CEE,DEP,adic,total}=calcCusto(g,h,isChav);
        const preco=Number(det["Preço unitário"]||det.Valor||0);
        const lucro=preco-total; const margem=preco>0?lucro/preco:0; const fator=total>0?preco/total:0;
        return (
          <Modal title={`Detalhes · ${det.Impressão}`} onClose={()=>setDet(null)}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:18}}>
              <div style={{background:"#f9fafb",borderRadius:10,padding:14}}>
                <div style={{fontSize:10,fontWeight:700,color:"#9ca3af",textTransform:"uppercase",marginBottom:10}}>Pedido</div>
                {[["Cliente",det.Pessoa],["Data",serialToDate(det["Data Venda"]||"")],["Produto",det.Impressão],["Cor",det.Cor],["Qtd",det.Qtdd||1],["Preço",fmt(preco)],["Total",fmt(Number(det.Valor||0))]].map(([k,v])=>(
                  <div key={k} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"4px 0",borderBottom:"1px solid #e5e7eb"}}>
                    <span style={{color:"#6b7280"}}>{k}</span><span style={{fontWeight:600}}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{background:"#f0fdf4",borderRadius:10,padding:14}}>
                <div style={{fontSize:10,fontWeight:700,color:"#065f46",textTransform:"uppercase",marginBottom:10}}>Custo de Produção</div>
                {[["Filamento (CFG)",fmt(CFG)],["Desperdício 10%",fmt(TD)],["Energia (CEE)",fmt(CEE)],["Depreciação",fmt(DEP)],["Adicional",fmt(adic)]].map(([k,v])=>(
                  <div key={k} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"4px 0",borderBottom:"1px solid #d1fae5"}}>
                    <span style={{color:"#374151"}}>{k}</span><span style={{fontWeight:600}}>{v}</span>
                  </div>
                ))}
                <div style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"8px 0 0",fontWeight:900}}>
                  <span>Custo Total</span><span style={{color:"#dc2626"}}>{fmt(total)}</span>
                </div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
              {[["Lucro/peça",fmt(lucro),lucro>0?"#16a34a":"#ef4444"],["Margem %",pct(margem),"#4f46e5"],["Markup",`×${fator.toFixed(2)}`,"#d97706"]].map(([l,v,c])=>(
                <div key={l} style={{background:"#f9fafb",borderRadius:10,padding:"12px 14px",textAlign:"center"}}>
                  <div style={{fontSize:10,color:"#9ca3af",fontWeight:700}}>{l}</div>
                  <div style={{fontSize:20,fontWeight:900,color:c,marginTop:4}}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{marginTop:12,padding:"10px 14px",background:fator>=2?"#f0fdf4":"#fef2f2",borderRadius:10,fontSize:13,color:fator>=2?"#15803d":"#b91c1c"}}>
              {fator>=2?`✅ Markup ×${fator.toFixed(2)} — saudável (≥2×)`:`⚠️ Markup ×${fator.toFixed(2)} — abaixo do recomendado. Sugestão: ${fmt(total*2.5)}`}
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

// ─── PRODUTOS ─────────────────────────────────────────────────────────────────
function Produtos({ skus, driveImages, loading, erro, onRetry, onAddSku }) {
  const [busca, setBusca]   = useState("");
  const [tipo,  setTipo]    = useState("todos");
  const [novo,  setNovo]    = useState(false);
  const [saving,setSaving]  = useState(false);
  const [form,  setForm]    = useState({ nome:"", tipo:"Utilidade", gramas:"", horas:"", isChaveiro:false, linkMaker:"" });

  if (loading) return <Spin msg="Carregando SKUs da planilha..." />;
  if (erro)    return <Err msg={erro} onRetry={onRetry} />;

  const tipos = [...new Set(skus.map(s=>s.Tipo||s.tipo||""))].filter(Boolean).sort();
  const filtrados = skus.filter(s => {
    const b = !busca||(s.Impressão||"").toLowerCase().includes(busca.toLowerCase());
    const t = tipo==="todos"||(s.Tipo||s.tipo||"")===tipo;
    return b&&t;
  });

  // Mapeia nome do arquivo para ID do Drive
  const imgMap = {};
  driveImages.forEach(f => { imgMap[f.name]=f.id; });

  function getImgUrl(sku) {
    const foto = sku.Foto||"";
    // tenta pelo nome do arquivo registrado na planilha
    const fname = foto.split("/").pop();
    if (imgMap[fname]) return driveThumb(imgMap[fname], 240);
    // tenta extrair ID do Drive do campo Foto
    const match = foto.match(/[-\w]{25,}/);
    if (match) return driveThumb(match[0], 240);
    // busca pelo código do SKU
    const codigo = sku.Codigo||sku.id||"";
    const byCode = Object.entries(imgMap).find(([n])=>n.startsWith(codigo));
    if (byCode) return driveThumb(byCode[1], 240);
    return null;
  }

  const salvarNovo = async () => {
    if (!form.nome||!form.gramas||!form.horas) return;
    setSaving(true);
    const id = Math.random().toString(16).slice(2,10);
    const row = [id, form.nome, Number(form.gramas), Number(form.horas), form.tipo, form.linkMaker, ""];
    try {
      await appendRow(SHEETS.principal, "Controle de Skus!A:G", row);
      await onAddSku();
      setNovo(false);
      setForm({nome:"",tipo:"Utilidade",gramas:"",horas:"",isChaveiro:false,linkMaker:""});
    } catch(e) { alert("Erro ao salvar SKU: "+e.message); }
    setSaving(false);
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18}}>
        <div>
          <h2 style={{fontSize:20,fontWeight:900,color:"#111827",margin:0}}>Produtos / SKUs</h2>
          <p style={{color:"#6b7280",marginTop:4,fontSize:13}}>{skus.length} produtos · sincronizado com AppSheet via Google Sheets</p>
        </div>
        <button onClick={()=>setNovo(true)} style={{padding:"9px 18px",borderRadius:9,border:"none",background:"#4f46e5",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>+ Novo SKU</button>
      </div>

      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
        <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar produto..." style={{flex:1,minWidth:180,padding:"8px 13px",borderRadius:9,border:"1px solid #d1d5db",fontSize:13,fontFamily:"inherit",outline:"none"}}/>
        <select value={tipo} onChange={e=>setTipo(e.target.value)} style={{padding:"8px 12px",borderRadius:9,border:"1px solid #d1d5db",fontSize:13,fontFamily:"inherit",background:"#fff"}}>
          <option value="todos">Todos os tipos</option>
          {tipos.map(t=><option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(255px,1fr))",gap:14}}>
        {filtrados.map((s,i)=>{
          const nome  = s.Impressão||"";
          const tipoS = s.Tipo||"Outros";
          const g     = Number(s.FilamentoUnitario||0);
          const h     = Number(s.TempoemHora||0);
          const {total} = calcCusto(g, h, tipoS==="Chaveiro");
          const tc    = TIPO_COR[tipoS]||"#6b7280";
          const imgUrl = getImgUrl(s);
          return (
            <div key={i} style={{background:"#fff",borderRadius:14,border:"1px solid #e5e7eb",overflow:"hidden"}}>
              <div style={{background:tc,padding:"10px 14px",display:"flex",justifyContent:"space-between"}}>
                <span style={{color:"#fff",fontWeight:800,fontSize:12}}>{tipoS}</span>
                <span style={{color:"rgba(255,255,255,0.6)",fontSize:10}}>{(s.Codigo||"").slice(0,8)}</span>
              </div>
              {imgUrl ? (
                <div style={{height:130,overflow:"hidden",background:"#f3f4f6",position:"relative"}}>
                  <img src={imgUrl} alt={nome} style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{e.target.parentElement.innerHTML='<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:32px;background:#f9fafb">🖨️</div>';}}/>
                </div>
              ) : (
                <div style={{height:80,background:`${tc}15`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:30}}>🖨️</div>
              )}
              <div style={{padding:14}}>
                <div style={{fontWeight:800,fontSize:14,color:"#111827",marginBottom:10}}>{nome}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,fontSize:12}}>
                  <div style={{background:"#f9fafb",borderRadius:8,padding:"5px 8px"}}>
                    <div style={{color:"#9ca3af",fontSize:10}}>Filamento</div>
                    <div style={{fontWeight:700}}>{g}g</div>
                  </div>
                  <div style={{background:"#f9fafb",borderRadius:8,padding:"5px 8px"}}>
                    <div style={{color:"#9ca3af",fontSize:10}}>Tempo</div>
                    <div style={{fontWeight:700}}>{h}h</div>
                  </div>
                  <div style={{background:"#fef2f2",borderRadius:8,padding:"5px 8px"}}>
                    <div style={{color:"#9ca3af",fontSize:10}}>Custo</div>
                    <div style={{fontWeight:800,color:"#dc2626"}}>{fmt(total)}</div>
                  </div>
                  <div style={{background:"#f5f3ff",borderRadius:8,padding:"5px 8px"}}>
                    <div style={{color:"#9ca3af",fontSize:10}}>Venda (2.5×)</div>
                    <div style={{fontWeight:800,color:"#7c3aed"}}>{fmt(total*2.5)}</div>
                  </div>
                </div>
                <div style={{marginTop:8,background:"#f0fdf4",borderRadius:8,padding:"5px 10px",display:"flex",justifyContent:"space-between",fontSize:11}}>
                  <span style={{color:"#6b7280"}}>Consignação (1.8×)</span>
                  <span style={{fontWeight:700,color:"#15803d"}}>{fmt(total*1.8)}</span>
                </div>
                {s["Link Maker "]&&<a href={s["Link Maker "]} target="_blank" rel="noreferrer" style={{display:"block",marginTop:8,fontSize:11,color:"#4f46e5",textDecoration:"none",textAlign:"center",background:"#eef2ff",padding:"5px",borderRadius:7}}>Ver no MakerWorld ↗</a>}
              </div>
            </div>
          );
        })}
      </div>

      {novo && (
        <Modal title="Novo Produto (SKU)" onClose={()=>setNovo(false)}>
          <div style={{background:"#fef3c7",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#92400e"}}>
            💡 Ao salvar, o produto será gravado diretamente no Google Sheets e ficará disponível no AppSheet automaticamente.
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            <Field label="Nome do produto" value={form.nome} onChange={v=>setForm(p=>({...p,nome:v}))} required/>
            <Field label="Tipo" value={form.tipo} onChange={v=>setForm(p=>({...p,tipo:v}))} options={["Utilidade","Enfeite","Caixa","Chaveiro","Vaso","Estátua","Fidget","Brinquedo","Letreiro","Outros"]} half/>
            <Field label="Filamento (gramas)" value={form.gramas} onChange={v=>setForm(p=>({...p,gramas:v}))} type="number" required half/>
            <Field label="Tempo (horas)" value={form.horas} onChange={v=>setForm(p=>({...p,horas:v}))} type="number" required half/>
            <Field label="Link MakerWorld" value={form.linkMaker} onChange={v=>setForm(p=>({...p,linkMaker:v}))}/>
          </div>
          {form.gramas&&form.horas&&(()=>{
            const {total}=calcCusto(Number(form.gramas),Number(form.horas),form.tipo==="Chaveiro");
            return (
              <div style={{marginTop:14,background:"#f0fdf4",borderRadius:10,padding:"11px 16px",fontSize:13}}>
                Custo: <strong style={{color:"#dc2626"}}>{fmt(total)}</strong> · Venda direta (2.5×): <strong style={{color:"#7c3aed"}}>{fmt(total*2.5)}</strong> · Consignação (1.8×): <strong style={{color:"#15803d"}}>{fmt(total*1.8)}</strong>
              </div>
            );
          })()}
          <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginTop:20}}>
            <button onClick={()=>setNovo(false)} style={{padding:"8px 16px",borderRadius:9,border:"none",background:"#f3f4f6",color:"#374151",fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Cancelar</button>
            <button onClick={salvarNovo} disabled={saving} style={{padding:"8px 20px",borderRadius:9,border:"none",background:saving?"#9ca3af":"#4f46e5",color:"#fff",fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              {saving?"Salvando...":"💾 Salvar no Google Sheets"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── FINANCEIRO ───────────────────────────────────────────────────────────────
function Financeiro({ pedidos, loading, erro, onRetry }) {
  if (loading) return <Spin msg="Carregando..." />;
  if (erro)    return <Err msg={erro} onRetry={onRetry} />;
  const ok     = pedidos.filter(p=>p.Realizado==="Sim"&&p.Entregue==="Sim"&&p.Pago==="Sim");
  const vendOK = ok.reduce((s,p)=>s+Number(p.Valor||0),0);
  const saldo  = vendOK - TOTAL_INV;
  const porFam = {};
  ok.forEach(p=>{ porFam[p.Familia]=(porFam[p.Familia]||0)+Number(p.Valor||0); });
  return (
    <div>
      <div style={{marginBottom:18}}><h2 style={{fontSize:20,fontWeight:900,color:"#111827",margin:0}}>Financeiro</h2></div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(175px,1fr))",gap:12,marginBottom:18}}>
        <KPI label="Total Investido" value={fmt(TOTAL_INV)} accent="#ef4444"/>
        <KPI label="Receita Confirmada" value={fmt(vendOK)} accent="#4f46e5"/>
        <KPI label="Saldo" value={fmt(saldo)} accent={saldo<0?"#ef4444":"#16a34a"}/>
        <KPI label="Payback" value={`${Math.min((vendOK/TOTAL_INV)*100,100).toFixed(0)}%`} accent="#d97706"/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <div style={{background:"#fff",borderRadius:14,padding:22,border:"1px solid #e5e7eb"}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:14}}>Detalhamento do Investimento</div>
          {Object.entries(INVESTIMENTOS).map(([k,v])=>{
            const c={Equipamentos:"#ef4444",Instrumentos:"#f59e0b",Insumos:"#10b981",Filamentos:"#4f46e5"}[k];
            return (
              <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"9px 0",borderBottom:"1px solid #f3f4f6"}}>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <div style={{width:10,height:10,borderRadius:3,background:c}}/>
                  <span style={{fontSize:13,color:"#374151"}}>{k}</span>
                </div>
                <span style={{fontWeight:700}}>{fmt(v)}</span>
              </div>
            );
          })}
          <div style={{display:"flex",justifyContent:"space-between",padding:"10px 0 0",fontWeight:900,fontSize:14}}>
            <span>Total</span><span style={{color:"#ef4444"}}>{fmt(TOTAL_INV)}</span>
          </div>
        </div>
        <div style={{background:"#fff",borderRadius:14,padding:22,border:"1px solid #e5e7eb"}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:14}}>Receita por Categoria (OK)</div>
          {Object.entries(porFam).sort((a,b)=>b[1]-a[1]).map(([f,v])=>(
            <div key={f} style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:4}}>
                <span>{f}</span><span style={{fontWeight:700,color:TIPO_COR[f]||"#4f46e5"}}>{fmt(v)}</span>
              </div>
              <div style={{background:"#f3f4f6",borderRadius:20,height:6}}>
                <div style={{width:`${(v/vendOK)*100}%`,background:TIPO_COR[f]||"#4f46e5",height:"100%",borderRadius:20}}/>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── CONSIGNAÇÃO ──────────────────────────────────────────────────────────────
function Consignacao({ consig, loading, erro, onRetry }) {
  const [sel, setSel] = useState("todos");
  if (loading) return <Spin msg="Carregando consignação..." />;
  if (erro)    return <Err msg={erro} onRetry={onRetry} />;
  const parceiros = [...new Set(consig.map(c=>c.Local||""))].filter(Boolean);
  const filtrados = sel==="todos" ? consig : consig.filter(c=>(c.Local||"")===sel);
  return (
    <div>
      <div style={{marginBottom:18}}>
        <h2 style={{fontSize:20,fontWeight:900,color:"#111827",margin:0}}>Consignação</h2>
        <p style={{color:"#6b7280",marginTop:4,fontSize:13}}>{parceiros.length} parceiros · Fechamento dia 30</p>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        {["todos",...parceiros].map(p=>(
          <button key={p} onClick={()=>setSel(p)} style={{padding:"7px 15px",borderRadius:20,border:"none",cursor:"pointer",fontFamily:"inherit",fontWeight:700,fontSize:12,background:sel===p?"#4f46e5":"#f3f4f6",color:sel===p?"#fff":"#374151"}}>{p==="todos"?"Todos":p}</button>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:18}}>
        <KPI label="Em consignação (AD)" value={fmt(filtrados.reduce((s,c)=>s+Number(c["Preço AD"]||0)*Number(c.Quantidade||0),0))} accent="#4f46e5"/>
        <KPI label="Já vendido" value={fmt(filtrados.reduce((s,c)=>s+Number(c["Preço AD"]||0)*Number(c["Quantidade Vendida"]||0),0))} accent="#16a34a"/>
        <KPI label="Estoque total" value={`${filtrados.reduce((s,c)=>s+Number(c["Estoque Atual"]||0),0)} un.`} accent="#d97706"/>
      </div>
      <div style={{background:"#fff",borderRadius:14,border:"1px solid #e5e7eb",overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead>
            <tr style={{background:"#f9fafb",borderBottom:"1px solid #e5e7eb"}}>
              {["Parceiro","Produto","Cor","Qtd","P.AD","P.Sugerido","Vendido","Estoque","Status"].map(h=>(
                <th key={h} style={{padding:"10px 12px",textAlign:"left",fontWeight:700,color:"#374151",fontSize:11,whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtrados.map((c,i)=>{
              const est=Number(c["Estoque Atual"]||0);
              const vend=Number(c["Quantidade Vendida"]||0);
              return (
                <tr key={i} style={{borderBottom:"1px solid #f3f4f6",background:i%2===0?"#fff":"#fafafa"}}>
                  <td style={{padding:"8px 12px",fontWeight:600,color:"#374151"}}>{c.Local}</td>
                  <td style={{padding:"8px 12px",color:"#111827"}}>{c.Impressão}</td>
                  <td style={{padding:"8px 12px",color:"#6b7280"}}>{c.Cor}</td>
                  <td style={{padding:"8px 12px",textAlign:"center"}}>{c.Quantidade}</td>
                  <td style={{padding:"8px 12px",fontWeight:600}}>{fmt(c["Preço AD"]||0)}</td>
                  <td style={{padding:"8px 12px",color:"#16a34a",fontWeight:600}}>{fmt(c["Preço Sugerido"]||0)}</td>
                  <td style={{padding:"8px 12px",textAlign:"center",fontWeight:800,color:vend>0?"#16a34a":"#9ca3af"}}>{vend}</td>
                  <td style={{padding:"8px 12px",textAlign:"center",fontWeight:800,color:est<=1?"#d97706":"#374151"}}>{est}</td>
                  <td style={{padding:"8px 12px"}}>{est===0?<Badge label="REPOR" color="red"/>:est<=2?<Badge label="Baixo" color="yellow"/>:<Badge label="OK" color="green"/>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtrados.length===0&&<div style={{padding:30,textAlign:"center",color:"#9ca3af",fontSize:13}}>Sem dados</div>}
      </div>
    </div>
  );
}

// ─── APP PARCEIRO ─────────────────────────────────────────────────────────────
function AppParceiro({ consig, loadingConsig }) {
  const [parceiroSel, setParceiroSel] = useState("Planet Kids Hair");
  const [venda, setVenda]   = useState({ impressao:"", qtd:1, data:new Date().toISOString().slice(0,10), cliente:"" });
  const [vendas, setVendas] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [salvo,    setSalvo]    = useState(false);
  const parceiros = Object.keys(SHEETS.parceiros);
  const estoque   = consig.filter(c=>(c.Local||"")===parceiroSel&&Number(c["Estoque Atual"]||0)>0);

  const salvar = async () => {
    if (!venda.impressao||!venda.qtd) return;
    setSalvando(true);
    const sheetId = SHEETS.parceiros[parceiroSel];
    const item    = consig.find(c=>(c.Local||"")===parceiroSel&&(c.Impressão||"")===venda.impressao);
    const precoAD = Number(item?.["Preço AD"]||0);
    const row = [
      `${venda.impressao}${item?.Cor||""}`,
      venda.impressao, item?.Cor||"", Number(venda.qtd), venda.data,
      venda.cliente, "", "", precoAD,
      precoAD*Number(venda.qtd), "", (precoAD*1.3).toFixed(2), (precoAD*1.3*Number(venda.qtd)).toFixed(2), (precoAD*0.3*Number(venda.qtd)).toFixed(2)
    ];
    try {
      await appendRow(sheetId, "Histórico de Vendas!A:N", row);
      setVendas(p=>[{...venda,id:Date.now()},...p]);
      setVenda({impressao:"",qtd:1,data:new Date().toISOString().slice(0,10),cliente:""});
      setSalvo(true); setTimeout(()=>setSalvo(false),2500);
    } catch(e) { alert("Erro ao registrar venda: "+e.message); }
    setSalvando(false);
  };

  return (
    <div>
      <div style={{background:"linear-gradient(135deg,#4f46e5,#7c3aed)",borderRadius:16,padding:"20px 24px",color:"#fff",marginBottom:20}}>
        <div style={{fontSize:10,fontWeight:700,opacity:0.7,textTransform:"uppercase",letterSpacing:"0.06em"}}>Portal do Parceiro</div>
        <h2 style={{fontSize:20,fontWeight:900,margin:"4px 0 0"}}>{parceiroSel}</h2>
        <p style={{opacity:0.8,fontSize:12,margin:"5px 0 0"}}>Registre as vendas · Fechamento dia 30 · PIX: 376.844.548-89</p>
      </div>
      <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:12,padding:"11px 16px",marginBottom:18,fontSize:13,color:"#15803d"}}>
        🔄 Vendas registradas aqui são gravadas diretamente na planilha do parceiro no Google Sheets em tempo real.
      </div>
      <div style={{display:"flex",gap:8,marginBottom:18,flexWrap:"wrap"}}>
        {parceiros.map(p=>(
          <button key={p} onClick={()=>setParceiroSel(p)} style={{padding:"7px 14px",borderRadius:20,border:"none",cursor:"pointer",fontFamily:"inherit",fontWeight:700,fontSize:12,background:parceiroSel===p?"#4f46e5":"#f3f4f6",color:parceiroSel===p?"#fff":"#374151"}}>{p}</button>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>
        <div style={{background:"#fff",borderRadius:14,padding:22,border:"1px solid #e5e7eb"}}>
          <div style={{fontWeight:800,fontSize:15,marginBottom:18}}>📝 Registrar Venda</div>
          <div style={{display:"flex",flexDirection:"column",gap:13}}>
            <div>
              <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5}}>Produto *</label>
              <select value={venda.impressao} onChange={e=>setVenda(p=>({...p,impressao:e.target.value}))} style={{width:"100%",padding:"9px 11px",borderRadius:9,border:"1px solid #d1d5db",fontSize:13,fontFamily:"inherit",boxSizing:"border-box"}}>
                <option value="">Selecione...</option>
                {loadingConsig?<option disabled>Carregando...</option>:estoque.map((c,i)=><option key={i} value={c.Impressão||""}>{c.Impressão} — {c.Cor} (est: {c["Estoque Atual"]})</option>)}
              </select>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div>
                <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5}}>Quantidade *</label>
                <input type="number" min={1} value={venda.qtd} onChange={e=>setVenda(p=>({...p,qtd:e.target.value}))} style={{width:"100%",padding:"8px 10px",borderRadius:9,border:"1px solid #d1d5db",fontSize:13,fontFamily:"inherit",boxSizing:"border-box"}}/>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5}}>Data *</label>
                <input type="date" value={venda.data} onChange={e=>setVenda(p=>({...p,data:e.target.value}))} style={{width:"100%",padding:"8px 10px",borderRadius:9,border:"1px solid #d1d5db",fontSize:13,fontFamily:"inherit",boxSizing:"border-box"}}/>
              </div>
            </div>
            <div>
              <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5}}>Cliente (opcional)</label>
              <input value={venda.cliente} onChange={e=>setVenda(p=>({...p,cliente:e.target.value}))} placeholder="Nome do cliente..." style={{width:"100%",padding:"8px 10px",borderRadius:9,border:"1px solid #d1d5db",fontSize:13,fontFamily:"inherit",boxSizing:"border-box"}}/>
            </div>
            <button onClick={salvar} style={{padding:"11px",borderRadius:10,border:"none",background:salvo?"#16a34a":salvando?"#9ca3af":"#4f46e5",color:"#fff",fontWeight:800,fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>
              {salvo?"✅ Gravado no Sheets!":salvando?"Salvando...":"Confirmar Venda"}
            </button>
          </div>
          {vendas.length>0&&(
            <div style={{marginTop:16}}>
              <div style={{fontSize:12,fontWeight:700,color:"#374151",marginBottom:8}}>Registradas nesta sessão:</div>
              {vendas.slice(0,5).map(v=>(
                <div key={v.id} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"6px 10px",background:"#f9fafb",borderRadius:8,marginBottom:5}}>
                  <span style={{fontWeight:600}}>{v.impressao}</span>
                  <span style={{color:"#16a34a",fontWeight:700}}>×{v.qtd} · {v.data}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{background:"#fff",borderRadius:14,padding:22,border:"1px solid #e5e7eb"}}>
          <div style={{fontWeight:800,fontSize:15,marginBottom:14}}>📦 Estoque Disponível</div>
          {loadingConsig?<Spin msg="Carregando..."/>:estoque.length===0?(
            <div style={{textAlign:"center",color:"#9ca3af",padding:30,fontSize:13}}>Sem estoque para este parceiro</div>
          ):estoque.map((c,i)=>{
            const est=Number(c["Estoque Atual"]||0);
            return (
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",background:est<=2?"#fffbeb":"#f9fafb",borderRadius:10,marginBottom:8,border:est<=2?"1px solid #fcd34d":"none"}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700}}>{c.Impressão}</div>
                  <div style={{fontSize:11,color:"#6b7280"}}>{c.Cor} · Sugerido: {fmt(c["Preço Sugerido"]||0)}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontWeight:900,fontSize:22,color:est<=2?"#d97706":"#16a34a"}}>{est}</div>
                  <div style={{fontSize:10,color:"#9ca3af"}}>restantes</div>
                </div>
              </div>
            );
          })}
          <div style={{marginTop:16,background:"#f0fdf4",borderRadius:12,padding:"14px 16px",fontSize:12,color:"#374151",lineHeight:1.6}}>
            <strong style={{color:"#15803d"}}>💰 Fechamento Mensal</strong><br/>
            Todo dia 30 · PIX: <strong>376.844.548-89</strong><br/>
            Eduardo Perez Marcelo · Bradesco
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── APP PRINCIPAL ────────────────────────────────────────────────────────────
export default function App() {
  const [logado,      setLogado]      = useState(false);
  const [loginLoad,   setLoginLoad]   = useState(false);
  const [pagina,      setPagina]      = useState("dashboard");
  const [pedidos,     setPedidos]     = useState([]);
  const [skus,        setSkus]        = useState([]);
  const [consig,      setConsig]      = useState([]);
  const [driveImgs,   setDriveImgs]   = useState([]);
  const [loadPed,     setLoadPed]     = useState(false);
  const [loadSku,     setLoadSku]     = useState(false);
  const [loadCon,     setLoadCon]     = useState(false);
  const [erroPed,     setErroPed]     = useState(null);
  const [erroSku,     setErroSku]     = useState(null);
  const [erroCon,     setErroCon]     = useState(null);
  const [ultimaAtt,   setUltimaAtt]   = useState(null);

  const carregarPedidos = useCallback(async () => {
    setLoadPed(true); setErroPed(null);
    try {
      const rows = await readRange(SHEETS.principal, "Pedidos!A:AC");
      setPedidos(rowsToObjects(rows));
      setUltimaAtt(new Date().toLocaleTimeString("pt-BR"));
    } catch(e) { setErroPed(e.message||String(e)); }
    setLoadPed(false);
  }, []);

  const carregarSkus = useCallback(async () => {
    setLoadSku(true); setErroSku(null);
    try {
      const rows = await readRange(SHEETS.principal, "Controle de Skus!A:G");
      setSkus(rowsToObjects(rows));
    } catch(e) { setErroSku(e.message||String(e)); }
    setLoadSku(false);
  }, []);

  const carregarConsig = useCallback(async () => {
    setLoadCon(true); setErroCon(null);
    try {
      const rows = await readRange(SHEETS.principal, "Consignado!A:M");
      setConsig(rowsToObjects(rows));
    } catch(e) { setErroCon(e.message||String(e)); }
    setLoadCon(false);
  }, []);

  const carregarImagens = useCallback(async () => {
    try {
      const imgs = await listDriveImages();
      setDriveImgs(imgs);
    } catch(e) { console.warn("Imagens:", e.message); }
  }, []);

  const login = async () => {
    setLoginLoad(true);
    try {
      await initGapi();
      await initGsi();
      await getToken();
      setLogado(true);
      await Promise.all([carregarPedidos(), carregarSkus(), carregarConsig(), carregarImagens()]);
    } catch(e) { console.error(e); setLoginLoad(false); }
    setLoginLoad(false);
  };

  if (!logado) return <Login onLogin={login} loading={loginLoad} />;

  const aProd = pedidos.filter(p=>p.Realizado!=="Sim"&&p.Realizado!=="Lead"!==false).length;
  const aEnt  = pedidos.filter(p=>p.Realizado==="Sim"&&p.Entregue==="Não").length;
  const aCob  = pedidos.filter(p=>(p.Entregue==="Sim"||p.Entregue==="Consignado")&&p.Pago==="Não").length;
  const badges= { produzir:aProd, entregar:aEnt, cobrar:aCob };

  const nav = [
    { id:"dashboard",   label:"Dashboard",      icon:"◉" },
    { id:"pedidos",     label:"Todos os Pedidos",icon:"📋" },
    { id:"produzir",    label:"Produzir",        icon:"🖨️" },
    { id:"entregar",    label:"Entregar",        icon:"📦" },
    { id:"cobrar",      label:"Cobrar",          icon:"💸" },
    { id:"produtos",    label:"Produtos / SKUs", icon:"🏷️" },
    { id:"consignacao", label:"Consignação",     icon:"🤝" },
    { id:"financeiro",  label:"Financeiro",      icon:"📊" },
    { id:"parceiro",    label:"App Parceiro",    icon:"🏪" },
  ];

  return (
    <div style={{fontFamily:"'Segoe UI',-apple-system,BlinkMacSystemFont,sans-serif",display:"flex",height:"100vh",background:"#f1f5f9"}}>
      {/* Sidebar */}
      <div style={{width:228,background:"#18181b",display:"flex",flexDirection:"column",padding:"0 0 16px",flexShrink:0}}>
        <div style={{padding:"22px 20px 14px",borderBottom:"1px solid rgba(255,255,255,0.07)"}}>
          <div style={{color:"#fff",fontWeight:900,fontSize:17,letterSpacing:"-0.03em"}}>Amalello</div>
          <div style={{color:"#52525b",fontSize:11,marginTop:2}}>Design · Impressão 3D</div>
          {ultimaAtt&&<div style={{color:"#22c55e",fontSize:10,marginTop:6}}>🟢 Atualizado {ultimaAtt}</div>}
        </div>
        <nav style={{flex:1,padding:"10px 8px",display:"flex",flexDirection:"column",gap:2,overflowY:"auto"}}>
          {nav.map(item=>{
            const badge=badges[item.id];
            const active=pagina===item.id;
            return (
              <button key={item.id} onClick={()=>setPagina(item.id)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 12px",borderRadius:10,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:active?700:400,background:active?"rgba(99,102,241,0.2)":"transparent",color:active?"#a5b4fc":"#71717a",textAlign:"left"}}>
                <span style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:14}}>{item.icon}</span>{item.label}
                </span>
                {badge>0&&<span style={{background:"#ef4444",color:"#fff",fontSize:10,fontWeight:800,borderRadius:20,padding:"1px 6px"}}>{badge}</span>}
              </button>
            );
          })}
        </nav>
        <div style={{padding:"0 10px"}}>
          <button onClick={()=>{carregarPedidos();carregarSkus();carregarConsig();carregarImagens();}} style={{width:"100%",padding:"8px",borderRadius:9,border:"none",background:"rgba(99,102,241,0.15)",color:"#a5b4fc",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,marginBottom:8}}>
            🔄 Sincronizar planilhas
          </button>
          <div style={{background:"rgba(255,255,255,0.04)",borderRadius:10,padding:"10px 12px"}}>
            <div style={{color:"#3f3f46",fontSize:10,fontWeight:700,textTransform:"uppercase"}}>Admin</div>
            <div style={{color:"#a1a1aa",fontSize:12,marginTop:2}}>Eduardo + Isabela</div>
            <div style={{color:"#3f3f46",fontSize:10,marginTop:4}}>🔗 Google Sheets · OAuth ativo</div>
          </div>
        </div>
      </div>

      {/* Conteúdo */}
      <div style={{flex:1,overflow:"auto"}}>
        <div style={{maxWidth:1200,margin:"0 auto",padding:"26px 24px"}}>
          {pagina==="dashboard"   && <Dashboard pedidos={pedidos} loading={loadPed} erro={erroPed} onRetry={carregarPedidos} ultimaAtt={ultimaAtt}/>}
          {pagina==="pedidos"     && <Pedidos pedidos={pedidos} loading={loadPed} erro={erroPed} onRetry={carregarPedidos} filter={null} onAddPedido={carregarPedidos} skus={skus}/>}
          {pagina==="produzir"    && <Pedidos pedidos={pedidos} loading={loadPed} erro={erroPed} onRetry={carregarPedidos} filter="produzir" onAddPedido={carregarPedidos} skus={skus}/>}
          {pagina==="entregar"    && <Pedidos pedidos={pedidos} loading={loadPed} erro={erroPed} onRetry={carregarPedidos} filter="entregar" onAddPedido={carregarPedidos} skus={skus}/>}
          {pagina==="cobrar"      && <Pedidos pedidos={pedidos} loading={loadPed} erro={erroPed} onRetry={carregarPedidos} filter="cobrar"   onAddPedido={carregarPedidos} skus={skus}/>}
          {pagina==="produtos"    && <Produtos skus={skus} driveImages={driveImgs} loading={loadSku} erro={erroSku} onRetry={carregarSkus} onAddSku={carregarSkus}/>}
          {pagina==="consignacao" && <Consignacao consig={consig} loading={loadCon} erro={erroCon} onRetry={carregarConsig}/>}
          {pagina==="financeiro"  && <Financeiro pedidos={pedidos} loading={loadPed} erro={erroPed} onRetry={carregarPedidos}/>}
          {pagina==="parceiro"    && <AppParceiro consig={consig} loadingConsig={loadCon}/>}
        </div>
      </div>
    </div>
  );
}
