(function(){
  function load(src){
    return new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src=src;
      s.onload=resolve;
      s.onerror=reject;
      document.head.appendChild(s);
    });
  }

  if(!document.querySelector('link[href^="sales-documents.css"]')){
    const l=document.createElement('link');
    l.rel='stylesheet';
    l.href='sales-documents.css?v=20260912-1545';
    document.head.appendChild(l);
  }

  (async()=>{
    try{await load('app-admin-events.js?v=20260912-1437');}
    catch(e){console.error('Gagal memuatkan modul Pengurusan Event.',e);}

    try{await load('app-event-commission-ledger.js?v=20260912-1455');}
    catch(e){console.error('Gagal memuatkan table Komisen Event / PIC Event.',e);}

    try{await load('app-event-finance-fix.js?v=20260912-1510');}
    catch(e){console.error('Gagal memuatkan pembetulan kewangan Event.',e);}

    try{await load('app-sales-documents.js?v=20260912-1545');}
    catch(e){console.error('Gagal memuatkan modul Dokumen Jualan.',e);}

    try{await load('app-sales-documents-wording-fix.js?v=20260912-1549');}
    catch(e){console.error('Gagal memuatkan pembetulan label Dokumen Jualan.',e);}

    init();
  })();
})();