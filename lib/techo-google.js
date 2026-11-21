/* 手帖共通: Google ログインと Drive 同期の部品（techo-google.js）
 *
 * 手帖はすべて同じドメイン（ykdtmnhnddsbba-jj.github.io）・同じ OAuth クライアントID なので、
 * ログインのトークンを localStorage の共通キーに置けば、どれか1つの手帖でログインすれば他の手帖もそのまま同期できる。
 * 各手帖は <script src="../portal/lib/techo-google.js"></script> で読み込み、TechoGoogle.create() を使う。
 *
 * ここを直すと全部の手帖に効く。変えたら各手帖で「同期できる・読み込み失敗なら保存しない」を確認すること。
 */
(function(){
  'use strict';
  var DRIVE='https://www.googleapis.com/auth/drive.file';
  var TOK='techo_gauth_tok';            // 共通のトークン置き場 {t, e, scope}
  var QUIET=/login_required|interaction_required|consent_required|account_selection_required/;

  /* スマホのブラウザは sessionStorage が消えることがあるので localStorage を優先し、両方に書く */
  var st={
    get:function(k){try{var v=localStorage.getItem(k);if(v!=null)return v}catch(e){}try{return sessionStorage.getItem(k)}catch(e){return null}},
    set:function(k,v){try{localStorage.setItem(k,v)}catch(e){}try{sessionStorage.setItem(k,v)}catch(e){}},
    del:function(k){try{localStorage.removeItem(k)}catch(e){}try{sessionStorage.removeItem(k)}catch(e){}}
  };
  function readTok(){try{var s=JSON.parse(st.get(TOK)||'null');return s&&s.t&&s.e>Date.now()?s:null}catch(e){return null}}
  function hasScope(s,scope){return !!s&&(' '+(s.scope||DRIVE)+' ').indexOf(' '+scope+' ')>=0}

  function create(opt){
    var site=opt.site;                                   // 'anime' など。state のキーを手帖ごとに分ける
    var clientId=opt.clientId;                           // () => クライアントID
    var REDIR=location.origin+location.pathname.replace(/index\.html$/,'');
    var STATE=site+'_gauth_state',SILENT=site+'_gauth_silent';
    var msg='';

    /* Google からの戻り（#access_token=...）。自分が出した state のときだけ受け取る（他の機能の戻りは触らない） */
    try{
      if(/access_token=|error=/.test(location.hash)){
        var p=new URLSearchParams(location.hash.slice(1)),saved=st.get(STATE);
        if(saved&&p.get('state')===saved){
          if(p.get('access_token')){
            st.set(TOK,JSON.stringify({t:p.get('access_token'),e:Date.now()+(+p.get('expires_in')||3600)*1000,scope:p.get('scope')||DRIVE}));
          }else if(p.get('error')&&!QUIET.test(p.get('error'))){
            msg='Google認証が完了しませんでした ('+p.get('error')+')';
          }
          st.del(STATE);
          history.replaceState(null,'',location.pathname+location.search);
        }else if(saved&&p.get('state')){
          msg='Google認証の戻り情報を確認できませんでした。もう一度「☁ 要再接続」を押してください';
        }
      }
    }catch(e){}

    function token(scope){var s=readTok();return s&&hasScope(s,scope||DRIVE)?s:null}
    function redirect(prompt,scope){
      var cid=String(clientId()||'').trim();
      if(!cid)throw new Error('Google クライアントIDが未設定です（設定タブ）');
      var state=Math.random().toString(36).slice(2)+Date.now().toString(36);
      st.set(STATE,state);
      var q=new URLSearchParams({client_id:cid,redirect_uri:REDIR,response_type:'token',scope:scope||DRIVE,state:state,include_granted_scopes:'true'});
      if(prompt)q.set('prompt',prompt);
      location.href='https://accounts.google.com/o/oauth2/v2/auth?'+q.toString();
      return new Promise(function(){});                  // 遷移するので戻らない
    }
    /* 起動時の無言の再認証は5分に1回まで（ループ防止） */
    function silentOk(){
      var last=0;try{last=+sessionStorage.getItem(SILENT)||0}catch(e){}
      if(Date.now()-last<300000)return false;
      try{sessionStorage.setItem(SILENT,String(Date.now()))}catch(e){}
      return true;
    }
    function message(){var m=msg;msg='';return m}
    function gfetch(url,o){
      o=o||{};var s=readTok();var h={};for(var k in (o.headers||{}))h[k]=o.headers[k];
      h.Authorization='Bearer '+(s?s.t:'');
      var r={};for(var k2 in o)r[k2]=o[k2];r.headers=h;
      return fetch(url,r);
    }
    function err(text,status){var e=new Error(text+' ('+status+')');e.status=status;return e}

    /* ---- Drive（drive.file: このクライアントで作ったファイルだけ見える） ---- */
    async function find(name){
      var q=encodeURIComponent("name='"+String(name).replace(/'/g,"\\'")+"' and trashed=false");
      var r=await gfetch('https://www.googleapis.com/drive/v3/files?q='+q+'&fields=files(id)&orderBy='+encodeURIComponent('modifiedTime desc')+'&pageSize=1');
      if(!r.ok)throw err('Drive検索に失敗。Drive APIが有効か確認してください',r.status);
      var j=await r.json();return (j.files&&j.files[0]&&j.files[0].id)||null;
    }
    /* 読み込めないときは必ず例外にする。呼び出し側はそのまま保存を中止すること（他の端末の変更を消さないため） */
    async function read(id){
      var r=await gfetch('https://www.googleapis.com/drive/v3/files/'+id+'?alt=media');
      if(!r.ok)throw err('Driveの読み込みに失敗。保存は中止しました',r.status);
      return await r.json();
    }
    async function write(name,id,obj){
      var body=typeof obj==='string'?obj:JSON.stringify(obj,null,1);
      if(id){
        var r=await gfetch('https://www.googleapis.com/upload/drive/v3/files/'+id+'?uploadType=media',{method:'PATCH',headers:{'Content-Type':'application/json'},body:body});
        if(!r.ok)throw err('Drive保存に失敗',r.status);
        return id;
      }
      var b='techo'+Date.now();
      var meta=JSON.stringify({name:name,mimeType:'application/json'});
      var mp='--'+b+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+meta+'\r\n--'+b+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+body+'\r\n--'+b+'--';
      var r2=await gfetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+b},body:mp});
      if(!r2.ok)throw err('Drive作成に失敗',r2.status);
      return (await r2.json()).id;
    }
    /* 1つのファイルを「読む→混ぜる→書く」。onRemote(remote) で手元に混ぜる。戻り値はファイルID */
    async function syncFile(name,id,onRemote,getBody){
      if(!id)id=await find(name);
      if(id){
        var remote;
        try{remote=await read(id)}catch(e){if(e.status===404)e.forget=true;throw e}
        await onRemote(remote||{});
      }
      return await write(name,id,getBody());
    }
    return {DRIVE:DRIVE,redirect:redirect,token:token,silentOk:silentOk,message:message,fetch:gfetch,find:find,read:read,write:write,syncFile:syncFile};
  }
  window.TechoGoogle={create:create,DRIVE:DRIVE,version:1};
})();
