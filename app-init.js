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
  if(!document.querySelector('link[href^="ai-office.css"]')){
    const l=document.createElement('link');
    l.rel='stylesheet';
    l.href='ai-office.css?v=20260912-2131';
    document.head.appendChild(l);
  }
  if(!document.querySelector('link[href^="tiktok-post-history.css"]')){
    const l=document.createElement('link');
    l.rel='stylesheet';
    l.href='tiktok-post-history.css?v=20260912-2115';
    document.head.appendChild(l);
  }
  if(!document.querySelector('link[href^="promo-video.css"]')){
    const l=document.createElement('link');
    l.rel='stylesheet';
    l.href='promo-video.css?v=20260914-1144';
    document.head.appendChild(l);
  }
  if(!document.querySelector('link[href^="inventory-redesign.css"]')){
    const l=document.createElement('link');
    l.rel='stylesheet';
    l.href='inventory-redesign.css?v=20260921-0105';
    document.head.appendChild(l);
  }

  (async()=>{
    try{await load('app-event-finance-fix.js?v=20260912-1510');}
    catch(e){console.error('Gagal memuatkan pembetulan kewangan Event.',e);}

    try{await load('app-product-variants.js?v=20260913-1648');}
    catch(e){console.error('Gagal memuatkan Product Variant 100ml / Event Recipe.',e);}

    try{await load('app-sales-documents.js?v=20260912-1545');}
    catch(e){console.error('Gagal memuatkan modul Dokumen Jualan.',e);}

    try{await load('app-sales-documents-wording-fix.js?v=20260912-1549');}
    catch(e){console.error('Gagal memuatkan pembetulan label Dokumen Jualan.',e);}

    try{await load('app-ai-office.js?v=20260912-1945');}
    catch(e){console.error('Gagal memuatkan modul AI Office.',e);}

    try{await load('app-tiktok-test-post.js?v=20260912-2105');}
    catch(e){console.error('Gagal memuatkan modul TikTok Test Post.',e);}

    try{await load('app-tiktok-post-history.js?v=20260912-2115');}
    catch(e){console.error('Gagal memuatkan TikTok Post History.',e);}

    try{await load('app-promo-admin.js?v=20260914-2350');}
    catch(e){console.error('Gagal memuatkan pengurusan video promosi Admin.',e);}

    try{await load('app-promo-video.js?v=20260914-2350');}
    catch(e){console.error('Gagal memuatkan video promosi sidebar.',e);}

    try{await load('app-sidebar-menu.js?v=20260916-1150');}
    catch(e){console.error('Gagal memuatkan menu sidebar tersusun.',e);}

    try{await load('app-inventory-redesign.js?v=20260921-0215');}
    catch(e){console.error('Gagal memuatkan Inventory workspace.',e);}

    init();
  })();
})();
